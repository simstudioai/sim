import { describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/grafana/client', () => ({
  GrafanaClient: class {
    request = request
  },
}))

import { updateGrafanaDashboard, updateGrafanaFolder } from '@/lib/internal/grafana/operations'

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
