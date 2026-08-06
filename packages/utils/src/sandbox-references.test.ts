import {
  immutableE2BTemplateRef,
  isImmutableDaytonaSnapshotRef,
  isImmutableE2BTemplateRef,
  isValidE2BTemplateName,
  isValidE2BTemplateReferenceName,
  isValidSandboxReleaseGeneration,
  normalizeSandboxProvider,
} from '@sim/utils/sandbox-references'
import { describe, expect, it } from 'vitest'

const BUILD_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

describe('immutable sandbox references', () => {
  it('normalizes only registered sandbox providers', () => {
    expect(normalizeSandboxProvider('E2B')).toBe('e2b')
    expect(normalizeSandboxProvider('Daytona')).toBe('daytona')
    expect(normalizeSandboxProvider('modal')).toBeUndefined()
    expect(normalizeSandboxProvider(undefined)).toBeUndefined()
  })

  it.each([
    `sim-function:${BUILD_ID}`,
    `team_sim-function:${BUILD_ID}`,
    `acme/sim-function:${BUILD_ID}`,
  ])('accepts an exact E2B build reference: %s', (value) => {
    expect(isImmutableE2BTemplateRef(value)).toBe(true)
  })

  it.each([
    'sim-function',
    'sim-function:default',
    'sim-function:latest',
    'sim-function:v1',
    `sim-function:stable:${BUILD_ID}`,
    `team/child/sim-function:${BUILD_ID}`,
    `Sim-function:${BUILD_ID}`,
    `sim.function:${BUILD_ID}`,
    BUILD_ID,
  ])('rejects a movable or incomplete E2B reference: %s', (value) => {
    expect(isImmutableE2BTemplateRef(value)).toBe(false)
  })

  it('creates an exact E2B build reference', () => {
    expect(immutableE2BTemplateRef('sim-function', BUILD_ID)).toBe(`sim-function:${BUILD_ID}`)
  })

  it.each(['sim-function', 'team_sim-function'])(
    'accepts an untagged E2B template family: %s',
    (value) => {
      expect(isValidE2BTemplateName(value)).toBe(true)
    }
  )

  it.each(['sim-function:latest', 'team/sim-function', 'Sim-function', 'sim.function', ''])(
    'rejects an invalid E2B template family: %s',
    (value) => {
      expect(isValidE2BTemplateName(value)).toBe(false)
    }
  )

  it('accepts one namespace only for an exact reference name', () => {
    expect(isValidE2BTemplateReferenceName('acme/sim-function')).toBe(true)
    expect(isValidE2BTemplateName('acme/sim-function')).toBe(false)
    expect(isValidE2BTemplateReferenceName('acme/team/sim-function')).toBe(false)
  })

  it('requires a Daytona snapshot ID rather than a name', () => {
    expect(isImmutableDaytonaSnapshotRef(BUILD_ID)).toBe(true)
    expect(isImmutableDaytonaSnapshotRef('sim-function:2026-08-03')).toBe(false)
    expect(isImmutableDaytonaSnapshotRef('sim-function')).toBe(false)
  })

  it('accepts only positive safe release generations', () => {
    expect(isValidSandboxReleaseGeneration('1785792000000')).toBe(true)
    expect(isValidSandboxReleaseGeneration(1785792000000)).toBe(true)
    expect(isValidSandboxReleaseGeneration('0')).toBe(false)
    expect(isValidSandboxReleaseGeneration('1.5')).toBe(false)
    expect(isValidSandboxReleaseGeneration('01')).toBe(false)
    expect(isValidSandboxReleaseGeneration(Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})
