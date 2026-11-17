import { describe, expect, it } from 'vitest'
import { ApolloBlock } from '@/blocks/blocks/apollo'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => ApolloBlock.tools.config?.params?.(inputs, context) ?? {}

/**
 * On an agent call the stored row params merge with the model args (keyed by the tool's param
 * names), the operation reaches the mapper only on `context`, and the handler forwards
 * `{ ...merged, ...mapped }`.
 */
describe('ApolloBlock agent tool calls', () => {
  const agentCall = (
    operation: string,
    merged: Record<string, unknown>
  ): Record<string, unknown> => {
    return { ...merged, ...buildParams(merged, { operation }) }
  }

  it('forwards the row acting user and label names to sequence_add_contacts', () => {
    const mapped = agentCall('sequence_add', {
      apiKey: 'key',
      sequence_id: 'seq_1',
      contact_ids: ['c_1'],
      send_email_from_email_account_id: 'ea_1',
      sequence_user_id: 'user_1',
      sequence_add_label_names: '["outbound"]',
    })
    expect(mapped).toMatchObject({ user_id: 'user_1', label_names: ['outbound'] })
    expect(mapped.sequence_user_id).toBeUndefined()
    expect(mapped.sequence_add_label_names).toBeUndefined()
  })

  it('sends the row initial status over a stale task status carried from another operation', () => {
    const mapped = agentCall('sequence_add', {
      apiKey: 'key',
      sequence_id: 'seq_1',
      contact_ids: ['c_1'],
      send_email_from_email_account_id: 'ea_1',
      sequence_status: 'paused',
      status: 'scheduled',
    })
    expect(mapped.status).toBe('paused')
  })

  it('keeps the row initial status on the canvas', () => {
    const mapped = buildParams({
      operation: 'sequence_add',
      apiKey: 'key',
      sequence_status: 'paused',
      status: 'active',
    })
    expect(mapped.status).toBe('paused')
  })
})
