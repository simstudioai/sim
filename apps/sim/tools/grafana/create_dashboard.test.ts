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

  it('creates an empty dashboard for blank panels', () => {
    expect(buildBody({ ...baseParams, panels: '   ' }).dashboard.panels).toEqual([])
  })

  it('refuses panels JSON that is not an array', () => {
    expect(() => buildBody({ ...baseParams, panels: '{"type": "timeseries"}' })).toThrow(
      'panels must be a JSON array'
    )
  })

  it('sends panels a block reference already resolved to an array', () => {
    const panels = [{ type: 'timeseries', title: 'Latency' }]
    const body = buildBody({ ...baseParams, panels: panels as unknown as string })
    expect(body.dashboard.panels).toEqual(panels)
  })
})
