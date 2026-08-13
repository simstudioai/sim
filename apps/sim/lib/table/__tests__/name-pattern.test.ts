/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { NAME_PATTERN } from '@/lib/table/constants'

/**
 * `NAME_PATTERN.source` is published verbatim as a JSON Schema `pattern` in the
 * v2 OpenAPI documents. JSON Schema patterns carry no flags, so the source must
 * be self-sufficient: the previous `/^[a-z_][a-z0-9_]*$/i` spelling round-tripped
 * as a case-sensitive pattern and made every generated client reject names the
 * server accepts.
 */
const LEGACY_FLAGGED_PATTERN = /^[a-z_][a-z0-9_]*$/i

const SAMPLES = [
  'sales',
  'Sales',
  'SALES',
  'subscriptionPlan',
  'legacyStatus',
  '_private',
  '_',
  'a1',
  'A_1_b',
  'col_00',
  '1sales',
  '9',
  '',
  'has space',
  'has-dash',
  'café',
  'Ω',
  'name\n',
  '\nname',
  'name$',
]

describe('NAME_PATTERN', () => {
  it('carries no regex flags, so its source round-trips as a JSON Schema pattern', () => {
    expect(NAME_PATTERN.flags).toBe('')
    expect(NAME_PATTERN.source).toBe('^[A-Za-z_][A-Za-z0-9_]*$')
  })

  it.each(SAMPLES)('accepts %j exactly when the legacy case-insensitive spelling did', (sample) => {
    expect(NAME_PATTERN.test(sample)).toBe(LEGACY_FLAGGED_PATTERN.test(sample))
  })
})
