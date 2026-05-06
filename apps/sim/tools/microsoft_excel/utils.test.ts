/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseGraphErrorMessage } from '@/tools/microsoft_excel/utils'

describe('parseGraphErrorMessage', () => {
  it('extracts top-level error.message', () => {
    const body = JSON.stringify({
      error: { code: 'badRequest', message: 'Uploaded fragment overlaps with existing data.' },
    })
    expect(parseGraphErrorMessage(400, 'Bad Request', body)).toBe(
      'Uploaded fragment overlaps with existing data.'
    )
  })

  it('combines top-level and innerError messages with em-dash separator', () => {
    const body = JSON.stringify({
      error: {
        code: 'invalidRequest',
        message: 'The request is invalid.',
        innerError: { code: 'invalidRange', message: 'Range A1:Z9999 is out of bounds.' },
      },
    })
    expect(parseGraphErrorMessage(400, 'Bad Request', body)).toBe(
      'The request is invalid. — Range A1:Z9999 is out of bounds.'
    )
  })

  it('walks nested innerError chain (lowercase spec form)', () => {
    const body = JSON.stringify({
      error: {
        message: 'Outer message.',
        innererror: {
          message: 'Middle message.',
          innererror: { message: 'Innermost message.' },
        },
      },
    })
    expect(parseGraphErrorMessage(500, 'Internal Server Error', body)).toBe(
      'Outer message. — Middle message. — Innermost message.'
    )
  })

  it('appends details[].message entries', () => {
    const body = JSON.stringify({
      error: {
        message: 'Multiple problems.',
        details: [{ message: 'Cell A1 invalid.' }, { message: 'Cell B2 invalid.' }],
      },
    })
    expect(parseGraphErrorMessage(400, 'Bad Request', body)).toBe(
      'Multiple problems. — Cell A1 invalid. — Cell B2 invalid.'
    )
  })

  it('falls back to error.code when no messages present', () => {
    const body = JSON.stringify({ error: { code: 'itemNotFound' } })
    expect(parseGraphErrorMessage(404, 'Not Found', body)).toBe('itemNotFound (404 Not Found)')
  })

  it('returns raw text when body is not JSON', () => {
    expect(parseGraphErrorMessage(502, 'Bad Gateway', 'upstream timeout')).toBe('upstream timeout')
  })

  it('falls back to status text when body is empty', () => {
    expect(parseGraphErrorMessage(503, 'Service Unavailable', '')).toBe('503 Service Unavailable')
  })

  it('handles deeply nested chain without infinite loop', () => {
    let nested: Record<string, unknown> = { message: 'leaf' }
    for (let i = 0; i < 50; i++) {
      nested = { message: `level-${i}`, innerError: nested }
    }
    const body = JSON.stringify({ error: nested })
    const result = parseGraphErrorMessage(500, 'Internal Server Error', body)
    // Should include outer plus capped nested messages, not blow up.
    expect(result.startsWith('level-49')).toBe(true)
  })

  it('deduplicates identical inner messages', () => {
    const body = JSON.stringify({
      error: {
        message: 'Same message.',
        innerError: { message: 'Same message.' },
      },
    })
    expect(parseGraphErrorMessage(400, 'Bad Request', body)).toBe('Same message.')
  })
})
