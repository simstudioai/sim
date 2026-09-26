import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { describe, expect, it } from 'vitest'
import { githubHandler } from '@/lib/webhooks/providers/github'
import { isGitHubEventMatch } from '@/triggers/github/utils'

describe('GitHub webhook provider', () => {
  it('verifyAuth rejects an invalid X-Hub-Signature-256', () => {
    const res = githubHandler.verifyAuth!({
      request: createMockRequest({ headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } }),
      rawBody: '{}',
      requestId: 't3',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth accepts a valid X-Hub-Signature-256', async () => {
    const crypto = await import('crypto')
    const body = '{"action":"opened"}'
    const secret = 'my-secret'
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
    const res = githubHandler.verifyAuth!({
      request: createMockRequest({ headers: { 'X-Hub-Signature-256': signature } }),
      rawBody: body,
      requestId: 't4',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('isGitHubEventMatch distinguishes issue comments from PR comments', () => {
    expect(
      isGitHubEventMatch('github_issue_comment', 'issue_comment', undefined, { issue: {} })
    ).toBe(true)
    expect(
      isGitHubEventMatch('github_issue_comment', 'issue_comment', undefined, {
        issue: { pull_request: { url: 'x' } },
      })
    ).toBe(false)
    expect(
      isGitHubEventMatch('github_pr_comment', 'issue_comment', undefined, {
        issue: { pull_request: { url: 'x' } },
      })
    ).toBe(true)
  })

  it('matchEvent filters events that do not match the configured trigger', async () => {
    const result = await githubHandler.matchEvent!({
      body: { action: 'opened' },
      requestId: 't6',
      providerConfig: { triggerId: 'github_workflow_run' },
      webhook: {},
      workflow: {},
      request: createMockRequest({ headers: { 'x-github-event': 'push' } }),
    })
    expect(result).toBe(false)
  })

  it('extractIdempotencyId derives a stable key from the most specific nested entity', () => {
    const body = { action: 'created', comment: { id: 5, updated_at: '2026-01-01T00:00:00Z' } }
    const first = githubHandler.extractIdempotencyId!(body)
    const second = githubHandler.extractIdempotencyId!({ ...body })
    expect(first).toBe(second)
    expect(first).toContain('5')
  })

  it('extractIdempotencyId falls back to ref+after for push events', () => {
    const id = githubHandler.extractIdempotencyId!({
      ref: 'refs/heads/main',
      before: 'a',
      after: 'b',
    })
    expect(id).toBe('github:push:refs/heads/main:b')
  })
})
