import type { WritableAtom } from '../atom/index.js'
import type { AllPaths, BaseDeepMap, FromPath } from './path.js'

export { AllPaths, BaseDeepMap, FromPath, getPath, setByKey, setPath } from './path.js'

export type DeepMapStore<T extends BaseDeepMap> = {
  /**
   * Subscribe to store changes.
   *
   * In contrast with {@link Store#subscribe} it do not call listener
   * immediately.
   *
   * @param listener Callback with store value and old value.
   * @param changedKey Key that was changed. Will present only if `setKey`
   *                   has been used to change a store.
   * @returns Function to remove listener.
   */
  listen(
    listener: (
      value: T,
      oldValue: T,
      changedKey: AllPaths<T> | undefined
    ) => void
  ): () => void

  /**
   * Low-level method to notify listeners about changes in the store.
   *
   * Can cause unexpected behaviour when combined with frontend frameworks
   * doing equality checks for values, e.g. React.
   */
  notify(oldValue?: T, changedKey?: AllPaths<T>): void

  /**
   * Change key in store value. Copies are made at each level of `key` so that
   * no part of the original object is mutated (but it does not do a full deep
   * copy -- some sub-objects may still be shared between the old value and the
   * new one).
   *
   * ```js
   * $settings.setKey('visuals.theme', 'dark')
   * ```
   *
   * @param key The key name. Attributes can be split with a dot `.` and `[]`.
   * @param value New value.
   */
  setKey: <K extends AllPaths<T>>(key: K, value: FromPath<T, K>) => void

  /**
   * Subscribe to store changes and call listener immediately.
   *
   * ```
   * import { $settings } from '../store'
   *
   * $settings.subscribe(settings => {
   *   console.log(settings)
   * })
   * ```
   *
   * @param listener Callback with store value and old value.
   * @param changedKey Key that was changed. Will present only
   *                   if `setKey` has been used to change a store.
   * @returns Function to remove listener.
   */
  subscribe(
    listener: (
      value: T,
      oldValue: T | undefined,
      changedKey: AllPaths<T> | undefined
    ) => void
  ): () => void
} & Omit<WritableAtom<T>, 'listen' | 'notify' | 'setKey' | 'subscribe'>

/**
 * Create deep map store. Deep map store is a store with an object as store
 * value, that supports fine-grained reactivity for deeply nested properties.
 *
 * @param init Initialize store and return store destructor.
 * @returns The store object with methods to subscribe.
 */
export function deepMap<T extends BaseDeepMap>(init?: T): DeepMapStore<T>
