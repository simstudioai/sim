import { clean } from '../clean-stores/index.js'
import { onMount } from '../lifecycle/index.js'
import { map } from '../map/index.js'

export function mapCreator(init) {
  let Creator = (id, ...args) => {
    if (!Creator.cache[id]) {
      Creator.cache[id] = Creator.build(id, ...args)
    }
    return Creator.cache[id]
  }

  Creator.build = (id, ...args) => {
    let store = map({ id })
    onMount(store, () => {
      let destroy
      if (init) destroy = init(store, id, ...args)
      return () => {
        delete Creator.cache[id]
        if (destroy) destroy()
      }
    })
    return store
  }

  Creator.cache = {}

  if (process.env.NODE_ENV !== 'production') {
    Creator[clean] = () => {
      for (let id in Creator.cache) {
        Creator.cache[id][clean]()
      }
      Creator.cache = {}
    }
  }

  return Creator
}
