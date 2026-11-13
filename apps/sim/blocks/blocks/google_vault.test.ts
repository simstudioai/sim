import { describe, expect, it } from 'vitest'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'

/**
 * On an agent call the model supplies `includeSharedDrives` under the tool's own name; the
 * dedicated `exportIncludeSharedDrives` switch is never rendered in the agent tool input.
 */
describe('GoogleVaultBlock includeSharedDrives', () => {
  const buildParams = GoogleVaultBlock.tools.config.params!

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
