/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

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
            device: { device_id: 'aid-1', hostname: 'web-01' },
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
      deviceId: 'aid-1',
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
      jsonResponse({ resources: [{ id: 'aid-1', path: '/devices/entities/devices/v1' }] }, 202)
    )

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'contain',
        deviceIds: ['aid-1'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.affected).toEqual([{ id: 'aid-1', path: '/devices/entities/devices/v1' }])

    const actionUrl = new URL(fetchMock.mock.calls[1][0])
    expect(actionUrl.pathname).toBe('/devices/entities/devices-actions/v2')
    expect(actionUrl.searchParams.get('action_name')).toBe('contain')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ids: ['aid-1'] })
  })

  it('rejects an unsupported host action', async () => {
    const response = await POST(
      requestFor({
        operation: 'crowdstrike_perform_host_action',
        actionName: 'delete_host',
        deviceIds: ['aid-1'],
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
        deviceIds: ['aid-1', 'aid-2'],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.hostGroups[0]).toMatchObject({ id: 'group-1', name: 'SOC' })

    const groupUrl = new URL(fetchMock.mock.calls[1][0])
    expect(groupUrl.pathname).toBe('/devices/entities/host-group-actions/v1')
    expect(groupUrl.searchParams.get('action_name')).toBe('add-hosts')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action_parameters: [{ name: 'filter', value: "(device_id:['aid-1','aid-2'])" }],
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

    expect(response.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Indicator not found')
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
    expect(data.output.errors).toEqual([
      { code: 404, id: 'ioc-2', message: 'Indicator not found' },
    ])
  })

  it('drops the ids list when deleting indicators by filter', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: ['ioc-1'] }))

    const response = await POST(
      requestFor({
        operation: 'crowdstrike_delete_indicators',
        filter: "source:'automation'",
        indicatorIds: ['ioc-9'],
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
            aid: 'aid-1',
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
              device_id: 'aid-1',
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
      requestFor({ operation: 'crowdstrike_init_rtr_session', deviceId: 'aid-1' })
    )
    const initData = await initResponse.json()

    expect(initData.output).toMatchObject({ sessionId: 'session-1', deviceId: 'aid-1', pwd: 'C:\\' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ device_id: 'aid-1' })

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
})
