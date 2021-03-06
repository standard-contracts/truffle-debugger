import debugModule from "debug";
const debug = debugModule("debugger:data:sagas");

import { put, takeEvery, select } from "redux-saga/effects";
import jsonpointer from "json-pointer";

import { TICK } from "lib/trace/actions";
import * as actions from "./actions";

import ast from "lib/ast/selectors";
import evm from "lib/evm/selectors";
import data from "./selectors";

import { WORD_SIZE } from "lib/data/decode/utils";
import * as utils from "lib/data/decode/utils";

function *tickSaga() {
  let tree = yield select(ast.current.tree);
  let treeId = yield select(ast.current.index);
  let node = yield select(ast.next.node);
  let pointer = yield select(ast.next.pointer);
  let scopes = yield select(data.scopes.tables.current);
  let definitions = yield select(data.scopes.tables.inlined.current);

  let state = yield select(evm.next.state);
  if (!state.stack) {
    return;
  }

  let top = state.stack.length - 1;
  var parameters, returnParameters, assignments, storageVars;

  switch (node.nodeType) {

    case "FunctionDefinition":
      parameters = node.parameters.parameters
        .map( (p, i) => `${pointer}/parameters/parameters/${i}` );

      returnParameters = node.returnParameters.parameters
        .map( (p, i) => `${pointer}/returnParameters/parameters/${i}` );

      assignments = returnParameters.concat(parameters).reverse()
        .map( (pointer) => jsonpointer.get(tree, pointer).id )
        .map( (id, i) => ({ [id]: {"stack": top - i} }) )
        .reduce( (acc, assignment) => Object.assign(acc, assignment), {} );

      yield put(actions.assign(treeId, assignments));
      break;

    case "ContractDefinition":
      let storageVars = scopes[node.id].variables || [];
      let slot = 0;
      let index = WORD_SIZE - 1;  // cause lower-order
      debug("storage vars %o", storageVars);

      let allocation = utils.allocateDeclarations(storageVars, definitions);
      assignments = Object.assign(
        {}, ...Object.entries(allocation.children)
          .map( ([id, storage]) => ({ [id]: {storage} }) )
      );
      debug("assignments %O", assignments);

      yield put(actions.assign(treeId, assignments));
      break;

    case "VariableDeclaration":
      yield put(actions.assign(treeId, {
        [jsonpointer.get(tree, pointer).id]: {"stack": top}
      }));

    default:
      break;
  }
}

export default function* saga () {
  yield takeEvery(TICK, tickSaga);
}
