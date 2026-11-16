import { describe, expect, it } from 'vitest'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'

/**
 * On a tool call (Agent tool row, Pi, Human-in-the-loop v2) the mapper receives the stored row's
 * params merged with the model's args, without `operation`; the operation arrives only in
 * `context`. The executor spreads the mapper output over those merged params.
 */
function runToolCall(operation: string, merged: Record<string, unknown>) {
  const mapper = IncidentioBlock.tools.config?.params
  if (!mapper) throw new Error('incidentio block has no params mapper')
  return { ...merged, ...mapper(merged, { operation }) }
}

describe('incidentio mapper on tool calls', () => {
  it('applies block-only fields stored on the tool row', () => {
    expect(runToolCall('incidentio_users_list', { apiKey: 'k', user_email: 'a@b.com' }).email).toBe(
      'a@b.com'
    )
    const alert = runToolCall('incidentio_alert_events_create', {
      alert_title: 'Checkout latency',
      alert_status: 'firing',
    })
    expect(alert.title).toBe('Checkout latency')
    expect(alert.status).toBe('firing')
  })

  it("keeps the model's status over the seeded status dropdown", () => {
    const resolved = runToolCall('incidentio_actions_update', {
      id: 'act_1',
      description: 'Fail over',
      item_status: 'outstanding',
      status: 'completed',
    })
    expect(resolved.status).toBe('completed')
  })

  it('uses the status dropdown on the canvas', () => {
    const mapper = IncidentioBlock.tools.config?.params
    if (!mapper) throw new Error('incidentio block has no params mapper')
    const canvas = mapper({
      operation: 'incidentio_follow_ups_update',
      item_status: 'not_doing',
      follow_up_title: 'Add alerting',
    })
    expect(canvas.status).toBe('not_doing')
    expect(canvas.title).toBe('Add alerting')
  })

  it("doesn't filter a tool-call alert list by the tool row's seeded status", () => {
    const listed = runToolCall('incidentio_alerts_list', { apiKey: 'k', alert_status: 'firing' })
    expect(listed.status).toBeUndefined()
    const mapper = IncidentioBlock.tools.config?.params
    if (!mapper) throw new Error('incidentio block has no params mapper')
    expect(mapper({ alert_status: 'firing' }, { operation: 'incidentio_alerts_list' }).status).toBe(
      undefined
    )
    expect(
      runToolCall('incidentio_alerts_list', { alert_status: 'firing', status: 'resolved' }).status
    ).toBe('resolved')
  })

  it("leaves a workflow created without a state to the tool's draft default", () => {
    expect(runToolCall('incidentio_workflows_create', { name: 'Notify' }).state).toBeUndefined()
    expect(
      runToolCall('incidentio_workflows_create', { name: 'Notify', state: 'active' }).state
    ).toBe('active')
  })
})

describe('incidentio mapper on a block newly added in the editor', () => {
  /** The editor seeds dropdowns with `value({})`, so create operations start on the '' option. */
  const runCanvas = (params: Record<string, unknown>) => {
    const mapper = IncidentioBlock.tools.config?.params
    if (!mapper) throw new Error('incidentio block has no params mapper')
    return { ...params, ...mapper(params) }
  }

  it('creates a firing alert event', () => {
    const alert = runCanvas({
      operation: 'incidentio_alert_events_create',
      alert_status: '',
      alert_title: 'Disk full',
    })
    expect(alert.status).toBe('firing')
  })

  it('creates a schedule in UTC', () => {
    expect(runCanvas({ operation: 'incidentio_schedules_create', timezone: '' }).timezone).toBe(
      'UTC'
    )
    expect(
      runCanvas({ operation: 'incidentio_schedules_create', timezone: 'Europe/London' }).timezone
    ).toBe('Europe/London')
  })

  it('creates an active workflow', () => {
    expect(runCanvas({ operation: 'incidentio_workflows_create', state: '' }).state).toBe('active')
    expect(runCanvas({ operation: 'incidentio_workflows_create', state: 'draft' }).state).toBe(
      'draft'
    )
  })

  it("leaves an update's 'No change' options unset", () => {
    expect(runCanvas({ operation: 'incidentio_schedules_update', timezone: '' }).timezone).toBe('')
    expect(runCanvas({ operation: 'incidentio_workflows_update', state: '' }).state).toBe('')
  })
})
