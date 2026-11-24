import { REGISTRATION_MODES } from '@sim/deployment-config/registration'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getDeploymentShape,
  resolveDeploymentShape,
  seedDeploymentShape,
} from '@/lib/core/config/deployment-shape'

afterEach(resetEnvFlagsMock)

/** Enum-valued fields the shape may carry, each with every value it may take. */
const ENUM_FIELDS: Record<string, readonly string[]> = {
  registrationMode: REGISTRATION_MODES,
}

/** The only nested objects the shape may carry; every value inside one must be a boolean. */
const BOOLEAN_MAP_FIELDS = new Set(['features'])

/**
 * Every value in the shape that is neither a boolean, a known enum value, nor a
 * boolean inside an allowed map, as `path: value`. The shape is serialized onto
 * `<html>` for every visitor, so anything else (a URL, a key, an id) is a leak.
 */
function nonPublicValues(shape: Record<string, unknown>): string[] {
  const findings: string[] = []
  for (const [key, value] of Object.entries(shape)) {
    if (typeof value === 'boolean') continue
    if (key in ENUM_FIELDS) {
      if (!ENUM_FIELDS[key].includes(value as string)) findings.push(`${key}: ${String(value)}`)
      continue
    }
    if (
      BOOLEAN_MAP_FIELDS.has(key) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue !== 'boolean') {
          findings.push(`${key}.${nestedKey}: ${JSON.stringify(nestedValue)}`)
        }
      }
      continue
    }
    findings.push(`${key}: ${JSON.stringify(value)}`)
  }
  return findings
}

describe('resolveDeploymentShape as a public surface', () => {
  it.each([
    ['self-hosted defaults', {}],
    [
      'a hosted deployment with billing and a restricted mode',
      { isHosted: true, isBillingEnabled: true, registrationMode: 'closed-no-email' as const },
    ],
  ])('carries only booleans and known enum values for %s', (_label, flags) => {
    setEnvFlags(flags)

    expect(nonPublicValues({ ...resolveDeploymentShape() })).toEqual([])
  })
})

describe('getDeploymentShape on the server', () => {
  it('answers from the env flags and ignores seeding, which is browser-only', () => {
    seedDeploymentShape({ ...resolveDeploymentShape(), hosted: true })

    expect(getDeploymentShape().hosted).toBe(false)
  })
})
