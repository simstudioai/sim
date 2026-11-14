import { describe, expect, it } from 'vitest'
import { SapConcurBlock } from '@/blocks/blocks/sap_concur'

const operation = 'sap_concur_list_travel_requests'

function mapParams(params: Record<string, unknown>, context?: { operation: string }) {
  const mapper = SapConcurBlock.tools.config?.params
  if (!mapper) throw new Error('SAP Concur block has no params mapper')
  return mapper({ operation, ...params }, context)
}

describe('SAP Concur list travel requests mapping', () => {
  it('keeps the model user and sort arguments on a tool call', () => {
    const mapped = mapParams(
      { userId: 'user-1', sortField: 'startDate', sortOrder: 'DESC' },
      { operation }
    )

    expect(mapped.userId).toBe('user-1')
    expect(mapped.sortField).toBe('startDate')
    expect(mapped.sortOrder).toBe('DESC')
  })

  it('prefers the configured subBlock over the model argument', () => {
    const mapped = mapParams({ travelRequestUserId: 'configured', userId: 'model' }, { operation })

    expect(mapped.userId).toBe('configured')
  })

  it('does not forward a stale same-named value on the canvas', () => {
    const mapped = mapParams({ userId: 'stale-from-another-operation' })

    expect(mapped.userId).toBeUndefined()
  })
})
