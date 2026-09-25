import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { jiraHandler } from '@/lib/webhooks/providers/jira'
import { isJiraEventMatch } from '@/triggers/jira/utils'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('Jira webhook provider', () => {
  it('verifyAuth skips verification when no webhookSecret is configured (optional secret)', async () => {
    const res = await jiraHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('verifyAuth rejects when the signature does not match', async () => {
    const res = await jiraHandler.verifyAuth!({
      request: reqWithHeaders({ 'X-Hub-Signature': 'sha256=wrong' }),
      rawBody: '{"a":1}',
      requestId: 't3',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('isJiraEventMatch maps trigger ids to their real webhookEvent values', () => {
    expect(isJiraEventMatch('jira_issue_created', 'jira:issue_created')).toBe(true)
    expect(isJiraEventMatch('jira_issue_created', 'comment_created')).toBe(false)
    expect(isJiraEventMatch('jira_issue_commented', 'comment_created')).toBe(true)
    expect(isJiraEventMatch('jira_webhook', 'anything')).toBe(true)
  })

  it('matchEvent applies fieldFilters on issue_updated, matching a changed field', async () => {
    const result = await jiraHandler.matchEvent!({
      body: {
        webhookEvent: 'jira:issue_updated',
        changelog: { items: [{ field: 'status', from: 'Open', to: 'Done' }] },
      },
      requestId: 't7',
      providerConfig: { triggerId: 'jira_issue_updated', fieldFilters: 'status, assignee' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(true)
  })

  it('matchEvent applies fieldFilters on issue_updated, skipping when no filtered field changed', async () => {
    const result = await jiraHandler.matchEvent!({
      body: {
        webhookEvent: 'jira:issue_updated',
        changelog: { items: [{ field: 'description', from: 'a', to: 'b' }] },
      },
      requestId: 't8',
      providerConfig: { triggerId: 'jira_issue_updated', fieldFilters: 'status, assignee' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(false)
  })

  it('extractIdempotencyId derives a stable key from webhookEvent + entity id', () => {
    const body = { webhookEvent: 'jira:issue_created', timestamp: 123, issue: { id: '10001' } }
    const first = jiraHandler.extractIdempotencyId!(body)
    const second = jiraHandler.extractIdempotencyId!({ ...body })
    expect(first).toBe(second)
    expect(first).toContain('10001')
  })
})
