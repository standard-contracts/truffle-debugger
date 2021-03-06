import debugModule from "debug";
const debug = debugModule("debugger:controller:sagas");

import { put, call, race, take, select } from 'redux-saga/effects';

import * as actions from "./actions";
import * as traceActions from "lib/trace/actions";

import trace from "lib/trace/selectors";
import evm from "lib/evm/selectors";
import solidity from "lib/solidity/selectors";
import ast from "lib/ast/selectors";
import data from "lib/data/selectors";

const controlSagas = {
  [actions.ADVANCE]: advance,
  [actions.STEP_NEXT]: stepNext,
  [actions.STEP_OVER]: stepOver,
  [actions.STEP_INTO]: stepInto,
  [actions.STEP_OUT]: stepOut,
  [actions.CONTINUE_UNTIL]: continueUntil
};

export default function* saga() {
  while (true) {
    debug("waiting for control action");
    let action = yield take(Object.keys(controlSagas));
    debug("got control action");
    let saga = controlSagas[action.type];

    yield put(actions.beginStep(action.type));

    yield race({
      exec: call(saga, action),
      interrupt: take(actions.INTERRUPT)
    });
  }
}

/**
 * Advance the state by one instruction
 */
function* advance() {
  // send action to advance trace
  yield put(traceActions.next());

  // wait for trace to advance
  yield take(traceActions.TOCK);
}

/**
 * stepNext - step to the next logical code segment
 *
 * Note: It might take multiple instructions to express the same section of code.
 * "Stepping", then, is stepping to the next logical item, not stepping to the next
 * instruction. See advance() if you'd like to advance by one instruction.
 */
function* stepNext () {
  const startingRange = yield select(solidity.next.sourceRange);

  var nextRange, nextNode;

  do {
    // advance at least once step
    yield* advance();

    // and check the next source range
    nextRange = yield select(solidity.next.sourceRange);
    nextNode = yield select(ast.next.node);

    // if the next step's source range is still the same, keep going
  } while (
    // HACK - just skip over ContractDefinition nodes
    nextNode.nodeType == "ContractDefinition" ||

    nextRange.start == startingRange.start &&
    nextRange.length == startingRange.length
  );
}

/**
 * stepInto - step into the current function
 *
 * Conceptually this is easy, but from a programming standpoint it's hard.
 * Code like `getBalance(msg.sender)` might be highlighted, but there could
 * be a number of different intermediate steps (like evaluating `msg.sender`)
 * before `getBalance` is stepped into. This function will step into the first
 * function available (where instruction.jump == "i"), ignoring any intermediate
 * steps that fall within the same code range. If there's a step encountered
 * that exists outside of the range, then stepInto will only execute until that
 * step.
 */
function* stepInto () {
  if (yield select(evm.next.step.isJump)) {
    yield* stepNext();

    return;
  }

  if (yield select(solidity.next.isMultiline)) {
    yield* stepOver();

    return;
  }

  const startingDepth = yield select(solidity.current.functionDepth);
  const startingRange = yield select(solidity.next.sourceRange);
  var currentDepth;
  var nextRange;

  do {
    yield* stepNext();

    currentDepth = yield select(solidity.current.functionDepth);
    nextRange = yield select(solidity.next.sourceRange);

  } while (
    // the function stack has not increased,
    currentDepth <= startingDepth &&

    // the next source range begins on or after the starting range
    nextRange.start >= startingRange.start &&

    // and the next range ends on or before the starting range ends
    (nextRange.start + nextRange.length) <=
      (startingRange.start + startingRange.length)
  );
}

/**
 * Step out of the current function
 *
 * This will run until the debugger encounters a decrease in function depth.
 */
function* stepOut () {
  if (yield select(solidity.next.isMultiline)) {
    yield *stepOver();

    return;
  }

  const startingDepth = yield select(solidity.current.functionDepth);
  var currentDepth;

  do {
    yield* stepNext();

    currentDepth = yield select(solidity.current.functionDepth);

  } while(currentDepth >= startingDepth);
}

/**
 * stepOver - step over the current line
 *
 * Step over the current line. This will step to the next instruction that
 * exists on a different line of code within the same function depth.
 */
function* stepOver () {
  const startingDepth = yield select(solidity.current.functionDepth);
  const startingRange = yield select(solidity.next.sourceRange);
  var currentDepth;
  var nextRange;

  do {
    yield* stepNext();

    currentDepth = yield select(solidity.current.functionDepth);
    nextRange = yield select(solidity.next.sourceRange);

  } while (
    // keep stepping provided:
    //
    // we haven't jumped out
    !(currentDepth < startingDepth) &&

    // either: function depth is greater than starting (ignore function calls)
    // or, if we're at the same depth, keep stepping until we're on a new
    // line.
    (currentDepth > startingDepth ||
      nextRange.lines.start.line == startingRange.lines.start.line)
  )
}

/**
 * continueUntil - step through execution until a breakpoint
 *
 * @param breakpoints - array of breakpoints ({ ...call, line })
 */
function *continueUntil ({breakpoints}) {
  var currentCall;
  var nextRange;
  var nextNode;

  let breakpointHit = false;

  do {
    yield* stepNext();

    currentCall = yield select(evm.current.call);
    nextRange = yield select(solidity.next.sourceRange);
    nextNode = yield select(ast.next.node);

    breakpointHit = breakpoints
      .filter( ({address, binary, line, node}) =>
        (address == currentCall.address || binary == currentCall.binary) &&
        (line == nextRange.lines.start.line || node == nextNode.id)
      )
      .length > 0;

  } while (!breakpointHit);
}
