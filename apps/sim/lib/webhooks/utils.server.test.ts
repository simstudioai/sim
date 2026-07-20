/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Condition {
  kind: string
  column?: unknown
  value?: unknown
  conditions?: Condition[]
}

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: Condition[]) => ({ kind: 'and', conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
  isNull: (column: unknown) => ({ kind: 'isNull', column }),
}))

import { findConflictingWebhookPathOwner } from '@/lib/webhooks/utils.server'

function claimLookupChain(rows: unknown[], captureCondition?: (condition: Condition) => void) {
  return {
    from: vi.fn(() => ({
      where: vi.fn((condition: Condition) => {
        captureCondition?.(condition)
        return { limit: vi.fn().mockResolvedValue(rows) }
      }),
    })),
  }
}

function liveRowsChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    })),
  }
}

describe('findConflictingWebhookPathOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the claim owner while the claim holder is mid-rotation', async () => {
    let claimCondition: Condition | undefined
    mockSelect.mockReturnValueOnce(
      claimLookupChain([{ workflowId: 'workflow-owner' }], (condition) => {
        claimCondition = condition
      })
    )

    const owner = await findConflictingWebhookPathOwner({
      path: ' /leads/ ',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBe('workflow-owner')
    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(claimCondition).toEqual(expect.objectContaining({ kind: 'eq', value: 'leads' }))
  })

  it('ignores the caller-owned claim and falls through to live rows', async () => {
    mockSelect
      .mockReturnValueOnce(claimLookupChain([{ workflowId: 'workflow-caller' }]))
      .mockReturnValueOnce(liveRowsChain([]))

    const owner = await findConflictingWebhookPathOwner({
      path: 'leads',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBeNull()
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })

  it('returns a foreign live-row owner when no claim exists', async () => {
    mockSelect
      .mockReturnValueOnce(claimLookupChain([]))
      .mockReturnValueOnce(
        liveRowsChain([{ workflowId: 'workflow-caller' }, { workflowId: 'workflow-foreign' }])
      )

    const owner = await findConflictingWebhookPathOwner({
      path: 'leads',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBe('workflow-foreign')
  })

  it('skips the claim lookup entirely for empty paths', async () => {
    mockSelect.mockReturnValueOnce(liveRowsChain([]))

    const owner = await findConflictingWebhookPathOwner({
      path: '   ',
      workflowId: 'workflow-caller',
    })

    expect(owner).toBeNull()
    expect(mockSelect).toHaveBeenCalledTimes(1)
  })
})
