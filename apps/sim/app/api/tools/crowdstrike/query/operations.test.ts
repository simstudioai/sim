/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

import { MAX_ID_URL_BYTES } from '@/app/api/tools/crowdstrike/query/operations'
import { POST } from '@/app/api/tools/crowdstrike/query/route'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const credentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  cloud: 'us-1' as const,
}

function requestFor(body: Record<string, unknown>) {
  return createMockRequest('POST', { ...credentials, ...body })
}

describe('CrowdStrike extended operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)

    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token-123' }))
  })

  it('queries alerts and returns composite ids with pagination', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        meta: { pagination: { limit: 2, offset: 0, total: 7 } },
        resources: ['cid:aid:alert-1', 'cid:aid:alert-2'],
      })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_alerts', filter: 'status:"new"', limit: 2 })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output).toEqual({
      alertIds: ['cid:aid:alert-1', 'cid:aid:alert-2'],
      count: 2,
      pagination: { limit: 2, offset: 0, total: 7 },
    })

    const queryUrl = new URL(fetchMock.mock.calls[1][0])
    expect(queryUrl.pathname).toBe('/alerts/queries/alerts/v2')
    expect(queryUrl.searchParams.get('filter')).toBe('status:"new"')
    expect(queryUrl.searchParams.get('limit')).toBe('2')
  })

  it('normalizes alert details from documented fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [
          {
            composite_id: 'cid:aid:alert-1',
            id: 'alert-1',
            severity: 70,
            severity_name: 'High',
            status: 'new',
            tags: ['triage'],
            device: { device_id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', hostname: 'web-01' },
          },
        ],
      })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_alert_details',
        compositeIds: ['cid:aid:alert-1'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.count).toBe(1)
    expect(data.output.alerts[0]).toMatchObject({
      compositeId: 'cid:aid:alert-1',
      id: 'alert-1',
      severity: 70,
      severityName: 'High',
      status: 'new',
      tags: ['triage'],
      deviceId: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      hostname: 'web-01',
    })

    const [, detailsCall] = fetchMock.mock.calls
    expect(JSON.parse(detailsCall[1].body)).toEqual({ composite_ids: ['cid:aid:alert-1'] })
  })

  it('builds documented action parameters when updating alerts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ meta: {}, errors: [] }))

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_alerts',
        compositeIds: ['cid:aid:alert-1'],
        updateStatus: 'closed',
        appendComment: 'Resolved by automation',
        showInUi: false,
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.updatedIds).toEqual(['cid:aid:alert-1'])

    const [, updateCall] = fetchMock.mock.calls
    expect(updateCall[1].method).toBe('PATCH')
    expect(JSON.parse(updateCall[1].body)).toEqual({
      action_parameters: [
        { name: 'update_status', value: 'closed' },
        { name: 'append_comment', value: 'Resolved by automation' },
        { name: 'show_in_ui', value: 'false' },
      ],
      composite_ids: ['cid:aid:alert-1'],
    })
  })

  it('rejects an alert update that carries no action', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_alerts',
        compositeIds: ['cid:aid:alert-1'],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('contains hosts through the documented action endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          resources: [
            { id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', path: '/devices/entities/devices/v1' },
          ],
        },
        202
      )
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'contain',
        deviceIds: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.affected).toEqual([
      { id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', path: '/devices/entities/devices/v1' },
    ])

    const actionUrl = new URL(fetchMock.mock.calls[1][0])
    expect(actionUrl.pathname).toBe('/devices/entities/devices-actions/v2')
    expect(actionUrl.searchParams.get('action_name')).toBe('contain')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      ids: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
    })
  })

  it('rejects an unsupported host action', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'delete_host',
        deviceIds: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('adds hosts to a group with a device_id FQL filter', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [{ id: 'group-1', name: 'SOC' }] }))

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_group_action',
        actionName: 'add-hosts',
        hostGroupId: 'group-1',
        deviceIds: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.hostGroups[0]).toMatchObject({ id: 'group-1', name: 'SOC' })

    const groupUrl = new URL(fetchMock.mock.calls[1][0])
    expect(groupUrl.pathname).toBe('/devices/entities/host-group-actions/v1')
    expect(groupUrl.searchParams.get('action_name')).toBe('add-hosts')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action_parameters: [
        {
          name: 'filter',
          value:
            "(device_id:['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1','b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'])",
        },
      ],
      ids: ['group-1'],
    })
  })

  it('treats a 200 with only envelope errors as a failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [],
        errors: [{ code: 404, id: 'ioc-1', message: 'Indicator not found' }],
      })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_get_indicator_details', indicatorIds: ['ioc-1'] })
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Indicator not found')
  })

  it('falls back to 502 when a 200 carries errors without a usable code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ resources: [], errors: [{ message: 'Upstream unavailable' }] })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_get_indicator_details', indicatorIds: ['ioc-1'] })
    )
    const data = await response.json()

    expect(response.status).toBe(502)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Upstream unavailable')
  })

  it('fails an alert update when the meta-only envelope reports any error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ meta: {}, errors: [{ code: 403, message: 'Alert is read only' }] })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_alerts',
        compositeIds: ['cid:aid:alert-1'],
        updateStatus: 'closed',
      })
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Alert is read only')
  })

  it('sends remove_tags_by_prefix using the documented action parameter name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ meta: {}, errors: [] }))

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_alerts',
        compositeIds: ['cid:aid:alert-1'],
        removeTagsByPrefix: 'auto-',
      })
    )

    expect(response.status).toBe(200)

    const [, updateCall] = fetchMock.mock.calls
    expect(JSON.parse(updateCall[1].body).action_parameters).toEqual([
      { name: 'remove_tags_by_prefix', value: 'auto-' },
    ])
  })

  it('surfaces envelope errors alongside partial indicator results', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [{ id: 'ioc-1', type: 'sha256', value: 'abc', action: 'prevent' }],
        errors: [{ code: 404, id: 'ioc-2', message: 'Indicator not found' }],
      })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_indicator_details',
        indicatorIds: ['ioc-1', 'ioc-2'],
      })
    )
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(data.output.count).toBe(1)
    expect(data.output.errors).toEqual([{ code: 404, id: 'ioc-2', message: 'Indicator not found' }])
  })

  it('deletes indicators by filter without an ids list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: ['ioc-1'] }))

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_delete_indicators',
        filter: "source:'automation'",
        comment: 'cleanup',
      })
    )
    const data = await response.json()

    expect(data.output.deletedIds).toEqual(['ioc-1'])

    const deleteUrl = new URL(fetchMock.mock.calls[1][0])
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(deleteUrl.searchParams.get('filter')).toBe("source:'automation'")
    expect(deleteUrl.searchParams.getAll('ids')).toEqual([])
    expect(deleteUrl.searchParams.get('comment')).toBe('cleanup')
  })

  it('rejects a delete that supplies both ids and a filter', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_delete_indicators',
        filter: "source:'automation'",
        indicatorIds: ['ioc-9'],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects a host agent ID that is not a 32-character AID', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'contain',
        deviceIds: ["not-an-aid') or (device_id:['*'"],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects an alert update that both assigns and unassigns', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_alerts',
        compositeIds: ['cid:aid:alert-1'],
        assignToUuid: 'user-uuid',
        unassign: true,
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects an indicator update whose entry carries no id', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_indicators',
        indicators: [{ action: 'prevent' }],
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('id') })
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects an indicator update that tries to change the immutable type or value', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_indicators',
        indicators: [{ id: 'ioc-1', value: 'evil.example' }],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects an indicator create that omits the required applied_globally scope', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_create_indicators',
        indicators: [{ type: 'sha256', value: 'a'.repeat(64), action: 'prevent' }],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects a write-tier RTR base command on the read-scoped endpoint', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_execute_rtr_command',
        sessionId: 'session-1',
        baseCommand: 'eventlog backup',
        commandString: 'eventlog backup Security',
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('routes an aggregate request to the US-3 cloud', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [] }))

    const response = await POST(
      createMockRequest('POST', {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        cloud: 'us-3',
        operation: 'crowdstrike_query_sensors',
      })
    )

    expect(response.status).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.us-3.crowdstrike.com/oauth2/token')
    expect(new URL(fetchMock.mock.calls[1][0]).host).toBe('api.us-3.crowdstrike.com')
  })

  it('rejects an aggregate query that names neither a field nor a type', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_sensor_aggregates',
        aggregateQuery: { size: 10 },
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('forwards the percents and filters_spec aggregate fields instead of stripping them', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [] }))

    const aggregateQuery = {
      field: 'status',
      name: 'by-status',
      percents: [50, 95],
      filters_spec: { filters: { stale: "status:'inactive'" }, other_bucket: true },
    }

    await POST(requestFor({ operation: 'crowdstrike_get_sensor_aggregates', aggregateQuery }))

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(aggregateQuery)
  })

  it('rejects a delete with neither ids nor a filter', async () => {
    const response = await POST(requestFor({ operation: 'crowdstrike_delete_indicators' }))

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('requires a filter for Spotlight vulnerability queries', async () => {
    const response = await POST(requestFor({ operation: 'crowdstrike_query_vulnerabilities' }))

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('returns Spotlight cursor pagination', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        meta: { pagination: { after: 'cursor-1', limit: 1, total: 12 } },
        resources: ['vuln-1'],
      })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_vulnerabilities', filter: 'status:"open"' })
    )
    const data = await response.json()

    expect(data.output).toEqual({
      vulnerabilityIds: ['vuln-1'],
      count: 1,
      pagination: { after: 'cursor-1', limit: 1, total: 12 },
    })
  })

  it('normalizes nested vulnerability details', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [
          {
            id: 'vuln-1',
            aid: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            status: 'open',
            cve: {
              id: 'CVE-2026-0001',
              base_score: 9.8,
              severity: 'CRITICAL',
              cisa_info: { is_cisa_kev: true, due_date: '2026-09-01' },
            },
            host_info: { hostname: 'web-01', groups: [{ id: 'g1', name: 'SOC' }], tags: ['prod'] },
            remediation: { ids: ['rem-1'], entities: [{ id: 'rem-1', title: 'Patch now' }] },
          },
        ],
      })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_vulnerability_details',
        vulnerabilityIds: ['vuln-1'],
      })
    )
    const data = await response.json()

    const vulnerability = data.output.vulnerabilities[0]
    expect(vulnerability.cve).toMatchObject({
      id: 'CVE-2026-0001',
      baseScore: 9.8,
      severity: 'CRITICAL',
      isCisaKev: true,
      cisaDueDate: '2026-09-01',
    })
    expect(vulnerability.hostInfo).toMatchObject({ hostname: 'web-01', groups: ['SOC'] })
    expect(vulnerability.remediationIds).toEqual(['rem-1'])
    expect(vulnerability.remediations[0]).toMatchObject({ id: 'rem-1', title: 'Patch now' })
  })

  it('opens and closes a Real Time Response session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          resources: [
            {
              session_id: 'session-1',
              device_id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
              pwd: 'C:\\',
              offline_queued: false,
              existing_aid_sessions: 0,
              created_at: '2026-08-15T00:00:00Z',
            },
          ],
        },
        201
      )
    )

    const initResponse = await POST(
      requestFor({
        operation: 'crowdstrike_init_rtr_session',
        deviceId: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      })
    )
    const initData = await initResponse.json()

    expect(initData.output).toMatchObject({
      sessionId: 'session-1',
      deviceId: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      pwd: 'C:\\',
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      device_id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token-123' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ meta: {} }))

    const deleteResponse = await POST(
      requestFor({ operation: 'crowdstrike_delete_rtr_session', sessionId: 'session-1' })
    )
    const deleteData = await deleteResponse.json()

    expect(deleteData.output).toMatchObject({ sessionId: 'session-1', deleted: true })
    const deleteUrl = new URL(fetchMock.mock.calls[3][0])
    expect(deleteUrl.pathname).toBe('/real-time-response/entities/sessions/v1')
    expect(deleteUrl.searchParams.get('session_id')).toBe('session-1')
  })

  it('defaults the RTR command status sequence to zero', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [
          {
            session_id: 'session-1',
            complete: true,
            stdout: 'Directory listing',
            stderr: '',
            base_command: 'ls',
            sequence_id: 0,
          },
        ],
      })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_get_rtr_command_status', cloudRequestId: 'req-1' })
    )
    const data = await response.json()

    expect(data.output).toMatchObject({ complete: true, stdout: 'Directory listing' })
    const statusUrl = new URL(fetchMock.mock.calls[1][0])
    expect(statusUrl.searchParams.get('cloud_request_id')).toBe('req-1')
    expect(statusUrl.searchParams.get('sequence_id')).toBe('0')
  })

  it('normalizes Case Management case details', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [
          {
            id: 'case-1',
            name: 'Suspicious login',
            status: 'In Progress',
            severity: 3,
            severity_info: { level: 'High' },
            reference_id: 'CASE-42',
            assigned_to: { uuid: 'u-1', email: 'a@example.com', full_name: 'Analyst One' },
            template: { id: 't-1', name: 'Triage' },
            read_only: { is_read_only: false },
            tags: ['phishing'],
          },
        ],
      })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_get_case_details', caseIds: ['case-1'] })
    )
    const data = await response.json()

    expect(data.output.cases[0]).toMatchObject({
      id: 'case-1',
      name: 'Suspicious login',
      status: 'In Progress',
      severity: 3,
      severityLevel: 'High',
      referenceId: 'CASE-42',
      assignedTo: { uuid: 'u-1', email: 'a@example.com', fullName: 'Analyst One' },
      templateName: 'Triage',
      isReadOnly: false,
      tags: ['phishing'],
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ids: ['case-1'] })
  })

  it('propagates a CrowdStrike error status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ code: 403, message: 'access denied' }] }, 403)
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_host_groups', filter: 'name:"SOC"' })
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ success: false, error: 'access denied' })
  })

  it('fails an alert query whose 200 envelope carries only errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [],
        errors: [{ code: 403, id: null, message: 'insufficient scope' }],
      })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_alerts', filter: 'status:"new"' })
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ success: false, error: 'insufficient scope' })
  })

  it('fails a case query whose 200 envelope carries only errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [],
        errors: [{ code: 500, id: null, message: 'case service unavailable' }],
      })
    )

    const response = await POST(requestFor({ operation: 'crowdstrike_query_cases' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ success: false, error: 'case service unavailable' })
  })

  it('still reports a genuinely empty alert query as a success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [], errors: [] }))

    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_alerts', filter: 'status:"new"' })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.alertIds).toEqual([])
    expect(data.output.count).toBe(0)
  })

  it('rejects an indicator query that combines offset and after pagination', async () => {
    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_indicators', offset: 0, after: 'cursor-1' })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects a blank alert filter so Falcon never sees an empty FQL expression', async () => {
    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_alerts', filter: '   ' })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects a blank sensor filter instead of sending an empty FQL expression', async () => {
    const response = await POST(
      requestFor({ operation: 'crowdstrike_query_sensors', filter: '   ' })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects a blank sensor sort instead of sending an empty sort expression', async () => {
    const response = await POST(requestFor({ operation: 'crowdstrike_query_sensors', sort: '' }))

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('forwards trimmed sensor filter and sort values', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [] }))

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_query_sensors',
        filter: '  hostname:"dc-01"  ',
        sort: '  hostname.asc  ',
      })
    )

    expect(response.status).toBe(200)

    const queryUrl = new URL(fetchMock.mock.calls[1][0])
    expect(queryUrl.pathname).toBe('/identity-protection/queries/devices/v1')
    expect(queryUrl.searchParams.get('filter')).toBe('hostname:"dc-01"')
    expect(queryUrl.searchParams.get('sort')).toBe('hostname.asc')
  })

  it('fails an RTR session close whose 200 envelope reports an error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ meta: {}, errors: [{ code: 404, message: 'session not found' }] })
    )

    const response = await POST(
      requestFor({ operation: 'crowdstrike_delete_rtr_session', sessionId: 'session-1' })
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.success).toBe(false)
    expect(data.error).toBe('session not found')
  })

  it('fails a sensor query whose 200 envelope carries only errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [],
        errors: [{ code: 403, message: 'access denied for Identity Protection' }],
      })
    )

    const response = await POST(requestFor({ operation: 'crowdstrike_query_sensors' }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.success).toBe(false)
    expect(data.error).toBe('access denied for Identity Protection')
  })

  it('fails a sensor detail lookup whose 200 envelope carries only errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ resources: [], errors: [{ code: 403, message: 'access denied' }] })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_sensor_details',
        ids: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.success).toBe(false)
  })

  it('fails a sensor aggregate whose 200 envelope carries only errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ resources: [], errors: [{ code: 403, message: 'access denied' }] })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_sensor_aggregates',
        aggregateQuery: { field: 'status', name: 'by_status', type: 'terms' },
      })
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.success).toBe(false)
  })

  it('surfaces partial sensor errors alongside the sensors that resolved', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [{ device_id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', hostname: 'dc-01' }],
        errors: [
          { code: 404, id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', message: 'sensor not found' },
        ],
      })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_sensor_details',
        ids: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.count).toBe(1)
    expect(data.output.errors).toEqual([
      { code: 404, id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', message: 'sensor not found' },
    ])
  })

  it('preserves a scalar aggregate bucket label', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        resources: [{ name: 'by_status', buckets: [{ label: 'contained', count: 3 }] }],
      })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_get_sensor_aggregates',
        aggregateQuery: { field: 'status', name: 'by_status', type: 'terms' },
      })
    )
    const data = await response.json()

    expect(data.output.aggregates[0].buckets[0].label).toBe('contained')
  })

  it('rejects an indicator payload whose blank field would clear stored data', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_update_indicators',
        indicators: [{ id: 'ioc-1', description: '' }],
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects a host action targeting more than the documented 100 hosts', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'contain',
        deviceIds: Array.from({ length: 101 }, (_, index) => `aid-${index}`),
      })
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('accepts the documented detection suppression host actions', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ resources: [{ id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' }] })
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'detection_suppress',
        deviceIds: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
      })
    )

    expect(response.status).toBe(200)
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('action_name')).toBe(
      'detection_suppress'
    )
  })

  describe('by-ids URL byte budget', () => {
    /** Long enough that the contract maxima would generate a URL past any proxy limit. */
    function longIds(count: number, prefix: string): string[] {
      return Array.from({ length: count }, (_, index) =>
        `${prefix}-${String(index).padStart(4, '0')}`.padEnd(64, 'x')
      )
    }

    function idsFromUrl(rawUrl: string): string[] {
      return new URL(rawUrl).searchParams.getAll('ids')
    }

    /** The 8 KB request line + header cap common to proxies and load balancers. */
    const PROXY_REQUEST_LINE_LIMIT = 8192

    it('keeps the budget under the request-line limit proxies enforce', () => {
      expect(MAX_ID_URL_BYTES).toBeLessThanOrEqual(PROXY_REQUEST_LINE_LIMIT)
    })

    it('splits an oversized indicator lookup into batches that each stay under the URL budget', async () => {
      const indicatorIds = longIds(300, 'ioc')

      fetchMock.mockImplementation((rawUrl: string) =>
        Promise.resolve(
          jsonResponse({
            meta: { pagination: { limit: 1, offset: 0, total: 300 } },
            resources: idsFromUrl(rawUrl).map((id) => ({ id, type: 'sha256', value: id })),
          })
        )
      )

      const response = await POST(
        requestFor({ operation: 'crowdstrike_get_indicator_details', indicatorIds })
      )
      const data = await response.json()

      const lookupUrls = fetchMock.mock.calls.slice(1).map((call) => String(call[0]))
      expect(lookupUrls.length).toBeGreaterThan(1)
      for (const url of lookupUrls) {
        expect(url.length).toBeLessThanOrEqual(MAX_ID_URL_BYTES)
      }

      expect(response.status).toBe(200)
      expect(data.output.count).toBe(300)
      expect(data.output.indicators.map((indicator: { id: string }) => indicator.id)).toEqual(
        indicatorIds
      )
      expect(lookupUrls.flatMap(idsFromUrl)).toEqual(indicatorIds)
    })

    it('merges the envelope errors every batch reported', async () => {
      const indicatorIds = longIds(300, 'ioc')

      fetchMock.mockImplementation((rawUrl: string) => {
        const ids = idsFromUrl(rawUrl)
        return Promise.resolve(
          jsonResponse({
            resources: ids.slice(1).map((id) => ({ id, type: 'sha256', value: id })),
            errors: [{ code: 404, id: ids[0], message: 'Indicator not found' }],
          })
        )
      })

      const response = await POST(
        requestFor({ operation: 'crowdstrike_get_indicator_details', indicatorIds })
      )
      const data = await response.json()

      const batchCount = fetchMock.mock.calls.length - 1
      expect(batchCount).toBeGreaterThan(1)
      expect(data.output.errors).toHaveLength(batchCount)
    })

    it('surfaces an upstream failure raised by a later batch instead of swallowing it', async () => {
      const indicatorIds = longIds(300, 'ioc')
      let lookupCall = 0

      fetchMock.mockImplementation((rawUrl: string) => {
        lookupCall += 1
        if (lookupCall === 2) {
          return Promise.resolve(
            jsonResponse({ errors: [{ code: 429, message: 'Rate limit exceeded' }] }, 429)
          )
        }
        return Promise.resolve(
          jsonResponse({
            resources: idsFromUrl(rawUrl).map((id) => ({ id, type: 'sha256', value: id })),
          })
        )
      })

      const response = await POST(
        requestFor({ operation: 'crowdstrike_get_indicator_details', indicatorIds })
      )
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Rate limit exceeded')
    })

    /**
     * A batched delete has no rollback: every batch that answered `ok` really removed
     * its indicators. Reporting only the failing batch's message would leave the
     * caller unable to tell what is already gone, and a blind retry would re-target
     * IDs that no longer exist.
     */
    it('names the indicators earlier batches already deleted when a later batch fails', async () => {
      const indicatorIds = longIds(300, 'ioc')
      let deleteCall = 0
      const deletedByFirstBatch: string[] = []

      fetchMock.mockImplementation((rawUrl: string) => {
        deleteCall += 1
        if (deleteCall === 2) {
          return Promise.resolve(
            jsonResponse({ errors: [{ code: 429, message: 'Rate limit exceeded' }] }, 429)
          )
        }
        const ids = idsFromUrl(rawUrl)
        deletedByFirstBatch.push(...ids)
        return Promise.resolve(jsonResponse({ resources: ids }))
      })

      const response = await POST(
        requestFor({ operation: 'crowdstrike_delete_indicators', indicatorIds })
      )
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.success).toBe(false)
      expect(deletedByFirstBatch.length).toBeGreaterThan(0)
      expect(data.error).toContain('Rate limit exceeded')
      expect(data.error).toContain(`${deletedByFirstBatch.length} ID(s) were already deleted`)
      expect(data.error).toContain(deletedByFirstBatch[0])
    })

    /**
     * A batch can answer 200 while reporting per-ID failures in `errors`. Recording
     * the requested chunk would name indicators that are still live and tell the
     * caller to drop them from the retry, so only the IDs Falcon echoed in
     * `resources` count as committed.
     */
    it('reports only the IDs Falcon confirmed, not every ID in a partly-failed batch', async () => {
      const indicatorIds = longIds(300, 'ioc')
      let deleteCall = 0
      let skipped = ''
      const confirmed: string[] = []

      fetchMock.mockImplementation((rawUrl: string) => {
        deleteCall += 1
        if (deleteCall === 2) {
          return Promise.resolve(
            jsonResponse({ errors: [{ code: 429, message: 'Rate limit exceeded' }] }, 429)
          )
        }
        const ids = idsFromUrl(rawUrl)
        skipped = ids[0]
        confirmed.push(...ids.slice(1))
        return Promise.resolve(
          jsonResponse({
            resources: ids.slice(1),
            errors: [{ code: 404, id: ids[0], message: 'Indicator not found' }],
          })
        )
      })

      const response = await POST(
        requestFor({ operation: 'crowdstrike_delete_indicators', indicatorIds })
      )
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(confirmed.length).toBeGreaterThan(0)
      expect(data.error).toContain(`${confirmed.length} ID(s) were already deleted`)
      expect(data.error).not.toContain(skipped)
    })

    /**
     * A 2xx envelope carrying per-ID errors is a partial success, not a failure —
     * `failedWithoutResources` only fails the operation when nothing came back at
     * all. The batched path must report it exactly as a single request would:
     * `deletedIds` names what Falcon confirmed and `errors` names what it refused,
     * which is stricter reconciliation than the prose message the transport-failure
     * path has to fall back on. A retry excludes `deletedIds`.
     */
    it('reports a 2xx per-ID delete failure as partial success, matching an unbatched request', async () => {
      const indicatorIds = longIds(300, 'ioc')
      let deleteCall = 0
      let refused = ''

      fetchMock.mockImplementation((rawUrl: string) => {
        deleteCall += 1
        const ids = idsFromUrl(rawUrl)
        if (deleteCall === 2) {
          refused = ids[0]
          return Promise.resolve(
            jsonResponse({
              resources: ids.slice(1),
              errors: [{ code: 404, id: ids[0], message: 'Indicator not found' }],
            })
          )
        }
        return Promise.resolve(jsonResponse({ resources: ids }))
      })

      const response = await POST(
        requestFor({ operation: 'crowdstrike_delete_indicators', indicatorIds })
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(refused).not.toBe('')
      expect(data.output.deletedIds).not.toContain(refused)
      expect(data.output.count).toBe(indicatorIds.length - 1)
      expect(data.output.errors).toContainEqual(expect.objectContaining({ id: refused, code: 404 }))
    })

    it('leaves a first-batch delete failure unannotated — nothing was committed', async () => {
      const indicatorIds = longIds(300, 'ioc')

      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ errors: [{ code: 403, message: 'Access denied' }] }, 403))
      )

      const response = await POST(
        requestFor({ operation: 'crowdstrike_delete_indicators', indicatorIds })
      )
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Access denied')
    })

    it('splits an oversized vulnerability lookup at the Spotlight cap', async () => {
      const vulnerabilityIds = longIds(400, 'vuln')

      fetchMock.mockImplementation((rawUrl: string) =>
        Promise.resolve(
          jsonResponse({
            resources: idsFromUrl(rawUrl).map((id) => ({ id })),
          })
        )
      )

      const response = await POST(
        requestFor({ operation: 'crowdstrike_get_vulnerability_details', vulnerabilityIds })
      )
      const data = await response.json()

      const lookupUrls = fetchMock.mock.calls.slice(1).map((call) => String(call[0]))
      expect(lookupUrls.length).toBeGreaterThan(1)
      for (const url of lookupUrls) {
        expect(url.length).toBeLessThanOrEqual(MAX_ID_URL_BYTES)
      }
      expect(data.output.count).toBe(400)
    })

    it('keeps a filter-only delete on a single request', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ resources: ['ioc-1'] }))

      const response = await POST(
        requestFor({
          operation: 'crowdstrike_delete_indicators',
          filter: "source:'automation'",
          comment: 'cleanup',
        })
      )

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
