import { useStore } from '../state/store'

// A dropped project can mean several things. A .lulogo.svg / .lulogo.png is
// both a picture and the project it was exported from; any project, .json
// included, can be opened in place of the current drawing or added on top of
// it. Only the person dropping it knows which they meant — replacing the whole
// document to place a logo would be as wrong as flattening a project they came
// back to edit. So the import path stops and asks.
//
// The question is asked by putting it in the store (ImportChoiceDialog renders
// it) and awaiting the answer here, which keeps io/ free of React while still
// letting the prompt look like the rest of the app.

/** Resolves the pending question with 'project' | 'merge' | 'artwork' | 'cancel'. */
let answer = null

// Questions are answered one at a time. Dropping two such files asks twice, in
// order — without this a second question would strand the first one's promise
// and hang the import that is waiting on it.
let queue = Promise.resolve()

/**
 * Ask what `name` should be imported as, and resolve with the choice.
 *
 * `kind` is 'svg', 'png', 'json' or 'drawio'. It decides what the "keep it as a picture"
 * option is called, and a .json save has no picture, so it isn't offered.
 */
export function askImportChoice(name, kind) {
  const ask = () =>
    new Promise((resolve) => {
      answer = resolve
      useStore.getState().setImportChoice({ name, kind })
    })
  const result = queue.then(ask, ask)
  // The queue must not inherit a rejection, or every later question is skipped.
  queue = result.then(
    () => {},
    () => {},
  )
  return result
}

/** Called by the dialog. Closing by Escape or backdrop counts as 'cancel'. */
export function answerImportChoice(choice) {
  const resolve = answer
  answer = null
  useStore.getState().setImportChoice(null)
  if (resolve) resolve(choice)
}
