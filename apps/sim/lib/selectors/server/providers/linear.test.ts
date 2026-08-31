/**
 * @vitest-environment node
 */
import { LinearError } from '@linear/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveSelectorOAuthAccessToken, mockTeams, mockTeam } = vi.hoisted(() => ({
  mockResolveSelectorOAuthAccessToken: vi.fn(),
  mockTeams: vi.fn(),
  mockTeam: vi.fn(),
}))

vi.mock('@linear/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@linear/sdk')>()
  return {
    ...actual,
    LinearClient: class LinearClient {
      teams = mockTeams
      team = mockTeam
    },
  }
})

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { linearSelectorAttachments } from '@/lib/selectors/server/providers/linear'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function teamArgs(signal?: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'linear.teams',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

function projectArgs(teamIds: string): ExecuteServerSelectorArgs {
  return {
    ...teamArgs(),
    selectorKey: 'linear.projects',
    context: { oauthCredential: 'credential-1', teamId: teamIds },
  }
}

function linearError(status: number): LinearError {
  return new LinearError({ response: { status } })
}

describe('Linear server selector adapter errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  it.each([
    [401, 'SelectorConnectionUnavailableError', 401],
    [403, 'SelectorConnectionUnavailableError', 403],
    [429, 'SelectorOptionsUnavailableError', 429],
    [500, 'SelectorOptionsUnavailableError', 502],
  ] as const)(
    'maps trusted Linear status %i to the safe selector taxonomy',
    async (status, name, safeStatus) => {
      mockTeams.mockRejectedValueOnce(linearError(status))

      await expect(
        linearSelectorAttachments['linear.teams'].execute(teamArgs())
      ).rejects.toMatchObject({ name, status: safeStatus })
    }
  )

  it('does not trust a status-shaped unknown error', async () => {
    mockTeams.mockRejectedValueOnce({ status: 401 })

    await expect(
      linearSelectorAttachments['linear.teams'].execute(teamArgs())
    ).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError', status: 502 })
  })

  it('preserves caller cancellation', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockTeams.mockRejectedValueOnce(abortError)

    await expect(
      linearSelectorAttachments['linear.teams'].execute(teamArgs(controller.signal))
    ).rejects.toBe(abortError)
  })

  it('bounds team fan-out and stops scheduling batches after filling the option budget', async () => {
    let activeProjectRequests = 0
    let maxActiveProjectRequests = 0
    mockTeam.mockImplementation(async (teamId: string) => ({
      projects: async ({ after }: { after?: string }) => {
        activeProjectRequests += 1
        maxActiveProjectRequests = Math.max(maxActiveProjectRequests, activeProjectRequests)
        await Promise.resolve()
        activeProjectRequests -= 1
        const page = Number(after ?? '0')
        return {
          nodes: Array.from({ length: 250 }, (_, index) => ({
            id: `project-${teamId}-${page}-${index}`,
            name: `Project ${teamId}-${page}-${index}`,
          })),
          pageInfo: {
            hasNextPage: page < 9,
            endCursor: page < 9 ? String(page + 1) : undefined,
          },
        }
      },
    }))
    const teamIds = Array.from({ length: 100 }, (_, index) => `team-${index}`).join(',')

    const result = await linearSelectorAttachments['linear.projects'].execute(projectArgs(teamIds))

    expect(result).toMatchObject({
      kind: 'list',
      diagnostics: {
        truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS, pages: 10 },
      },
    })
    expect(result.kind === 'list' ? result.items : []).toHaveLength(MAX_SELECTOR_OPTIONS)
    expect(mockTeam).toHaveBeenCalledTimes(5)
    expect(maxActiveProjectRequests).toBeLessThanOrEqual(5)
  })
})
