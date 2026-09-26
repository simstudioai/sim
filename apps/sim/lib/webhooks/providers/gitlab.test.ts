import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { gitlabHandler } from '@/lib/webhooks/providers/gitlab'

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
})
