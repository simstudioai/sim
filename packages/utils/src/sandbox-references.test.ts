import {
  immutableBoxdSnapshotRef,
  isImmutableBoxdSnapshotRef,
  isImmutableDaytonaSnapshotRef,
  isImmutableE2BTemplateRef,
  isValidE2BTemplateName,
  parseBoxdSnapshotRef,
} from '@sim/utils/sandbox-references'
import { describe, expect, it } from 'vitest'

const BUILD_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

describe('immutable sandbox references', () => {
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

  it.each(['sim-function:latest', 'team/sim-function', 'Sim-function', 'sim.function', ''])(
    'rejects an invalid E2B template family: %s',
    (value) => {
      expect(isValidE2BTemplateName(value)).toBe(false)
    }
  )

  it('requires a Daytona snapshot ID rather than a name', () => {
    expect(isImmutableDaytonaSnapshotRef(BUILD_ID)).toBe(true)
    expect(isImmutableDaytonaSnapshotRef('sim-function:2026-08-03')).toBe(false)
    expect(isImmutableDaytonaSnapshotRef('sim-function')).toBe(false)
  })

  it('requires a version-pinned boxd snapshot reference', () => {
    expect(isImmutableBoxdSnapshotRef('sim-function-20261112@3')).toBe(true)
    expect(isImmutableBoxdSnapshotRef('snap_0123456789abcdef0123456789abcdef@1')).toBe(true)
    expect(isImmutableBoxdSnapshotRef('sim-function-20261112')).toBe(false)
    expect(isImmutableBoxdSnapshotRef('sim-function@0')).toBe(false)
    expect(isImmutableBoxdSnapshotRef('sim-function@latest')).toBe(false)
    expect(isImmutableBoxdSnapshotRef('sim function@1')).toBe(false)
    expect(isImmutableBoxdSnapshotRef('@1')).toBe(false)
    expect(parseBoxdSnapshotRef('sim-function@12')).toEqual({
      snapshot: 'sim-function',
      version: 12,
    })
    expect(parseBoxdSnapshotRef('sim-docs')).toEqual({ snapshot: 'sim-docs' })
    expect(immutableBoxdSnapshotRef('sim-function', 3)).toBe('sim-function@3')
    expect(() => immutableBoxdSnapshotRef('sim-function', null)).toThrow(/<snapshot>@<version>/)
  })
})
