/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  checkGrafanaDataSourceHealth: vi.fn(),
  updateGrafanaAlertRule: vi.fn(),
  updateGrafanaDashboard: vi.fn(),
  updateGrafanaFolder: vi.fn(),
}))

vi.mock('@/lib/internal/grafana/operations', () => operations)

import { executeGrafanaTool } from '@/lib/internal/grafana/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function toolRequest(overrides: Partial<InternalToolOperationCall> = {}) {
  return {
    toolId: 'grafana_check_data_source_health',
    input: {
      apiKey: 'key',
      baseUrl: 'https://grafana.example.com',
      dataSourceUid: 'source-1',
    },
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

const CASES = [
  ['grafana_check_data_source_health', 'dataSourceUid', operations.checkGrafanaDataSourceHealth],
  ['grafana_update_alert_rule', 'alertRuleUid', operations.updateGrafanaAlertRule],
  ['grafana_update_dashboard', 'dashboardUid', operations.updateGrafanaDashboard],
  ['grafana_update_folder', 'folderUid', operations.updateGrafanaFolder],
] as const

describe('executeGrafanaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const [, , operation] of CASES) operation.mockResolvedValue({ success: true, output: {} })
  })

  it.each(CASES)(
    'dispatches %s to its authoritative operation',
    async (toolId, idField, operation) => {
      const input = {
        apiKey: 'key',
        baseUrl: 'https://grafana.example.com',
        [idField]: 'resource-1',
        ...(toolId === 'grafana_update_folder' ? { title: 'New' } : {}),
      }
      const response = await executeGrafanaTool(toolRequest({ toolId, input }))

      expect(response.status).toBe(200)
      expect(operation).toHaveBeenCalledWith(input, { requestId: 'request-1', signal: undefined })
    }
  )

  it('authenticates before validating input', async () => {
    const response = await executeGrafanaTool(
      toolRequest({ input: null, context: createExecutionContext({ workflowId: 'workflow-1' }) })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    })
    expect(operations.checkGrafanaDataSourceHealth).not.toHaveBeenCalled()
  })

  it('preserves exact contract validation details', async () => {
    const response = await executeGrafanaTool(toolRequest({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid input: expected string, received undefined',
      details: expect.any(Array),
    })
  })

  it('returns a non-2xx response when an operation reports failure', async () => {
    operations.updateGrafanaDashboard.mockResolvedValueOnce({
      success: false,
      output: {},
      error: 'Grafana rejected the update',
    })

    const response = await executeGrafanaTool(
      toolRequest({
        toolId: 'grafana_update_dashboard',
        input: {
          apiKey: 'key',
          baseUrl: 'https://grafana.example.com',
          dashboardUid: 'dashboard-1',
        },
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      output: {},
      error: 'Grafana rejected the update',
    })
  })
})
