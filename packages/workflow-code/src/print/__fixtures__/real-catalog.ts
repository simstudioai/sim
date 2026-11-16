/**
 * The real block catalog the printer goldens run against: the slice of `buildBlockCatalog` (the
 * registry projection) their cases use, checked in as `real-catalog.json` because this package
 * cannot import the registry. `apps/sim/lib/workflows/code/golden-catalog.test.ts` rebuilds it from
 * the live registry and fails when it drifts. The hand-made `catalog.ts` stays for unit tests.
 */

import type { BlockCatalog } from '../../catalog/types'
import snapshot from './real-catalog.json'

/** JSON imports widen literal unions (`storage: string`), so the snapshot is checked, then typed. */
function asCatalog(value: object): BlockCatalog {
  if (!('catalogVersion' in value) || value.catalogVersion !== 1 || !('blocks' in value)) {
    throw new Error('real-catalog.json is not a block catalog')
  }
  return value as BlockCatalog
}

export const realCatalog: BlockCatalog = asCatalog(snapshot)
