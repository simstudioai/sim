import { describe, expect, it } from 'vitest'
import { getIncidentTool } from '@/tools/pagerduty/get_incident'
import { listIncidentsTool } from '@/tools/pagerduty/list_incidents'
import { mergeIncidentsTool } from '@/tools/pagerduty/merge_incidents'
import { sendEventTool } from '@/tools/pagerduty/send_event'
import type {
  PagerDutyListIncidentsParams,
  PagerDutySendEventParams,
  PagerDutyUpdateIncidentParams,
} from '@/tools/pagerduty/types'
import { updateIncidentTool } from '@/tools/pagerduty/update_incident'
import type { ToolConfig } from '@/tools/types'

function buildUrl<P>(tool: ToolConfig<P>, params: P): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params) : url
}

function buildBody<P>(tool: ToolConfig<P>, params: P): Record<string, unknown> {
  const body = tool.request.body
  if (!body) throw new Error('tool has no request body')
  return body(params) as Record<string, unknown>
}

describe('PagerDuty path ids', () => {
  it.each(['..', '../users', '.'])('rejects dot-segment incident id %j', (incidentId) => {
    expect(() => buildUrl(getIncidentTool, { apiKey: 'k', incidentId })).toThrow(/incidentId/)
  })

  it('encodes an id containing a query delimiter instead of truncating the path', () => {
    const url = buildUrl(mergeIncidentsTool, {
      apiKey: 'k',
      fromEmail: 'a@b.co',
      targetIncidentId: 'P1?x=1',
      sourceIncidentIds: 'P2',
    })
    expect(new URL(url).pathname).toBe('/incidents/P1%3Fx%3D1/merge')
  })
})

describe('PagerDuty update incident', () => {
  const base: PagerDutyUpdateIncidentParams = {
    apiKey: 'k',
    fromEmail: 'a@b.co',
    incidentId: 'P1',
    resolution: 'root cause fixed',
  }

  it('drops a leftover resolution when the status is not resolved', () => {
    const body = buildBody(updateIncidentTool, { ...base, status: 'acknowledged' })
    expect(body.incident).not.toHaveProperty('resolution')
    expect(body.incident).toMatchObject({ status: 'acknowledged' })
  })

  it('sends the resolution when resolving', () => {
    const body = buildBody(updateIncidentTool, { ...base, status: 'resolved' })
    expect(body.incident).toMatchObject({ status: 'resolved', resolution: 'root cause fixed' })
  })
})

describe('PagerDuty list total', () => {
  const base: PagerDutyListIncidentsParams = { apiKey: 'k' }

  it.each([true, 'true'])('requests the total count for includeTotal=%j', (includeTotal) => {
    const url = new URL(buildUrl(listIncidentsTool, { ...base, includeTotal }))
    expect(url.searchParams.get('total')).toBe('true')
  })

  it.each([undefined, false, 'false'])('omits total for includeTotal=%j', (includeTotal) => {
    const url = new URL(buildUrl(listIncidentsTool, { ...base, includeTotal }))
    expect(url.searchParams.has('total')).toBe(false)
  })
})

describe('PagerDuty send event custom details', () => {
  const trigger: PagerDutySendEventParams = {
    routingKey: 'r',
    eventAction: 'trigger',
    summary: 'disk full',
    source: 'host-1',
    severity: 'critical',
  }

  it.each([
    ['an object from a tool call', { region: 'us-east-1', errors: 3 }],
    ['a JSON string from the block', '{"region":"us-east-1","errors":3}'],
  ])('sends custom_details from %s', (_label, customDetails) => {
    const body = buildBody(sendEventTool, {
      ...trigger,
      customDetails,
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(body.payload).toMatchObject({
      custom_details: { region: 'us-east-1', errors: 3 },
      timestamp: '2026-01-01T00:00:00Z',
    })
  })

  it.each(['not json', '[1,2]'])(
    'rejects custom details %j that are not a JSON object',
    (value) => {
      expect(() => buildBody(sendEventTool, { ...trigger, customDetails: value })).toThrow(
        /customDetails/
      )
    }
  )
})
