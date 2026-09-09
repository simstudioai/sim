/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  defineOracleEpmRouteSpace,
  getOracleEpmRouteSpace,
} from '@/lib/internal/oracle-epm/route-space'
import type { OracleEpmRouteSpace } from '@/lib/internal/oracle-epm/types'

describe('defineOracleEpmRouteSpace', () => {
  it('supports unrelated child contexts and case-sensitive versions without foundation edits', () => {
    const lower = defineOracleEpmRouteSpace({
      context: ['SyntheticAlpha', 'rest'],
      allowedVersions: ['v3'],
    })
    const upper = defineOracleEpmRouteSpace({
      context: ['synthetic-beta', 'api'],
      allowedVersions: ['V1'],
    })

    expect(lower.allowedVersions).toEqual(['v3'])
    expect(upper.allowedVersions).toEqual(['V1'])
    expect(Object.isFrozen(lower)).toBe(true)
    expect(Object.isFrozen(lower.context)).toBe(true)
  })

  it.each([
    { context: [], allowedVersions: ['v1'] },
    { context: ['../admin'], allowedVersions: ['v1'] },
    { context: ['rest'], allowedVersions: ['v1', 'v1'] },
    { context: ['rest'], allowedVersions: ['v/1'] },
  ])('rejects invalid static declarations', (declaration) => {
    expect(() => defineOracleEpmRouteSpace(declaration)).toThrow()
  })

  it('rejects forged route spaces', () => {
    expect(() => getOracleEpmRouteSpace({} as OracleEpmRouteSpace)).toThrow(
      'not a valid declaration'
    )
  })
})
