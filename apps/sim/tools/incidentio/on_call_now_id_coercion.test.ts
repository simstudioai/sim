/**
 * @vitest-environment node
 *
 * `schedule_id` is declared `type: 'string'` but arrives from an LLM tool call, where a
 * numeric-looking id can land as a JSON number. `tools/url-path.ts` documents this exact hazard
 * and `toGuardedString` coerces for it — so the raw value must reach the guard rather than being
 * `.trim()`ed first, which throws `TypeError: trim is not a function`.
 *
 * incident.io ids are ULIDs, so this is hygiene rather than a reachable bug; the point is that
 * the whitespace-only fallthrough to the list endpoint is preserved either way.
 */
import { describe, expect, it } from 'vitest'
import { onCallNowTool } from '@/tools/incidentio/on_call_now'

function buildUrl(params: Record<string, unknown>): string {
  const url = onCallNowTool.request.url
  return typeof url === 'function' ? url(params as never) : url
}

describe('incidentio_on_call_now schedule_id handling', () => {
  it('stringifies a numeric id instead of throwing on .trim()', () => {
    expect(buildUrl({ apiKey: 'k', schedule_id: 12345 })).toBe(
      'https://api.incident.io/v2/schedules/12345'
    )
  })

  it('keeps the string path byte-identical, trimming included', () => {
    expect(buildUrl({ apiKey: 'k', schedule_id: '  01FCNDV6P870EA6S7TK1DSYDG0  ' })).toBe(
      'https://api.incident.io/v2/schedules/01FCNDV6P870EA6S7TK1DSYDG0'
    )
  })

  it('still falls through to the schedules list for absent and whitespace-only ids', () => {
    for (const schedule_id of [undefined, '', '   ']) {
      expect(buildUrl({ apiKey: 'k', schedule_id })).toBe(
        'https://api.incident.io/v2/schedules?page_size=25'
      )
    }
  })
})
