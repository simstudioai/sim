/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@sim/utils/id', () => ({ generateShortId: () => 'gen-id' }))

import { listSkills } from '@/lib/workflows/skills/operations'

describe('listSkills includeBuiltins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('prepends builtin template skills by default', async () => {
    const result = await listSkills({ workspaceId: 'ws-1' })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-'))).toBe(true)
  })

  /**
   * The mothership skill inventory passes includeBuiltins: false so it never
   * sees the code-only template skills.
   */
  it('excludes builtin template skills when includeBuiltins is false', async () => {
    queueTableRows(schemaMock.skill, [
      { id: 'sk-1', name: 'mine', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])
    const result = await listSkills({ workspaceId: 'ws-1', includeBuiltins: false })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sk-1')
    expect(result.some((s) => s.id.startsWith('builtin-'))).toBe(false)
  })
})
