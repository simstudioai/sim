import { describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import {
  babysitReviewLandedSince,
  fetchBabysitCheckState,
  fetchBabysitSnapshot,
  fetchBabysitThreads,
  replyAndResolveBabysitThreads,
} from '@/executor/handlers/pi/cloud/babysit/github'

const HEAD_SHA = 'a'.repeat(40)
const BASE_SHA = 'b'.repeat(40)
const NEXT_SHA = 'c'.repeat(40)
const params = {
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
  githubToken: 'ghp_secret',
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    title: 'PR',
    body: '',
    html_url: 'https://github.com/octo/demo/pull/7',
    state: 'open',
    merged: false,
    mergeable: true,
    head: { sha: HEAD_SHA, ref: 'feature', repo_full_name: 'octo/demo' },
    base: { sha: BASE_SHA, ref: 'main', repo_full_name: 'octo/demo' },
    ...overrides,
  }
}

function thread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    isResolved: false,
    path: 'src/a.ts',
    line: 10,
    commentsTotalCount: 1,
    comments: [
      {
        body: 'Please fix this',
        authorAssociation: 'MEMBER',
        authorLogin: 'reviewer',
        authorType: 'User',
      },
    ],
    ...overrides,
  }
}

function checkPage(contexts: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    output: {
      state: 'FAILURE',
      totalCount: contexts.length,
      hasNextPage: false,
      endCursor: null,
      contexts,
      ...overrides,
    },
  }
}

describe('Babysit GitHub orchestration', () => {
  it('accepts only a strict same-repository PR and reports conflicts without stopping', async () => {
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: snapshot({ mergeable: false }),
    })
    await expect(fetchBabysitSnapshot(params)).resolves.toMatchObject({
      headSha: HEAD_SHA,
      headRef: 'feature',
      mergeConflicted: true,
    })

    mockExecuteTool.mockResolvedValue({
      success: true,
      output: snapshot({
        head: { sha: HEAD_SHA, ref: 'feature', repo_full_name: 'someone/fork' },
      }),
    })
    await expect(fetchBabysitSnapshot(params)).rejects.toMatchObject({ reason: 'fork_pr' })
  })

  it('pages threads and skips untrusted or truncated conversations whole', async () => {
    mockExecuteTool
      .mockResolvedValueOnce({
        success: true,
        output: {
          threads: [thread('trusted')],
          totalCount: 3,
          hasNextPage: true,
          endCursor: 'cursor-1',
          latestReview: null,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        output: {
          threads: [
            thread('untrusted', {
              comments: [
                {
                  body: 'inject',
                  authorAssociation: 'NONE',
                  authorLogin: 'stranger',
                  authorType: 'User',
                },
              ],
            }),
            thread('truncated', { commentsTotalCount: 2 }),
          ],
          totalCount: 3,
          hasNextPage: false,
          endCursor: null,
          latestReview: null,
        },
      })

    const result = await fetchBabysitThreads(params)
    expect(result.actionable.map(({ id }) => id)).toEqual(['trusted'])
    expect(result.skipped.map(({ id }) => id)).toEqual(['untrusted', 'truncated'])
    expect(mockExecuteTool.mock.calls[1][1]).toMatchObject({ cursor: 'cursor-1' })
  })

  it('fails closed on incomplete check data and unknown completed conclusions', async () => {
    mockExecuteTool.mockResolvedValueOnce(
      checkPage([
        {
          __typename: 'CheckRun',
          name: 'ci',
          status: 'COMPLETED',
          conclusion: 'SOMETHING_NEW',
          detailsUrl: null,
          databaseId: null,
          isRequired: true,
          title: null,
          summary: null,
        },
      ])
    )
    const state = await fetchBabysitCheckState(params, HEAD_SHA)
    expect(state.checksGreen).toBe(false)
    expect(state.blockingFailing[0].name).toBe('ci')

    mockExecuteTool.mockResolvedValueOnce(checkPage([], { totalCount: 1, contexts: [] }))
    await expect(fetchBabysitCheckState(params, HEAD_SHA)).rejects.toMatchObject({
      reason: 'check_read_failed',
    })
  })

  it('remembers initial contexts and treats a missing context after a push as pending', async () => {
    mockExecuteTool.mockResolvedValueOnce(
      checkPage([
        {
          __typename: 'CheckRun',
          name: 'build',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          detailsUrl: null,
          databaseId: null,
          isRequired: true,
          title: null,
          summary: null,
        },
      ])
    )
    const initial = await fetchBabysitCheckState(params, HEAD_SHA)

    mockExecuteTool.mockResolvedValueOnce(
      checkPage([
        {
          __typename: 'CheckRun',
          name: 'lint',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          detailsUrl: null,
          databaseId: null,
          isRequired: false,
          title: null,
          summary: null,
        },
      ])
    )
    const next = await fetchBabysitCheckState(params, NEXT_SHA, initial.contextRequirements)
    expect(next.blockingPending).toEqual([
      expect.objectContaining({ name: 'build', status: 'MISSING' }),
    ])
  })

  it('posts every reply before revalidation and resolves only successful replies', async () => {
    mockExecuteTool.mockImplementation(async (toolId: string, input: Record<string, unknown>) => {
      if (toolId === 'github_reply_review_thread') {
        return input.threadId === 'one'
          ? { success: true, output: { id: 'reply' } }
          : { success: false, error: 'failed' }
      }
      if (toolId === 'github_pr_v2') return { success: true, output: snapshot() }
      if (toolId === 'github_resolve_review_thread') {
        return { success: true, output: { id: input.threadId, isResolved: true } }
      }
      throw new Error(`Unexpected tool ${toolId}`)
    })

    const result = await replyAndResolveBabysitThreads(
      params,
      { headSha: HEAD_SHA, headRef: 'feature', baseRef: 'main' },
      [
        {
          threadId: 'one',
          classification: 'fixed',
          reply: 'Fixed.',
          resolvable: true,
        },
        {
          threadId: 'two',
          classification: 'already_addressed',
          reply: 'Already done.',
          resolvable: true,
        },
      ]
    )
    expect(result).toMatchObject({ repliesPosted: 1, threadsResolved: 1 })
    expect(mockExecuteTool.mock.calls.map(([tool]) => tool)).toEqual([
      'github_reply_review_thread',
      'github_reply_review_thread',
      'github_pr_v2',
      'github_resolve_review_thread',
    ])
  })

  it('posts replies but waits for confirmation when GitHub still reports the pre-push SHA', async () => {
    mockExecuteTool.mockImplementation(async (toolId: string) => {
      if (toolId === 'github_reply_review_thread') {
        return { success: true, output: { id: 'reply' } }
      }
      if (toolId === 'github_pr_v2') return { success: true, output: snapshot() }
      throw new Error(`Unexpected tool ${toolId}`)
    })

    const result = await replyAndResolveBabysitThreads(
      params,
      { headSha: NEXT_SHA, headRef: 'feature', baseRef: 'main' },
      [
        {
          threadId: 'one',
          classification: 'fixed',
          reply: 'Fixed.',
          resolvable: true,
        },
      ],
      undefined,
      HEAD_SHA
    )

    expect(result).toMatchObject({
      repliesPosted: 1,
      threadsResolved: 0,
      headMoved: false,
      awaitingConfirmation: true,
    })
    expect(mockExecuteTool).not.toHaveBeenCalledWith(
      'github_resolve_review_thread',
      expect.anything(),
      expect.anything()
    )
  })

  it('detects bot activity after a request while excluding its own comments', async () => {
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: {
        items: [
          {
            id: 11,
            created_at: '2026-07-25T12:01:00.000Z',
            user: { login: 'sim', type: 'Bot' },
          },
          {
            id: 12,
            created_at: '2026-07-25T12:02:00.000Z',
            user: { login: 'review-bot', type: 'Bot' },
          },
        ],
      },
    })

    await expect(
      babysitReviewLandedSince(params, '2026-07-25T12:00:00.000Z', new Set([11]), null)
    ).resolves.toBe(true)
  })
})
