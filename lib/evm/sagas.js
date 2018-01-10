import debugModule from "debug";
const debug = debugModule("debugger:evm:sagas");

import { call, put, take } from "redux-saga/effects";
import { view } from "../effects";

import { TICK } from "../controller/actions";
import * as actions from "./actions";

import { nextStep } from "../selectors";

export function* callstackSaga () {
  while (true) {
    yield take(TICK);
    debug("got TICK");

    if (yield view(nextStep.evm.isCall)) {
      debug("got call");
      let address = yield view(nextStep.evm.callAddress);

      yield put(actions.call(address));

    } else if (yield view(nextStep.evm.isCreate)) {
      debug("got create");
      let binary = yield view(nextStep.evm.createBinary);

      yield put(actions.create(binary));

    } else if (yield view(nextStep.evm.isHalting)) {
      debug("got return");
      yield put(actions.returnCall());
    }
  }
}

export default function* saga () {
  yield call(callstackSaga);
}