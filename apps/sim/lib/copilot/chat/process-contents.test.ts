/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '@/stores/panel'

const { getSkillById } = vi.hoisted(() => ({ getSkillById: vi.fn() }))

vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById }))

import { processContextsServer } from './process-contents'

describe('processContextsServer - skill contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a tagged skill to full content + encoded VFS path', async () => {
    getSkillById.mockResolvedValue({
      id: 'sk-1',
      name: 'My Skill — PostHog',
      description: 'desc',
      content: '# My Skill\n\nDo the thing.',
    })

    const result = await processContextsServer(
      [{ kind: 'skill', skillId: 'sk-1', label: 'My Skill — PostHog' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(getSkillById).toHaveBeenCalledWith({ skillId: 'sk-1', workspaceId: 'ws-1' })
    expect(result).toEqual([
      {
        type: 'skill',
        tag: '@My Skill — PostHog',
        content: '# My Skill\n\nDo the thing.',
        path: 'agent/skills/My%20Skill%20%E2%80%94%20PostHog.json',
      },
    ])
  })

  it('drops a skill that does not resolve (unknown or cross-workspace)', async () => {
    getSkillById.mockResolvedValue(null)

    const result = await processContextsServer(
      [{ kind: 'skill', skillId: 'missing', label: 'x' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(result).toEqual([])
  })

  it('drops a skill when no workspace is in scope', async () => {
    const result = await processContextsServer(
      [{ kind: 'skill', skillId: 'sk-1', label: 'x' } as ChatContext],
      'user-1',
      'hello',
      undefined
    )

    expect(getSkillById).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})
