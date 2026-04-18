/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMock, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)

import { POST } from '@/app/api/tools/crowdstrike/query/route'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sensorResource = {
  agent_version: '6.1.0',
  cid: 'cid-1',
  device_id: 'sensor-1',
  heartbeat_time: 1700,
  hostname: 'host-1',
  idp_policy_id: 'policy-1',
  idp_policy_name: 'Default Policy',
  kerberos_config: 'configured',
  ldap_config: 'configured',
  ldaps_config: 'configured',
  local_ip: '10.0.0.1',
  machine_domain: 'corp.local',
  ntlm_config: 'configured',
  os_version: 'Windows Server 2022',
  rdp_to_dc_config: 'configured',
  smb_to_dc_config: 'configured',
  status: 'protected',
  status_causes: ['healthy'],
  ti_enabled: 'enabled',
}

const normalizedSensor = {
  agentVersion: '6.1.0',
  cid: 'cid-1',
  deviceId: 'sensor-1',
  heartbeatTime: 1700,
  hostname: 'host-1',
  idpPolicyId: 'policy-1',
  idpPolicyName: 'Default Policy',
  ipAddress: '10.0.0.1',
  kerberosConfig: 'configured',
  ldapConfig: 'configured',
  ldapsConfig: 'configured',
  machineDomain: 'corp.local',
  ntlmConfig: 'configured',
  osVersion: 'Windows Server 2022',
  rdpToDcConfig: 'configured',
  smbToDcConfig: 'configured',
  status: 'protected',
  statusCauses: ['healthy'],
  tiEnabled: 'enabled',
}

describe('CrowdStrike query route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)

    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })
  })

  it('hydrates sensor details after querying sensor ids', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123' }))
      .mockResolvedValueOnce(
        jsonResponse({
          meta: { pagination: { expires_at: 111, limit: 1, offset: 0, total: 1 } },
          resources: ['sensor-1'],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [sensorResource],
        })
      )

    const request = createMockRequest('POST', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      cloud: 'us-1',
      limit: 1,
      operation: 'crowdstrike_query_sensors',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.crowdstrike.com/identity-protection/queries/devices/v1?limit=1'
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.crowdstrike.com/identity-protection/entities/devices/GET/v1'
    )
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ ids: ['sensor-1'] }),
      method: 'POST',
    })
    expect(data.output).toEqual({
      count: 1,
      pagination: {
        limit: 1,
        offset: 0,
        total: 1,
      },
      sensors: [normalizedSensor],
    })
  })

  it('fetches sensor details directly from device ids', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123' }))
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [sensorResource],
        })
      )

    const request = createMockRequest('POST', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      cloud: 'us-1',
      ids: ['sensor-1'],
      operation: 'crowdstrike_get_sensor_details',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.crowdstrike.com/identity-protection/entities/devices/GET/v1'
    )
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ ids: ['sensor-1'] }),
      method: 'POST',
    })
    expect(data.output).toEqual({
      count: 1,
      pagination: null,
      sensors: [normalizedSensor],
    })
  })

  it('normalizes sensor aggregate results', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123' }))
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [
            {
              buckets: [
                {
                  count: 2,
                  key_as_string: 'protected',
                  sub_aggregates: [
                    {
                      buckets: [
                        {
                          count: 2,
                          key_as_string: 'corp.local',
                          value: 2,
                          value_as_string: '2',
                        },
                      ],
                      doc_count_error_upper_bound: 0,
                      name: 'machine_domain_counts',
                      sum_other_doc_count: 0,
                    },
                  ],
                  value: 2,
                  value_as_string: '2',
                },
              ],
              doc_count_error_upper_bound: 0,
              name: 'status_counts',
              sum_other_doc_count: 0,
            },
          ],
        })
      )

    const aggregateQuery = {
      field: 'status',
      name: 'status_counts',
      size: 10,
      type: 'terms',
    }

    const request = createMockRequest('POST', {
      aggregateQuery,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      cloud: 'us-1',
      operation: 'crowdstrike_get_sensor_aggregates',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.crowdstrike.com/identity-protection/aggregates/devices/GET/v1'
    )
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify(aggregateQuery),
      method: 'POST',
    })
    expect(data.output).toEqual({
      aggregates: [
        {
          buckets: [
            {
              count: 2,
              from: null,
              keyAsString: 'protected',
              label: null,
              stringFrom: null,
              stringTo: null,
              subAggregates: [
                {
                  buckets: [
                    {
                      count: 2,
                      from: null,
                      keyAsString: 'corp.local',
                      label: null,
                      stringFrom: null,
                      stringTo: null,
                      subAggregates: [],
                      to: null,
                      value: 2,
                      valueAsString: '2',
                    },
                  ],
                  docCountErrorUpperBound: 0,
                  name: 'machine_domain_counts',
                  sumOtherDocCount: 0,
                },
              ],
              to: null,
              value: 2,
              valueAsString: '2',
            },
          ],
          docCountErrorUpperBound: 0,
          name: 'status_counts',
          sumOtherDocCount: 0,
        },
      ],
      count: 1,
    })
  })
})
