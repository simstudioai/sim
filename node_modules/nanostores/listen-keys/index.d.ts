import type { StoreValue } from '../map/index.js'

/**
 * Listen for specific keys of the store.
 *
 * In contrast with {@link subscribeKeys} it do not call listener
 * immediately.
 * ```js
 * import { listenKeys } from 'nanostores'
 *
 * listenKeys($page, ['blocked'], (value, oldValue, changed) => {
 *   if (value.blocked) {
 *     console.log('You has no access')
 *   }
 * })
 * ```
 *
 * @param $store The store to listen.
 * @param keys The keys to listen.
 * @param listener Standard listener.
 */
export function listenKeys<
  SomeStore extends { setKey: (key: any, value: any) => void }
>(
  $store: SomeStore,
  keys: SomeStore extends { setKey: (key: infer Key, value: never) => unknown }
    ? readonly Key[]
    : never,
  listener: (
    value: StoreValue<SomeStore>,
    oldValue: StoreValue<SomeStore>,
    changed: SomeStore extends {
      setKey: (key: infer Key, value: never) => unknown
    }
      ? Key[]
      : never
  ) => void
): () => void

/**
 * Listen for specific keys of the store and call listener immediately.
 * Note that the oldValue and changed arguments in the listener are
 * undefined during the initial call.
 *
 * ```js
 * import { subscribeKeys } from 'nanostores'
 *
 * subscribeKeys($page, ['blocked'], (value, oldValue, changed) => {
 *   if (value.blocked) {
 *     console.log('You has no access')
 *   }
 * })
 * ```
 *
 * @param $store The store to listen.
 * @param keys The keys to listen.
 * @param listener Standard listener.
 */
export function subscribeKeys<
  SomeStore extends { setKey: (key: any, value: any) => void }
>(
  $store: SomeStore,
  keys: SomeStore extends { setKey: (key: infer Key, value: never) => unknown }
    ? readonly Key[]
    : never,
  listener: (
    value: StoreValue<SomeStore>,
    oldValue: StoreValue<SomeStore>,
    changed: SomeStore extends {
      setKey: (key: infer Key, value: never) => unknown
    }
      ? Key[]
      : never
  ) => void
): () => void
