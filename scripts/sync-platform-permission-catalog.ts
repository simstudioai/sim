import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectPermissionGroupCatalog } from '../apps/sim/ee/access-control/lib/editor-catalog-projection'
import { getAccessControlBlockUniverse } from '../apps/sim/ee/access-control/lib/editor-registry'
import { formatGeneratedSource } from './format-generated-source'

/** Generate the static example with the same projection as the live permission-group editor. */
const file = resolve(
  import.meta.dir,
  '../apps/sim/platform/fixtures/settings/permission-catalog.generated.json'
)
const catalog = projectPermissionGroupCatalog(getAccessControlBlockUniverse())
const output = formatGeneratedSource(JSON.stringify(catalog), file, resolve(import.meta.dir, '..'))
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== output)
    throw new Error(
      'Permission catalog is stale. Run bun scripts/sync-platform-permission-catalog.ts'
    )
} else {
  writeFileSync(file, output)
}
