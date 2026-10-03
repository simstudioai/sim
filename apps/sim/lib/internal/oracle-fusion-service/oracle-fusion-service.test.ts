/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), validateUrl: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.validateUrl,
}))

import { executeOracleFusionServiceTool } from '@/lib/internal/oracle-fusion-service/execute-tool'
import { executeOracleFusionServiceOperation } from '@/lib/internal/oracle-fusion-service/operations'
import type { OracleFusionServiceToolId } from '@/lib/internal/oracle-fusion-service/schema'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = `${ORIGIN}/crmRestApi/resources/11.13.18.05`
const AUTH = {
  instanceUrl: ORIGIN,
  accessToken: Buffer.from('user:password').toString('base64'),
}
const EXACT_ID = '999999999999999999'

function record(path: string, fields: Record<string, unknown>) {
  return { ...fields, '@context': { links: [{ rel: 'self', href: `${ROOT}/${path}` }] } }
}

function respond(value: unknown, status = 200) {
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

function run(toolId: OracleFusionServiceToolId, input: Record<string, unknown> = {}) {
  return executeOracleFusionServiceOperation(toolId, { ...AUTH, ...input })
}

function request() {
  const [url, , init] = mocks.fetch.mock.calls.at(-1)!
  return { url: new URL(url), init }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateUrl.mockResolvedValue({
    isValid: true,
    resolvedIP: '203.0.113.10',
    originalHostname: 'vision.fa.us2.oraclecloud.com',
  })
})

describe('Fusion Service reads through the foundation transport', () => {
  it('projects documented fields, preserves IDs, and exposes the next page offset', async () => {
    respond({
      items: [
        record('serviceRequests/SR%2042', {
          SrNumber: 'SR 42',
          SrId: EXACT_ID,
          Title: 'Help',
          UndocumentedField: 'excluded',
        }),
      ],
      count: 1,
      hasMore: true,
      limit: 2,
      offset: 7,
    })
    const result = await run('oracle_fusion_service_list_service_requests', {
      limit: 2,
      offset: 7,
      q: "StatusCd='CUSTOM_NEW'",
      orderBy: 'LastUpdateDate:desc',
    })
    expect(request().url.pathname).toBe('/crmRestApi/resources/11.13.18.05/serviceRequests')
    expect(request().url.searchParams.get('q')).toBe("StatusCd='CUSTOM_NEW'")
    expect(request().init.method).toBe('GET')
    expect(result.output).toMatchObject({
      items: [{ SrNumber: 'SR 42', SrId: EXACT_ID, Title: 'Help' }],
      nextOffset: 8,
      count: 1,
    })
    expect(result.output.items?.[0]).not.toHaveProperty('UndocumentedField')
  })

  it('uses the enabled service-request status finder without a guessed enum', async () => {
    respond({ items: [], count: 0, hasMore: false, limit: 50, offset: 0 })
    const result = await run('oracle_fusion_service_list_service_request_statuses')
    expect(request().url.searchParams.get('finder')).toBe(
      'IsEnabledFinder;BindChildLookupType=ORA_SVC_SR_STATUS_CD,BindParentLookupType=ORA_SVC_SR_STATUS_TYPE_CD'
    )
    expect(result.output.nextOffset).toBeUndefined()
  })

  it('preserves message content without guessing encoding or exposing attachments', async () => {
    respond(
      record('serviceRequests/SR1/child/messages/42', {
        MessageId: 42,
        MessageContent: 'SGVsbG8=',
        VisibilityCd: 'ORA_SVC_INTERNAL',
        attachments: [{ secret: 'not-an-output' }],
      })
    )
    const result = await run('oracle_fusion_service_get_service_request_message', {
      srNumber: 'SR1',
      messageId: '42',
    })
    expect(result.output.item).toEqual({
      MessageId: '42',
      MessageContent: 'SGVsbG8=',
      VisibilityCd: 'ORA_SVC_INTERNAL',
    })
  })

  it.each([
    [
      'oracle_fusion_service_get_account',
      'accounts',
      { partyNumber: 'PARTY 42' },
      { PartyNumber: 'PARTY 42', PartyId: EXACT_ID },
      'PARTY%2042',
    ],
    [
      'oracle_fusion_service_get_contact',
      'contacts',
      { partyNumber: 'PARTY 42' },
      { PartyNumber: 'PARTY 42', PartyId: EXACT_ID },
      'PARTY%2042',
    ],
    [
      'oracle_fusion_service_get_resource',
      'resources',
      { partyNumber: 'PARTY 42' },
      { PartyNumber: 'PARTY 42', PartyId: EXACT_ID },
      'PARTY%2042',
    ],
    [
      'oracle_fusion_service_get_queue',
      'queues',
      { queueId: EXACT_ID },
      { QueueId: EXACT_ID },
      EXACT_ID,
    ],
    [
      'oracle_fusion_service_get_service_business_unit',
      'serviceBusinessUnits',
      { businessUnitId: EXACT_ID },
      { BUOrgId: EXACT_ID },
      EXACT_ID,
    ],
  ] as const)(
    'uses the documented directory key for %s',
    async (tool, path, input, fields, key) => {
      respond(record(`${path}/${key}`, fields))
      expect((await run(tool, input)).output.item).toEqual(fields)
      expect(request().url.pathname).toBe(`/crmRestApi/resources/11.13.18.05/${path}/${key}`)
    }
  )

  it('rejects a response belonging to a different child parent', async () => {
    respond(record('serviceRequests/OTHER/child/contacts/42', { MemberId: 42 }))
    await expect(
      run('oracle_fusion_service_get_service_request_contact', {
        srNumber: 'SR1',
        memberId: '42',
      })
    ).rejects.toThrow()
  })

  it('rejects fractional identifiers and contradictory pagination', async () => {
    respond(record('queues/42', { QueueId: 1.25 }))
    await expect(run('oracle_fusion_service_get_queue', { queueId: '42' })).rejects.toThrow()
    respond({ items: [], count: 1, hasMore: false, limit: 50, offset: 0 })
    await expect(run('oracle_fusion_service_list_queues')).rejects.toThrow()
  })
})

describe('Fusion Service mutations', () => {
  it('requires the business unit and serializes IDs without rounding', async () => {
    await expect(
      run('oracle_fusion_service_create_service_request', { title: 'Help' })
    ).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
    respond(record('serviceRequests/SR1', { SrNumber: 'SR1', BUOrgId: EXACT_ID }), 201)
    await run('oracle_fusion_service_create_service_request', {
      title: 'Help',
      businessUnitId: EXACT_ID,
      contactPartyId: '42',
    })
    expect(request().init.body).toBe(
      '{"Title":"Help","BUOrgId":999999999999999999,"PrimaryContactPartyId":42}'
    )
    expect(request().init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.oracle.adf.resourceitem+json',
        'REST-Framework-Version': '9',
      },
    })
  })

  it('assigns using AssigneeResourceId, not PartyNumber or ResourceProfileId', async () => {
    respond(record('serviceRequests/SR1', { SrNumber: 'SR1' }))
    await run('oracle_fusion_service_assign_service_request', {
      srNumber: 'SR1',
      resourcePartyId: EXACT_ID,
      queueId: '42',
      ifMatch: 'etag',
    })
    expect(request().init).toMatchObject({
      method: 'PATCH',
      body: '{"AssigneeResourceId":999999999999999999,"QueueId":42}',
      headers: { 'If-Match': 'etag' },
    })
  })

  it('transitions to a tenant-defined status with resolution details', async () => {
    respond(record('serviceRequests/SR1', { SrNumber: 'SR1', StatusCd: 'CUSTOM_DONE' }))
    await run('oracle_fusion_service_transition_service_request_status', {
      srNumber: 'SR1',
      statusCode: 'CUSTOM_DONE',
      resolveDescription: 'Resolved with customer',
    })
    expect(JSON.parse(request().init.body)).toEqual({
      StatusCd: 'CUSTOM_DONE',
      ResolveDescription: 'Resolved with customer',
    })
  })

  it('updates only requested fields, including an explicitly empty description', async () => {
    respond(record('serviceRequests/SR1', { SrNumber: 'SR1' }))
    await run('oracle_fusion_service_update_service_request', {
      srNumber: 'SR1',
      problemDescription: '',
    })
    expect(JSON.parse(request().init.body)).toEqual({ ProblemDescription: '' })
  })

  it('runs assignment at the collection action and preserves false', async () => {
    respond({ result: 'Queued' })
    const result = await run('oracle_fusion_service_run_queue_assignment', {
      srNumber: 'SR1',
      overrideQueue: false,
    })
    expect(request().url.pathname).toBe(
      '/crmRestApi/resources/11.13.18.05/serviceRequests/action/runQueueAssignment'
    )
    expect(request().init).toMatchObject({
      body: '{"srNumber":"SR1","overrideQueueFlag":false}',
      headers: { 'Content-Type': 'application/vnd.oracle.adf.action+json' },
    })
    expect(result.output).toEqual({ result: 'Queued' })
  })

  it.each([
    [
      'oracle_fusion_service_add_service_request_contact',
      'contacts',
      { contactPartyId: EXACT_ID, primaryContact: false },
      '{"PartyId":999999999999999999,"PrimaryContactFlag":false}',
    ],
    [
      'oracle_fusion_service_add_service_request_resource',
      'resourceMembers',
      { resourcePartyId: EXACT_ID, owner: false },
      '{"ObjectId":999999999999999999,"OwnerFlag":false}',
    ],
  ] as const)('adds the documented membership for %s', async (tool, child, input, body) => {
    respond(record(`serviceRequests/SR1/child/${child}/42`, { MemberId: 42 }), 201)
    await run(tool, { srNumber: 'SR1', ...input })
    expect(request().init.body).toBe(body)
    expect(request().url.pathname).toBe(
      `/crmRestApi/resources/11.13.18.05/serviceRequests/SR1/child/${child}`
    )
  })

  it.each([
    ['oracle_fusion_service_remove_service_request_contact', 'contacts'],
    ['oracle_fusion_service_remove_service_request_resource', 'resourceMembers'],
  ] as const)('removes only the membership for %s and accepts 204', async (tool, child) => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await run(tool, { srNumber: 'SR1', memberId: '42' })).output).toEqual({ deleted: true })
    expect(request().url.pathname).toBe(
      `/crmRestApi/resources/11.13.18.05/serviceRequests/SR1/child/${child}/42`
    )
    expect(request().init.method).toBe('DELETE')
    expect(request().init.body).toBeUndefined()
  })

  it.each([
    ['oracle_fusion_service_assign_service_request', { srNumber: 'SR1' }],
    ['oracle_fusion_service_update_service_request', { srNumber: 'SR1', ifMatch: 'etag' }],
    ['oracle_fusion_service_get_service_request', { srNumber: '../queues' }],
    ['oracle_fusion_service_get_queue', { queueId: Number(EXACT_ID) }],
    ['oracle_fusion_service_update_service_request', { srNumber: 'SR1', StatusCd: 'CUSTOM' }],
  ] as const)('rejects invalid input before network access for %s', async (tool, input) => {
    await expect(run(tool, input)).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('returns a safe conflict status without provider diagnostics or mutation retries', async () => {
    respond({ detail: 'provider-private-canary' }, 412)
    const response = await executeOracleFusionServiceTool({
      toolId: 'oracle_fusion_service_assign_service_request',
      input: { ...AUTH, srNumber: 'SR1', queueId: '42' },
      headers: new Headers(),
      context: { workflowId: 'workflow' },
      requestId: 'request',
    })
    expect(response.status).toBe(412)
    expect(await response.text()).not.toContain('provider-private-canary')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
