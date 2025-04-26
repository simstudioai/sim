import type { MapCreator } from '../map-creator/index.js'
import type { Store } from '../map/index.js'

/**
 * Prevent destructor call for the store.
 *
 * Together with {@link cleanStores} is useful tool for tests.
 *
 * ```js
 * import { keepMount } from 'nanostores'
 *
 * keepMount($store)
 * ```
 *
 * @param $store The store.
 */
export function keepMount($store: MapCreator | Store): void
