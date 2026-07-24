/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

import { PUT } from '@/app/api/tools/jira/update/route'

const CLOUD_ID = '11111111-1111-1111-1111-111111111111'
const ISSUE_KEY = 'PROJ-123'

const BASE_BODY = {
  domain: 'example.atlassian.net',
  accessToken: 'token-123',
  cloudId: CLOUD_ID,
  issueKey: ISSUE_KEY,
} as const

function noContent(): Response {
  return new Response(null, { status: 204 })
}

/** Parses the JSON body sent on the single PUT call to the Jira REST API. */
function putFields(): Record<string, unknown> {
  const call = fetchMock.mock.calls[0]
  const init = call?.[1] as RequestInit
  const parsed = JSON.parse(init.body as string)
  return parsed.fields
}

describe('Jira update route custom-field serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(noContent())
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
  })

  async function update(body: Record<string, unknown>) {
    const request = createMockRequest('PUT', { ...BASE_BODY, ...body })
    const response = await PUT(request)
    return { response, data: await response.json() }
  }

  it('serializes a select custom field to { value }', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10001', type: 'select', value: 'High' }],
    })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(putFields()).toEqual({ customfield_10001: { value: 'High' } })
  })

  it('serializes a select custom field with a numeric option id to { id }', async () => {
    await update({
      customFields: [{ fieldId: 'customfield_10001', type: 'select', value: '10023' }],
    })
    expect(putFields()).toEqual({ customfield_10001: { id: '10023' } })
  })

  it('rejects a customFields entry whose value shape mismatches its type', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10001', type: 'select', value: { label: 'High' } }],
    })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a userpicker entry passed an { email } object', async () => {
    const { response } = await update({
      customFields: [
        { fieldId: 'customfield_10003', type: 'userpicker', value: { email: 'x@y.com' } },
      ],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a cascading entry whose value is an unresolvable record', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10005', type: 'cascading', value: { id: '10' } }],
    })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a cascading array with more than [parent, child]', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10005', type: 'cascading', value: ['A', 'B', 'C'] }],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a text entry passed a bare number', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10007', type: 'text', value: 42 }],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a text entry with an empty value', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10007', type: 'text', value: '' }],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a select entry with an empty option value', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10001', type: 'select', value: { value: '' } }],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a select option object that sets both value and id', async () => {
    const { response } = await update({
      customFields: [
        { fieldId: 'customfield_10001', type: 'select', value: { value: 'High', id: '10' } },
      ],
    })
    expect(response.status).toBe(400)
  })

  it('rejects an empty multiselect array (clearing is not implicit)', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10002', type: 'multiselect', value: [] }],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a cascading object that sets both parent and value aliases', async () => {
    const { response } = await update({
      customFields: [
        {
          fieldId: 'customfield_10005',
          type: 'cascading',
          value: { parent: 'A', value: 'B', child: 'C' },
        },
      ],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a cascading entry with an empty parent', async () => {
    const { response } = await update({
      customFields: [{ fieldId: 'customfield_10005', type: 'cascading', value: { parent: '' } }],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a cascading entry that sets child both at top level and inside value', async () => {
    const { response } = await update({
      customFields: [
        {
          fieldId: 'customfield_10005',
          type: 'cascading',
          value: { parent: 'Americas', child: 'USA' },
          child: 'Canada',
        },
      ],
    })
    expect(response.status).toBe(400)
  })

  it('rejects a cascading [parent, child] array plus a conflicting top-level child', async () => {
    const { response } = await update({
      customFields: [
        {
          fieldId: 'customfield_10005',
          type: 'cascading',
          value: ['Americas', 'USA'],
          child: 'Canada',
        },
      ],
    })
    expect(response.status).toBe(400)
  })

  it('serializes a multiselect custom field to an array of options', async () => {
    await update({
      customFields: [
        { fieldId: 'customfield_10002', type: 'multiselect', value: ['Red', 'Green'] },
      ],
    })
    expect(putFields()).toEqual({ customfield_10002: [{ value: 'Red' }, { value: 'Green' }] })
  })

  it('serializes a userpicker custom field to { accountId }', async () => {
    await update({
      customFields: [{ fieldId: 'customfield_10003', type: 'userpicker', value: 'acc-1' }],
    })
    expect(putFields()).toEqual({ customfield_10003: { accountId: 'acc-1' } })
  })

  it('serializes a multiuserpicker custom field to an array of { accountId }', async () => {
    await update({
      customFields: [
        { fieldId: 'customfield_10004', type: 'multiuserpicker', value: ['acc-1', 'acc-2'] },
      ],
    })
    expect(putFields()).toEqual({
      customfield_10004: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }],
    })
  })

  it('serializes a cascading custom field to { value, child: { value } }', async () => {
    await update({
      customFields: [
        { fieldId: 'customfield_10005', type: 'cascading', value: 'Americas', child: 'USA' },
      ],
    })
    expect(putFields()).toEqual({
      customfield_10005: { value: 'Americas', child: { value: 'USA' } },
    })
  })

  it('passes a raw custom field through untouched', async () => {
    const raw = { any: ['shape', 1] }
    await update({
      customFields: [{ fieldId: 'customfield_10006', type: 'raw', value: raw }],
    })
    expect(putFields()).toEqual({ customfield_10006: raw })
  })

  it('coerces a numeric-string number custom field to a number', async () => {
    await update({
      customFields: [{ fieldId: 'customfield_10007', type: 'number', value: '42' }],
    })
    expect(putFields()).toEqual({ customfield_10007: 42 })
  })

  it('supports many custom fields in one call', async () => {
    await update({
      customFields: [
        { fieldId: 'customfield_1', type: 'select', value: 'A' },
        { fieldId: 'customfield_2', type: 'userpicker', value: 'acc-1' },
      ],
    })
    expect(putFields()).toEqual({
      customfield_1: { value: 'A' },
      customfield_2: { accountId: 'acc-1' },
    })
  })
})

describe('Jira update route backward compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(noContent())
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
  })

  async function update(body: Record<string, unknown>) {
    const request = createMockRequest('PUT', { ...BASE_BODY, ...body })
    return PUT(request)
  }

  it('still writes the legacy single custom field as a raw value', async () => {
    await update({ customFieldId: 'customfield_10001', customFieldValue: 'legacy-value' })
    expect(putFields()).toEqual({ customfield_10001: 'legacy-value' })
  })

  it('prefixes a bare legacy custom field id', async () => {
    await update({ customFieldId: '10001', customFieldValue: 'legacy-value' })
    expect(putFields()).toEqual({ customfield_10001: 'legacy-value' })
  })

  it('lets customFields override a colliding legacy field', async () => {
    await update({
      customFieldId: 'customfield_10001',
      customFieldValue: 'legacy-value',
      customFields: [{ fieldId: 'customfield_10001', type: 'select', value: 'High' }],
    })
    expect(putFields()).toEqual({ customfield_10001: { value: 'High' } })
  })
})

describe('Jira update route combined simple + custom fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(noContent())
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
  })

  it('combines simple fields and custom fields under one fields payload', async () => {
    const request = createMockRequest('PUT', {
      ...BASE_BODY,
      summary: 'Updated summary',
      description: 'Plain description',
      priority: 'High',
      assignee: 'acc-99',
      labels: ['alpha', 'beta'],
      customFields: [{ fieldId: 'customfield_10001', type: 'select', value: 'Blue' }],
    })
    await PUT(request)

    const fields = putFields()
    expect(fields.summary).toBe('Updated summary')
    expect(fields.priority).toEqual({ name: 'High' })
    expect(fields.assignee).toEqual({ accountId: 'acc-99' })
    expect(fields.labels).toEqual(['alpha', 'beta'])
    expect(fields.customfield_10001).toEqual({ value: 'Blue' })

    const description = fields.description as { type?: string; content?: unknown }
    expect(description.type).toBe('doc')
    expect(Array.isArray(description.content)).toBe(true)
  })

  it('preserves ADF auto-wrap for a plain-text description', async () => {
    const request = createMockRequest('PUT', {
      ...BASE_BODY,
      description: 'Hello world',
    })
    await PUT(request)

    const description = putFields().description as {
      type?: string
      content?: Array<{ content?: Array<{ text?: string }> }>
    }
    expect(description.type).toBe('doc')
    expect(description.content?.[0]?.content?.[0]?.text).toBe('Hello world')
  })
})
