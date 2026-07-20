/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { orderByMock } = vi.hoisted(() => ({ orderByMock: vi.fn() }))

vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: orderByMock }) }) }) },
}))
vi.mock('@sim/db/schema', () => ({
  skill: { workspaceId: 'workspaceId', name: 'name', createdAt: 'createdAt' },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@sim/utils/id', () => ({ generateShortId: () => 'gen-id' }))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'req-id' }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
}))

import { listSkills } from './operations'

describe('listSkills includeBuiltins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prepends builtin template skills by default', async () => {
    orderByMock.mockResolvedValue([])
    const result = await listSkills({ workspaceId: 'ws-1' })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-'))).toBe(true)
  })

  // The mothership skill inventory passes includeBuiltins: false so it never sees
  // the code-only template skills.
  it('excludes builtin template skills when includeBuiltins is false', async () => {
    orderByMock.mockResolvedValue([
      { id: 'sk-1', name: 'mine', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])
    const result = await listSkills({ workspaceId: 'ws-1', includeBuiltins: false })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sk-1')
    expect(result.some((s) => s.id.startsWith('builtin-'))).toBe(false)
  })
})
