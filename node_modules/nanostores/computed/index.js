import { atom, epoch } from '../atom/index.js'
import { onMount } from '../lifecycle/index.js'

let computedStore = (stores, cb, batched) => {
  if (!Array.isArray(stores)) stores = [stores]

  let previousArgs
  let currentEpoch
  let set = () => {
    if (currentEpoch === epoch) return
    currentEpoch = epoch
    let args = stores.map($store => $store.get())
    if (!previousArgs || args.some((arg, i) => arg !== previousArgs[i])) {
      previousArgs = args
      let value = cb(...args)
      if (value && value.then && value.t) {
        value.then(asyncValue => {
          if (previousArgs === args) {
            // Prevent a stale set
            $computed.set(asyncValue)
          }
        })
      } else {
        $computed.set(value)
        currentEpoch = epoch
      }
    }
  }
  let $computed = atom(undefined)
  let get = $computed.get
  $computed.get = () => {
    set()
    return get()
  }

  let timer
  let run = batched
    ? () => {
        clearTimeout(timer)
        timer = setTimeout(set)
      }
    : set

  onMount($computed, () => {
    let unbinds = stores.map($store => $store.listen(run))
    set()
    return () => {
      for (let unbind of unbinds) unbind()
    }
  })

  return $computed
}

export let computed = (stores, fn) => computedStore(stores, fn)
export let batched = (stores, fn) => computedStore(stores, fn, true)
