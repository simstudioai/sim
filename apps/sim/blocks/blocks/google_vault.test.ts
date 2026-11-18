import { describe, expect, it } from 'vitest'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => GoogleVaultBlock.tools.config?.params?.(inputs, context) ?? {}

/**
 * On an agent call the model supplies `includeSharedDrives` under the tool's own name; the
 * dedicated `exportIncludeSharedDrives` switch is never rendered in the agent tool input.
 */
describe('GoogleVaultBlock includeSharedDrives', () => {
  it.each(['create_matters_export', 'create_saved_query'])(
    'keeps the model value on an agent %s call',
    (operation) => {
      const inputs = { matterId: 'm-1', corpus: 'DRIVE', includeSharedDrives: true }
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

/** A tool call carries its operation only in `context`, never in the stored row params. */
describe('GoogleVaultBlock list_matters tool call', () => {
  it('sends the Detail Level set on the agent tool row as view', () => {
    const inputs = { matterView: 'FULL', matterState: 'OPEN' }
    const params = buildParams(inputs, { operation: 'list_matters' })
    expect(params.view).toBe('FULL')
    expect(params.state).toBe('OPEN')
  })
})
