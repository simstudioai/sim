/**
 * @vitest-environment node
 */
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

  it('verifyAuth rejects when a secret is configured but X-Hub-Signature is missing', async () => {
    const res = await jiraHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { webhookSecret: 'my-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
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

  it('matchEvent filters events that do not match the configured trigger', async () => {
    const result = await jiraHandler.matchEvent!({
      body: { webhookEvent: 'comment_created' },
      requestId: 't4',
      providerConfig: { triggerId: 'jira_issue_created' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(false)
  })

  it('matchEvent passes through all events for the generic webhook trigger', async () => {
    const result = await jiraHandler.matchEvent!({
      body: { webhookEvent: 'anything' },
      requestId: 't5',
      providerConfig: { triggerId: 'jira_webhook' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(true)
  })

  it('matchEvent degrades gracefully instead of throwing when body is null', async () => {
    const result = await jiraHandler.matchEvent!({
      body: null,
      requestId: 't6',
      providerConfig: { triggerId: 'jira_issue_created' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(false)
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

  it('matchEvent ignores fieldFilters for other trigger types', async () => {
    const result = await jiraHandler.matchEvent!({
      body: { webhookEvent: 'jira:issue_created' },
      requestId: 't9',
      providerConfig: { triggerId: 'jira_issue_created', fieldFilters: 'status' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(true)
  })

  it('matchEvent matches any field change when fieldFilters is empty', async () => {
    const result = await jiraHandler.matchEvent!({
      body: {
        webhookEvent: 'jira:issue_updated',
        changelog: { items: [{ field: 'description', from: 'a', to: 'b' }] },
      },
      requestId: 't10',
      providerConfig: { triggerId: 'jira_issue_updated' },
      webhook: {},
      workflow: {},
      request: reqWithHeaders({}),
    })
    expect(result).toBe(true)
  })

  it('formatInput extracts issue data for the issue_created trigger', async () => {
    const { input } = await jiraHandler.formatInput!({
      body: {
        webhookEvent: 'jira:issue_created',
        timestamp: 123,
        issue: { id: '10001', key: 'PROJ-1' },
      },
      headers: {},
      requestId: 't7',
      webhook: { providerConfig: { triggerId: 'jira_issue_created' } },
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.webhookEvent).toBe('jira:issue_created')
    const issue = i.issue as Record<string, unknown>
    expect(issue.key).toBe('PROJ-1')
  })

  it('formatInput does not throw and degrades gracefully when body is null', async () => {
    const { input } = await jiraHandler.formatInput!({
      body: null,
      headers: {},
      requestId: 't8',
      webhook: { providerConfig: { triggerId: 'jira_webhook' } },
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.webhookEvent).toBeUndefined()
    expect(i.issue).toEqual({})
  })

  it('extractIdempotencyId derives a stable key from webhookEvent + entity id', () => {
    const body = { webhookEvent: 'jira:issue_created', timestamp: 123, issue: { id: '10001' } }
    const first = jiraHandler.extractIdempotencyId!(body)
    const second = jiraHandler.extractIdempotencyId!({ ...body })
    expect(first).toBe(second)
    expect(first).toContain('10001')
  })

  it('extractIdempotencyId returns null when there is no stable identifier', () => {
    expect(jiraHandler.extractIdempotencyId!({ webhookEvent: 'jira:issue_created' })).toBeNull()
  })

  it('extractIdempotencyId does not throw when body is null', () => {
    expect(jiraHandler.extractIdempotencyId!(null)).toBeNull()
  })
})
