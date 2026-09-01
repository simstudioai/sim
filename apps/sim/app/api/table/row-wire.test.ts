/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { rowKeyingForAuthTransport } from '@/app/api/table/row-wire'

describe('table row route wire keying', () => {
  it('maps the verified session transport to stable column IDs', () => {
    expect(rowKeyingForAuthTransport('session')).toBe('ids')
  })

  it('maps the verified executor transport to column names', () => {
    expect(rowKeyingForAuthTransport('executor_jwt')).toBe('names')
  })

  it('fails when the route did not provide a verified transport', () => {
    expect(() => rowKeyingForAuthTransport(undefined)).toThrow(
      'Table row route requires an authenticated transport'
    )
  })
})
