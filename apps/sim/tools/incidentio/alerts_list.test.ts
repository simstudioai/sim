/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { alertsListTool } from '@/tools/incidentio/alerts_list'

/**
 * The executor merges the block's param transform over the raw inputs
 * (`{ ...inputs, ...transformedParams }`), so any subblock the transform leaves alone keeps its
 * raw editor value. The tri-state filter dropdowns default to the string 'any', which the
 * incident.io API rejects — these cover the whole path from editor value to query string.
 */
function resolveInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const transform = IncidentioBlock.tools.config!.params!
  return { ...inputs, ...transform(inputs as never) }
}

function buildUrl(params: Record<string, unknown>): URL {
  const url = alertsListTool.request.url
  return new URL(typeof url === 'function' ? url(params as never) : url)
}

describe('incidentio_alerts_list filters', () => {
  it('omits the tri-state filters when left on "Any"', () => {
    const resolved = resolveInputs({
      operation: 'incidentio_alerts_list',
      apiKey: 'k',
      has_notes: 'any',
      include_maintenance_window: 'any',
    })

    expect(resolved.has_notes).toBeUndefined()
    expect(resolved.include_maintenance_window).toBeUndefined()

    const url = buildUrl(resolved)
    expect(url.searchParams.has('has_notes[is]')).toBe(false)
    expect(url.searchParams.has('include_maintenance_window[is]')).toBe(false)
  })

  it('sends the tri-state filters as booleans when set', () => {
    const url = buildUrl(
      resolveInputs({
        operation: 'incidentio_alerts_list',
        apiKey: 'k',
        has_notes: 'true',
        include_maintenance_window: 'false',
      })
    )

    expect(url.searchParams.get('has_notes[is]')).toBe('true')
    expect(url.searchParams.get('include_maintenance_window[is]')).toBe('false')
  })

  it('never forwards a non-boolean filter value to the query string', () => {
    const url = buildUrl({ apiKey: 'k', has_notes: 'any', include_maintenance_window: 'any' })

    expect(url.searchParams.has('has_notes[is]')).toBe(false)
    expect(url.searchParams.has('include_maintenance_window[is]')).toBe(false)
  })

  it('applies the documented bracket-operator filter syntax', () => {
    const url = buildUrl(
      resolveInputs({
        operation: 'incidentio_alerts_list',
        apiKey: 'k',
        alert_status: 'firing',
        status_operator: 'not_in',
        alert_source_id: '01GBSQF3FHF7FWZQNWGHAVQ804',
        deduplication_key: 'ABC',
        created_at_gte: '2025-01-01',
      })
    )

    expect(url.searchParams.get('status[not_in]')).toBe('firing')
    expect(url.searchParams.get('alert_source[one_of]')).toBe('01GBSQF3FHF7FWZQNWGHAVQ804')
    expect(url.searchParams.get('deduplication_key[is]')).toBe('ABC')
    expect(url.searchParams.get('created_at[gte]')).toBe('2025-01-01')
    expect(url.searchParams.get('page_size')).toBe('25')
  })
})
