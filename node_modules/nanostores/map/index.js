import { atom } from '../atom/index.js'

export let map = (initial = {}) => {
  let $map = atom(initial)

  $map.setKey = function (key, value) {
    let oldMap = $map.value
    if (typeof value === 'undefined' && key in $map.value) {
      $map.value = { ...$map.value }
      delete $map.value[key]
      $map.notify(oldMap, key)
    } else if ($map.value[key] !== value) {
      $map.value = {
        ...$map.value,
        [key]: value
      }
      $map.notify(oldMap, key)
    }
  }

  return $map
}
