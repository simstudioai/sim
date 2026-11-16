import { describe, expect, it } from 'vitest'
import { SESBlock } from '@/blocks/blocks/ses'

/**
 * On an agent tool call the operation arrives only on `context`, and the merged row and model
 * values are keyed by the tool's param names (row fields hold strings). The handler forwards
 * `{ ...merged, ...mapped }`.
 */
const agentCall = (operation: string, merged: Record<string, unknown>) => ({
  ...merged,
  ...SESBlock.tools.config?.params?.(merged, { operation }),
})

describe('SESBlock agent tool calls', () => {
  it('coerces the page size typed in the tool row when listing templates', () => {
    expect(agentCall('list_templates', { pageSize: '20' })).toMatchObject({ pageSize: 20 })
  })

  it('keeps the model-supplied configuration set name and reply-to', () => {
    expect(
      agentCall('create_configuration_set', { configurationSetName: 'transactional' })
    ).toMatchObject({ configurationSetName: 'transactional' })
    expect(agentCall('send_bulk_email', { replyToAddresses: 'ops@example.com' })).toMatchObject({
      replyToAddresses: 'ops@example.com',
    })
  })
})
