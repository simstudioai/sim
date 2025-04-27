import { cleanTasks } from '../task/index.js'

export let clean = Symbol('clean')

export let cleanStores = (...stores) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'cleanStores() can be used only during development or tests'
    )
  }
  cleanTasks()
  for (let $store of stores) {
    if ($store) {
      if ($store.mocked) delete $store.mocked
      if ($store[clean]) $store[clean]()
    }
  }
}
