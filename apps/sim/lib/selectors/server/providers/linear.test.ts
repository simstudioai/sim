/**
 * @vitest-environment node
 */
import { LinearError } from '@linear/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveSelectorOAuthAccessToken, mockTeams, mockTeam, mockProject } = vi.hoisted(
  () => ({
    mockResolveSelectorOAuthAccessToken: vi.fn(),
    mockTeams: vi.fn(),
    mockTeam: vi.fn(),
    mockProject: vi.fn(),
  })
)

vi.mock('@linear/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@linear/sdk')>()
  return {
    ...actual,
    LinearClient: class LinearClient {
      teams = mockTeams
      team = mockTeam
      project = mockProject
    },
  }
})

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

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

function projectArgs(teamIds: string, cursor?: string): ExecuteServerSelectorArgs {
  return {
    ...teamArgs(),
    selectorKey: 'linear.projects',
    context: { oauthCredential: 'credential-1', teamId: teamIds },
    request: { kind: 'list', ...(cursor ? { cursor } : {}) },
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

  it('fetches one selected team page at a time', async () => {
    mockTeam.mockImplementation(async (teamId: string) => ({
      projects: async ({ after }: { after?: string }) => {
        return {
          nodes: [{ id: `project-${teamId}-${after ?? '0'}`, name: `Project ${teamId}` }],
          pageInfo: {
            hasNextPage: teamId === 'team-1' && !after,
            endCursor: teamId === 'team-1' && !after ? 'team-1-page-2' : undefined,
          },
        }
      },
    }))
    const teamIds = 'team-1,team-2'

    const first = await linearSelectorAttachments['linear.projects'].execute(projectArgs(teamIds))
    expect(first).toEqual({
      kind: 'list',
      items: [{ id: 'project-team-1-0', label: 'Project team-1' }],
      nextCursor: 'team=0&after=team-1-page-2',
    })
    expect(mockTeam).toHaveBeenCalledTimes(1)

    const second = await linearSelectorAttachments['linear.projects'].execute(
      projectArgs(teamIds, 'team=0&after=team-1-page-2')
    )
    expect(second).toEqual({
      kind: 'list',
      items: [{ id: 'project-team-1-team-1-page-2', label: 'Project team-1' }],
      nextCursor: 'team=1',
    })
    expect(mockTeam).toHaveBeenCalledTimes(2)

    const third = await linearSelectorAttachments['linear.projects'].execute(
      projectArgs(teamIds, 'team=1')
    )
    expect(third).toEqual({
      kind: 'list',
      items: [{ id: 'project-team-2-0', label: 'Project team-2' }],
    })
    expect(mockTeam).toHaveBeenCalledTimes(3)
  })

  it('rejects malformed multi-team cursors before requesting a team', async () => {
    await expect(
      linearSelectorAttachments['linear.projects'].execute(
        projectArgs('team-1,team-2', 'team=0&operation=teams')
      )
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mockTeam).not.toHaveBeenCalled()
  })

  it('hydrates a selected project without traversing its teams', async () => {
    mockProject.mockResolvedValueOnce({ id: 'project-1', name: 'Project One' })

    await expect(
      linearSelectorAttachments['linear.projects'].execute({
        ...projectArgs('team-1,team-2'),
        request: { kind: 'detail', id: 'project-1' },
      })
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'project-1', label: 'Project One' },
    })
    expect(mockProject).toHaveBeenCalledWith('project-1')
    expect(mockTeam).not.toHaveBeenCalled()
  })
})
