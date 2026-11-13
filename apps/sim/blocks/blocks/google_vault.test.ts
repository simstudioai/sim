import { describe, expect, it } from 'vitest'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import type { BlockConfig } from '@/blocks/types'

/** The block's `tools.config.params` mapper, which every block under test defines. */
function requireParamsMapper(block: BlockConfig) {
  const mapper = block.tools.config?.params
  if (!mapper) throw new Error(`${block.type} has no params mapper`)
  return mapper
}

/**
 * On an agent call the model supplies `includeSharedDrives` under the tool's own name; the
 * dedicated `exportIncludeSharedDrives` switch is never rendered in the agent tool input.
 */
describe('GoogleVaultBlock includeSharedDrives', () => {
  const buildParams = requireParamsMapper(GoogleVaultBlock)

  it.each(['create_matters_export', 'create_saved_query'])(
    'keeps the model value on an agent %s call',
    (operation) => {
      const inputs = { operation, matterId: 'm-1', corpus: 'DRIVE', includeSharedDrives: true }
      expect(buildParams(inputs, { operation }).includeSharedDrives).toBe(true)
    }
  )

  it('still sends false on the canvas for an unset switch', () => {
    const inputs = {
      operation: 'create_matters_export',
      corpus: 'DRIVE',
      includeSharedDrives: true,
    }
    expect(buildParams(inputs).includeSharedDrives).toBe(false)
  })
})
