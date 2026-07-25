/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { gitlabHandler } from '@/lib/webhooks/providers/gitlab'
import { isGitLabEventMatch } from '@/triggers/gitlab/utils'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('GitLab webhook provider', () => {
  it('verifyAuth rejects when webhookSecret is missing', async () => {
    const res = await gitlabHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects when X-Gitlab-Token header is missing', async () => {
    const res = await gitlabHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects when the token does not match', async () => {
    const res = await gitlabHandler.verifyAuth!({
      request: reqWithHeaders({ 'X-Gitlab-Token': 'wrong' }),
      rawBody: '{}',
      requestId: 't3',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth accepts a matching X-Gitlab-Token', async () => {
    const res = await gitlabHandler.verifyAuth!({
      request: reqWithHeaders({ 'X-Gitlab-Token': 'my-secret' }),
      rawBody: '{}',
      requestId: 't4',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('isGitLabEventMatch matches the configured trigger to its object_kind', () => {
    expect(isGitLabEventMatch('gitlab_push', 'push')).toBe(true)
    expect(isGitLabEventMatch('gitlab_push', 'issue')).toBe(false)
    expect(isGitLabEventMatch('gitlab_comment', 'note')).toBe(true)
    expect(isGitLabEventMatch('gitlab_webhook', 'anything')).toBe(true)
  })

  it('matchEvent passes through all events for the all-events trigger', async () => {
    const result = await gitlabHandler.matchEvent!({
      body: { object_kind: 'issue' },
      requestId: 't5',
      providerConfig: { triggerId: 'gitlab_webhook' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(true)
  })

  it('matchEvent filters events that do not match the configured trigger', async () => {
    const result = await gitlabHandler.matchEvent!({
      body: { object_kind: 'issue' },
      requestId: 't6',
      providerConfig: { triggerId: 'gitlab_push' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(false)
  })

  it('formatInput derives event_type and branch from the push payload', async () => {
    const { input } = await gitlabHandler.formatInput!({
      body: { object_kind: 'push', ref: 'refs/heads/main', checkout_sha: 'abc123' },
      headers: { 'x-gitlab-event': 'Push Hook' },
      requestId: 't7',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.event_type).toBe('Push Hook')
    expect(i.branch).toBe('main')
    expect(i.checkout_sha).toBe('abc123')
  })

  it('formatInput exposes object_attributes.type as work_item_type on issue payloads, keeping the raw type key too', async () => {
    const { input } = await gitlabHandler.formatInput!({
      body: {
        object_kind: 'issue',
        object_attributes: { id: 1, iid: 2, title: 'Bug', type: 'Issue' },
      },
      headers: { 'x-gitlab-event': 'Issue Hook' },
      requestId: 't8',
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    const attrs = i.object_attributes as Record<string, unknown>
    expect(attrs.work_item_type).toBe('Issue')
    expect(attrs.type).toBe('Issue')
    expect(attrs.title).toBe('Bug')
  })

  it('extractIdempotencyId derives a stable key for push events from checkout_sha', () => {
    const body = {
      object_kind: 'push',
      project: { id: 42 },
      ref: 'refs/heads/main',
      checkout_sha: 'abc123',
    }
    const first = gitlabHandler.extractIdempotencyId!(body)
    const second = gitlabHandler.extractIdempotencyId!({ ...body })
    expect(first).toBe(second)
    expect(first).toContain('abc123')
    expect(first).toContain('42')
  })

  it('extractIdempotencyId does not collide across different branches deleted in the same project', () => {
    const deleteMain = {
      object_kind: 'push',
      project: { id: 42 },
      ref: 'refs/heads/main',
      checkout_sha: null,
      after: '0000000000000000000000000000000000000000',
    }
    const deleteFeature = {
      object_kind: 'push',
      project: { id: 42 },
      ref: 'refs/heads/feature',
      checkout_sha: null,
      after: '0000000000000000000000000000000000000000',
    }
    const first = gitlabHandler.extractIdempotencyId!(deleteMain)
    const second = gitlabHandler.extractIdempotencyId!(deleteFeature)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(second)
  })

  it('extractIdempotencyId is stable for a repeated delivery of the same branch deletion', () => {
    const body = {
      object_kind: 'push',
      project: { id: 42 },
      ref: 'refs/heads/main',
      checkout_sha: null,
      after: '0000000000000000000000000000000000000000',
    }
    const first = gitlabHandler.extractIdempotencyId!(body)
    const second = gitlabHandler.extractIdempotencyId!({ ...body })
    expect(first).toBe(second)
  })

  it('extractIdempotencyId derives a stable key for issue events from object_attributes', () => {
    const body = {
      object_kind: 'issue',
      project: { id: 7 },
      object_attributes: { id: 99, updated_at: '2026-01-01T00:00:00.000Z' },
    }
    const first = gitlabHandler.extractIdempotencyId!(body)
    const second = gitlabHandler.extractIdempotencyId!({ ...body })
    expect(first).toBe(second)
    expect(first).toContain('99')
    expect(first).toContain('7')
  })

  it('extractIdempotencyId distinguishes pipeline lifecycle transitions despite no updated_at', () => {
    const pending = gitlabHandler.extractIdempotencyId!({
      object_kind: 'pipeline',
      project: { id: 7 },
      object_attributes: { id: 31, status: 'pending', created_at: '2026-01-01T00:00:00Z' },
    })
    const running = gitlabHandler.extractIdempotencyId!({
      object_kind: 'pipeline',
      project: { id: 7 },
      object_attributes: { id: 31, status: 'running', created_at: '2026-01-01T00:00:00Z' },
    })
    const success = gitlabHandler.extractIdempotencyId!({
      object_kind: 'pipeline',
      project: { id: 7 },
      object_attributes: {
        id: 31,
        status: 'success',
        created_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:03:00Z',
      },
    })
    expect(pending).not.toBeNull()
    expect(pending).not.toBe(running)
    expect(running).not.toBe(success)

    const retryOfSuccess = gitlabHandler.extractIdempotencyId!({
      object_kind: 'pipeline',
      project: { id: 7 },
      object_attributes: {
        id: 31,
        status: 'success',
        created_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:03:00Z',
      },
    })
    expect(success).toBe(retryOfSuccess)
  })

  it('extractIdempotencyId returns null when there is no stable identifier', () => {
    expect(gitlabHandler.extractIdempotencyId!({ object_kind: 'push' })).toBeNull()
    expect(gitlabHandler.extractIdempotencyId!({ object_kind: 'issue' })).toBeNull()
  })
})
