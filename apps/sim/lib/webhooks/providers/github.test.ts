/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { githubHandler } from '@/lib/webhooks/providers/github'
import { isGitHubEventMatch } from '@/triggers/github/utils'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('GitHub webhook provider', () => {
  it('verifyAuth allows unsigned requests when no webhookSecret is configured', () => {
    const res = githubHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('verifyAuth rejects when the signature header is missing but a secret is configured', () => {
    const res = githubHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects an invalid X-Hub-Signature-256', () => {
    const res = githubHandler.verifyAuth!({
      request: reqWithHeaders({ 'X-Hub-Signature-256': 'sha256=deadbeef' }),
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
      request: reqWithHeaders({ 'X-Hub-Signature-256': signature }),
      rawBody: body,
      requestId: 't4',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('isGitHubEventMatch matches workflow_run events to the workflow_run trigger only', () => {
    expect(isGitHubEventMatch('github_workflow_run', 'workflow_run')).toBe(true)
    expect(isGitHubEventMatch('github_workflow_run', 'push')).toBe(false)
    expect(isGitHubEventMatch('github_workflow_run', 'issues')).toBe(false)
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

  it('matchEvent passes through all events for the generic webhook trigger', async () => {
    const result = await githubHandler.matchEvent!({
      body: { action: 'opened' },
      requestId: 't5',
      providerConfig: { triggerId: 'github_webhook' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({ 'x-github-event': 'push' }),
    })
    expect(result).toBe(true)
  })

  it('matchEvent filters events that do not match the configured trigger', async () => {
    const result = await githubHandler.matchEvent!({
      body: { action: 'opened' },
      requestId: 't6',
      providerConfig: { triggerId: 'github_workflow_run' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({ 'x-github-event': 'push' }),
    })
    expect(result).toBe(false)
  })

  it('matchEvent does not throw when the body is null', async () => {
    await expect(
      githubHandler.matchEvent!({
        body: null,
        requestId: 't7',
        providerConfig: { triggerId: 'github_pr_comment' },
        webhook: {},
        workflow: {},
        request: reqWithHeaders({ 'x-github-event': 'issue_comment' }),
      })
    ).resolves.toBe(false)
  })

  it('formatInput does not throw when the body is null', async () => {
    const { input } = await githubHandler.formatInput!({
      body: null,
      headers: { 'x-github-event': 'push' },
      requestId: 't8',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.event_type).toBe('push')
    expect(i.action).toBe('')
  })

  it('formatInput exposes user.type as user_type, keeping the raw type key too', async () => {
    const { input } = await githubHandler.formatInput!({
      body: {
        action: 'opened',
        issue: { id: 1, user: { login: 'octocat', type: 'User' } },
      },
      headers: { 'x-github-event': 'issues' },
      requestId: 't9',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    const issue = i.issue as Record<string, unknown>
    const user = issue.user as Record<string, unknown>
    expect(user.user_type).toBe('User')
    expect(user.type).toBe('User')
  })

  it('formatInput exposes repository.owner.type as owner_type', async () => {
    const { input } = await githubHandler.formatInput!({
      body: {
        action: 'opened',
        repository: { full_name: 'octocat/hello', owner: { login: 'octocat', type: 'User' } },
      },
      headers: { 'x-github-event': 'issues' },
      requestId: 't10',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    const repository = i.repository as Record<string, unknown>
    const owner = repository.owner as Record<string, unknown>
    expect(owner.owner_type).toBe('User')
    expect(owner.user_type).toBe('User')
  })

  it('formatInput exposes repository.description as repo_description, keeping the raw description key too', async () => {
    const { input } = await githubHandler.formatInput!({
      body: {
        action: 'opened',
        repository: { full_name: 'octocat/hello', description: 'A test repo' },
      },
      headers: { 'x-github-event': 'issues' },
      requestId: 't11',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    const repository = i.repository as Record<string, unknown>
    expect(repository.repo_description).toBe('A test repo')
    expect(repository.description).toBe('A test repo')
  })

  it('formatInput does not alias a nested `type` field on objects that are not user-like', async () => {
    const { input } = await githubHandler.formatInput!({
      body: {
        action: 'labeled',
        issue: {
          id: 1,
          label: { name: 'bug', color: 'ff0000', type: 'default' },
        },
      },
      headers: { 'x-github-event': 'issues' },
      requestId: 't13',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    const issue = i.issue as Record<string, unknown>
    const label = issue.label as Record<string, unknown>
    expect(label.type).toBe('default')
    expect(label.user_type).toBeUndefined()
    expect(label.owner_type).toBeUndefined()
  })

  it('formatInput derives branch from ref', async () => {
    const { input } = await githubHandler.formatInput!({
      body: { ref: 'refs/heads/main', action: '' },
      headers: { 'x-github-event': 'push' },
      requestId: 't12',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.branch).toBe('main')
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

  it('extractIdempotencyId returns null when there is no stable identifier', () => {
    expect(githubHandler.extractIdempotencyId!({})).toBeNull()
    expect(githubHandler.extractIdempotencyId!(null)).toBeNull()
  })
})
