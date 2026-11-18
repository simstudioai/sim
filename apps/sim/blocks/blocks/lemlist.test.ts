import { describe, expect, it } from 'vitest'
import { LemlistBlock } from '@/blocks/blocks/lemlist'

/** The canvas path: serialization picks the tool, then the executor merges the mapper output. */
function canvasToolParams(stored: Record<string, unknown>): Record<string, unknown> {
  const params = { ...stored }
  LemlistBlock.tools.config?.tool?.(params)
  return { ...params, ...LemlistBlock.tools.config?.params?.(params) }
}

describe('Lemlist lead ID per operation', () => {
  it("keeps Send Email's lead ID when a stale Get Activities lead filter is stored", () => {
    const params = canvasToolParams({
      operation: 'send_email',
      leadId: 'lea_send',
      filterLeadId: 'lea_stale_filter',
    })
    expect(params.leadId).toBe('lea_send')
  })

  it('filters Get Activities by its own lead filter, never a stale Send Email lead ID', () => {
    expect(
      canvasToolParams({ operation: 'get_activities', filterLeadId: 'lea_filter', leadId: 'x' })
        .leadId
    ).toBe('lea_filter')
    expect(
      canvasToolParams({ operation: 'get_activities', filterLeadId: null, leadId: 'lea_stale' })
        .leadId
    ).toBeUndefined()
  })

  it("keeps an agent's lead filter, which arrives under the tool's leadId param", () => {
    const args = { leadId: 'lea_model' }
    const mapped = LemlistBlock.tools.config?.params?.(args, { operation: 'get_activities' })
    expect({ ...args, ...mapped }.leadId).toBe('lea_model')
  })
})
