import { atom } from '../atom/index.js'
import { getPath, setPath } from './path.js'

export { getPath, setByKey, setPath } from './path.js'

export function deepMap(initial = {}) {
  let $deepMap = atom(initial)
  $deepMap.setKey = (key, value) => {
    if (getPath($deepMap.value, key) !== value) {
      let oldValue = $deepMap.value
      $deepMap.value = setPath($deepMap.value, key, value)
      $deepMap.notify(oldValue, key)
    }
  }
  return $deepMap
}
