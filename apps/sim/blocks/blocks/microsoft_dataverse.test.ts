import { describe, expect, it } from 'vitest'
import { MicrosoftDataverseBlock } from '@/blocks/blocks/microsoft_dataverse'
import type { BlockToolParamsContext } from '@/blocks/types'

/**
 * The params the tool receives: both the canvas handler and the agent tool path spread the mapper's
 * result over the inputs, so a key the mapper omits still reaches the tool raw.
 */
const forwarded = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => ({
  ...inputs,
  ...MicrosoftDataverseBlock.tools.config.params(inputs, context),
})

describe('MicrosoftDataverseBlock params mapper', () => {
  it('keeps a record-column select saved for another operation out of the metadata request', () => {
    const mapped = forwarded({
      operation: 'get_entity_metadata',
      entityLogicalName: 'account',
      select: 'name,accountid',
    })
    expect(mapped.select).toBeUndefined()
  })

  it('forwards the model select on a get_entity_metadata tool call', () => {
    const mapped = forwarded(
      { entityLogicalName: 'account', select: 'LogicalName,EntitySetName' },
      { operation: 'get_entity_metadata' }
    )
    expect(mapped.select).toBe('LogicalName,EntitySetName')
  })

  it('forwards search entities saved on the tool row as the tool entities param', () => {
    const searchEntities = '[{"Name":"account"}]'
    const mapped = forwarded({ searchTerm: 'contoso', searchEntities }, { operation: 'search' })
    expect(mapped.entities).toBe(searchEntities)
  })
})
