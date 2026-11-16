import { describe, expect, it } from 'vitest'
import { AffinityBlock } from '@/blocks/blocks/affinity'

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  const mapParams = AffinityBlock.tools.config?.params
  if (!mapParams) throw new Error('Affinity block has no params mapper')
  return { ...args, ...mapParams(args, { operation }) }
}

describe('AffinityBlock agent tool calls', () => {
  it('maps block-field keys and keeps model args instead of dropping them', () => {
    const result = toolCall(
      { apiKey: 'key', noteEntityType: 'company', entityId: '42', limit: '10' },
      'list_entity_notes'
    )
    expect(result).toMatchObject({ entityType: 'company', entityId: '42', limit: 10 })
    expect(result.noteEntityType).toBeUndefined()

    expect(
      toolCall({ apiKey: 'key', name: 'Deals', type: 'company', isPublic: true }, 'create_list')
    ).toMatchObject({ name: 'Deals', type: 'company', isPublic: true })
  })
})
