import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

/**
 * The catalog built from the live block registry, as the server serves it. A test that imports it
 * must `vi.unmock('@/blocks/registry')` and `vi.unmock('@/tools/metadata-outputs')` first, or it
 * gets the setup's mocked registry and no per-operation tool outputs.
 */
export const registryCatalog = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})
