import { describe, expect, it } from 'vitest'
import { createDashboardTool } from '@/tools/grafana/create_dashboard'
import type { GrafanaCreateDashboardParams } from '@/tools/grafana/types'

const baseParams: GrafanaCreateDashboardParams = {
  apiKey: 'test-key',
  baseUrl: 'https://grafana.example.com',
  title: 'Service overview',
}

const buildBody = (params: GrafanaCreateDashboardParams) => {
  const body = createDashboardTool.request.body
  if (!body) throw new Error('create dashboard has no request body')
  return body(params) as { dashboard: { panels: unknown } }
}

describe('grafana create dashboard panels', () => {
  it('refuses invalid panels JSON instead of creating an empty dashboard', () => {
    expect(() => buildBody({ ...baseParams, panels: '[{"type": "timeseries"' })).toThrow(
      'Invalid JSON for panels parameter'
    )
  })

  it('sends panels a tool call already passed as an array', () => {
    const panels = [{ type: 'timeseries', title: 'Latency' }]
    const body = buildBody({ ...baseParams, panels: panels as unknown as string })
    expect(body.dashboard.panels).toEqual(panels)
  })
})
