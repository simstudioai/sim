import { describe, expect, it } from 'vitest'
import { RootlyBlock } from '@/blocks/blocks/rootly'

/** Runs the mapper the way a tool call does: merged row and model args under the mapper's result. */
function resolveToolCall(args: Record<string, unknown>, operation: string) {
  const mapper = RootlyBlock.tools.config?.params
  if (!mapper) throw new Error('Rootly block has no params mapper')
  return { ...args, ...mapper(args, { operation }) }
}

describe('RootlyBlock agent tool calls', () => {
  it('maps a field saved on the tool row while keeping the model args named after tool params', () => {
    const result = resolveToolCall(
      { apiKey: 'key', updateIncidentId: 'inc_1', title: 'Database degraded', private: true },
      'rootly_update_incident'
    )

    expect(result).toMatchObject({
      incidentId: 'inc_1',
      title: 'Database degraded',
      private: true,
    })
  })

  it('keeps a boolean resolveRelatedIncidents sent by the model', () => {
    const result = resolveToolCall(
      { apiKey: 'key', alertId: 'a1', resolveRelatedIncidents: true },
      'rootly_resolve_alert'
    )

    expect(result).toMatchObject({ alertId: 'a1', resolveRelatedIncidents: true })
  })
})
