/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/grafana/client', () => ({
  GrafanaClient: class {
    request = request
  },
}))

import {
  checkGrafanaDataSourceHealth,
  updateGrafanaAlertRule,
  updateGrafanaDashboard,
  updateGrafanaFolder,
} from '@/lib/internal/grafana/operations'

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  }
}

const auth = { apiKey: 'key', baseUrl: 'https://grafana.example.com' }
const context = { requestId: 'request-1' }

describe('Grafana operations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns Grafana unhealthy verdicts as successful health checks', async () => {
    request.mockResolvedValue({
      success: true,
      response: response(
        { status: 'ERROR', message: 'dial tcp refused', details: { code: 1 } },
        400
      ),
    })

    await expect(
      checkGrafanaDataSourceHealth({ ...auth, dataSourceUid: 'a/../../admin' }, context)
    ).resolves.toEqual({
      success: true,
      output: { status: 'ERROR', message: 'dial tcp refused', details: { code: 1 } },
    })
    expect(request).toHaveBeenCalledWith('/api/datasources/uid/a%2F..%2F..%2Fadmin/health', {
      method: 'GET',
    })
  })

  it('fetches and merges a dashboard before updating once', async () => {
    request
      .mockResolvedValueOnce({
        success: true,
        response: response({
          dashboard: { uid: 'dash-1', title: 'Old', version: 7, untouched: true },
          meta: { folderUid: 'folder-1' },
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        response: response({ id: 1, uid: 'dash-1', status: 'success', version: 8 }),
      })

    const result = await updateGrafanaDashboard(
      {
        ...auth,
        dashboardUid: 'dash-1',
        title: 'New',
        tags: 'one, two',
        panels: '[{"id":1}]',
      },
      context
    )

    expect(result).toMatchObject({ success: true, output: { uid: 'dash-1', version: 8 } })
    expect(request).toHaveBeenNthCalledWith(2, '/api/dashboards/db', {
      method: 'POST',
      body: {
        dashboard: {
          uid: 'dash-1',
          title: 'New',
          version: 7,
          untouched: true,
          tags: ['one', 'two'],
          panels: [{ id: 1 }],
        },
        overwrite: false,
        folderUid: 'folder-1',
      },
    })
  })

  it('fails invalid alert JSON before the update request', async () => {
    request.mockResolvedValueOnce({
      success: true,
      response: response({ uid: 'rule-1', annotations: {} }),
    })

    await expect(
      updateGrafanaAlertRule({ ...auth, alertRuleUid: 'rule-1', annotations: '{not json' }, context)
    ).resolves.toEqual({
      success: false,
      output: {},
      error: 'Invalid JSON for annotations parameter',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('preserves folder version concurrency on update', async () => {
    request
      .mockResolvedValueOnce({
        success: true,
        response: response({ uid: 'folder-1', version: 4 }),
      })
      .mockResolvedValueOnce({
        success: true,
        response: response({ uid: 'folder-1', title: 'New', version: 5 }),
      })

    await updateGrafanaFolder({ ...auth, folderUid: 'folder-1', title: 'New' }, context)

    expect(request).toHaveBeenNthCalledWith(2, '/api/folders/folder-1', {
      method: 'PUT',
      body: { title: 'New', version: 4 },
    })
  })
})
