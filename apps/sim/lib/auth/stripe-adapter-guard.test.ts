/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import { guardSubscriptionPlanWrites } from '@/lib/auth/stripe-adapter-guard'

function createBaseAdapter() {
  return {
    create: vi.fn(async (data: { data: unknown }) => data.data),
    update: vi.fn(async (data: { update: unknown }) => data.update),
    updateMany: vi.fn(async () => 1),
    findOne: vi.fn(),
  }
}

/**
 * The guard only relies on create/update/updateMany/findOne; the remaining
 * adapter surface passes through the spread untouched.
 */
// double-cast-allowed: test double implements only the adapter subset the guard touches
const asAdapter = (base: ReturnType<typeof createBaseAdapter>) =>
  guardSubscriptionPlanWrites(base as unknown as Parameters<typeof guardSubscriptionPlanWrites>[0])

const ORG_ROW = { id: 'sub-1', referenceId: 'org-1', plan: 'team_6000' }
const WHERE = [{ field: 'id', value: 'sub-1' }]

describe('guardSubscriptionPlanWrites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('strips a non-org plan from an update targeting an org-referenced row but keeps the rest', async () => {
    const base = createBaseAdapter()
    base.findOne.mockResolvedValueOnce(ORG_ROW)
    // org existence lookup
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'org-1' }])

    const guarded = asAdapter(base)
    await guarded.update({
      model: 'subscription',
      where: WHERE as never,
      update: { plan: 'pro_6000', status: 'active', seats: 2 },
    })

    expect(base.update).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: 'active', seats: 2 } })
    )
  })

  it('returns the current row without writing when stripping leaves an empty update', async () => {
    const base = createBaseAdapter()
    base.findOne.mockResolvedValueOnce(ORG_ROW).mockResolvedValueOnce(ORG_ROW)
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'org-1' }])

    const guarded = asAdapter(base)
    const result = await guarded.update({
      model: 'subscription',
      where: WHERE as never,
      update: { plan: 'pro_6000' },
    })

    expect(result).toEqual(ORG_ROW)
    expect(base.update).not.toHaveBeenCalled()
  })

  it('passes through non-org plan updates for user-referenced rows', async () => {
    const base = createBaseAdapter()
    base.findOne.mockResolvedValueOnce({ id: 'sub-2', referenceId: 'user-1', plan: 'pro_6000' })
    // org existence lookup: user id is not an organization
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const guarded = asAdapter(base)
    await guarded.update({
      model: 'subscription',
      where: WHERE as never,
      update: { plan: 'pro_25000', status: 'active' },
    })

    expect(base.update).toHaveBeenCalledWith(
      expect.objectContaining({ update: { plan: 'pro_25000', status: 'active' } })
    )
  })

  it('passes through org-plan updates without any row lookup', async () => {
    const base = createBaseAdapter()

    const guarded = asAdapter(base)
    await guarded.update({
      model: 'subscription',
      where: WHERE as never,
      update: { plan: 'team_25000', seats: 5 },
    })

    expect(base.findOne).not.toHaveBeenCalled()
    expect(base.update).toHaveBeenCalledWith(
      expect.objectContaining({ update: { plan: 'team_25000', seats: 5 } })
    )
  })

  it('passes through updates on other models untouched', async () => {
    const base = createBaseAdapter()

    const guarded = asAdapter(base)
    await guarded.update({
      model: 'user',
      where: WHERE as never,
      update: { plan: 'pro_6000' },
    })

    expect(base.findOne).not.toHaveBeenCalled()
    expect(base.update).toHaveBeenCalled()
  })

  it('rejects creating an org-referenced subscription with a non-org plan', async () => {
    const base = createBaseAdapter()
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'org-1' }])

    const guarded = asAdapter(base)
    await expect(
      guarded.create({
        model: 'subscription',
        data: { plan: 'pro_6000', referenceId: 'org-1' } as never,
      })
    ).rejects.toThrow(/must hold a Team or Enterprise plan/)

    expect(base.create).not.toHaveBeenCalled()
  })

  it('allows creating a personal pro subscription', async () => {
    const base = createBaseAdapter()
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const guarded = asAdapter(base)
    await guarded.create({
      model: 'subscription',
      data: { plan: 'pro_6000', referenceId: 'user-1' } as never,
    })

    expect(base.create).toHaveBeenCalled()
  })
})
