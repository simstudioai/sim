/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { generateTableId } from '@/lib/table/ids'

describe('generateTableId', () => {
  it('mints a tbl_ prefix over a dash-stripped UUID', () => {
    expect(generateTableId()).toMatch(/^tbl_[0-9a-f]{32}$/)
  })

  it('mints a distinct id each time', () => {
    expect(generateTableId()).not.toBe(generateTableId())
  })
})
