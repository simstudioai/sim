/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOnConflictDoUpdate, mockReturning } = vi.hoisted(() => ({
  mockOnConflictDoUpdate: vi.fn(),
  mockReturning: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    insert: () => ({
      values: () => ({ onConflictDoUpdate: mockOnConflictDoUpdate }),
    }),
  },
}))

import { claimCooldown } from '@/lib/workspace-events/state'

describe('claimCooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning })
    mockReturning.mockResolvedValue([{ workflowId: 'workflow-1' }])
  })

  it('claims the slot when the upsert returns a row', async () => {
    await expect(claimCooldown('workflow-1', 'block-1', 'scope-1', 60_000)).resolves.toBe(true)
  })

  it('declines the slot when the cooldown predicate matched nothing', async () => {
    mockReturning.mockResolvedValue([])
    await expect(claimCooldown('workflow-1', 'block-1', 'scope-1', 60_000)).resolves.toBe(false)
  })

  it('binds the cooldown threshold through the column encoder', async () => {
    await claimCooldown('workflow-1', 'block-1', 'scope-1', 60_000)

    const { setWhere } = mockOnConflictDoUpdate.mock.calls[0][0]
    expect(setWhere.values.some((value: unknown) => value instanceof Date)).toBe(false)
    expect(
      setWhere.values.some(
        (value: unknown) => (value as { value?: unknown } | null)?.value instanceof Date
      )
    ).toBe(true)
  })
})
