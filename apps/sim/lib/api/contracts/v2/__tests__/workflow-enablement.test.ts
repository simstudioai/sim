/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { v2ApplyWorkflowOperationsBodySchema } from '@/lib/api/contracts/v2/workflows'

const change = { block_id: 'block-1', enabled: false }

describe('workflow enablement-only request', () => {
  it.each([undefined, []])('accepts enablement changes with operations %s', (operations) => {
    expect(
      v2ApplyWorkflowOperationsBodySchema.parse({ operations, setBlockEnabled: [change] })
    ).toEqual({
      operations: [],
      setBlockEnabled: [change],
      atomic: false,
      layout: 'targeted',
    })
  })

  it.each([
    {},
    { operations: [] },
    { setBlockEnabled: [] },
    { operations: [], setBlockEnabled: [] },
  ])('rejects a request without any edits: %s', (input) => {
    expect(v2ApplyWorkflowOperationsBodySchema.safeParse(input).success).toBe(false)
  })

  it('preserves strict fields and bounded enablement batches', () => {
    expect(
      v2ApplyWorkflowOperationsBodySchema.safeParse({
        setBlockEnabled: [{ ...change, extra: true }],
      }).success
    ).toBe(false)
    expect(
      v2ApplyWorkflowOperationsBodySchema.safeParse({
        setBlockEnabled: Array.from({ length: 1001 }, () => change),
      }).success
    ).toBe(false)
  })
})
