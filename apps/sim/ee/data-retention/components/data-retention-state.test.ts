import { describe, expect, it } from 'vitest'
import {
  buildDataRetentionUpdateSettings,
  type DataRetentionQueryReadiness,
  resolveDataRetentionState,
} from '@/ee/data-retention/components/data-retention-state'

const ready = {
  retentionSuccess: true,
  retentionError: false,
  retentionPlaceholder: false,
  workspacesSuccess: true,
  workspacesError: false,
  workspacesPlaceholder: false,
} satisfies DataRetentionQueryReadiness

describe('resolveDataRetentionState', () => {
  it('requires successful non-placeholder retention and workspace queries', () => {
    expect(resolveDataRetentionState({ ...ready, retentionSuccess: false })).toBe('loading')
    expect(resolveDataRetentionState({ ...ready, workspacesSuccess: false })).toBe('loading')
    expect(resolveDataRetentionState({ ...ready, workspacesPlaceholder: true })).toBe('loading')
  })

  it('gives errors precedence over stale or placeholder data', () => {
    expect(
      resolveDataRetentionState({
        ...ready,
        retentionSuccess: false,
        retentionPlaceholder: true,
        workspacesError: true,
      })
    ).toBe('error')
  })

  it('reports ready only when both query boundaries are usable', () => {
    expect(resolveDataRetentionState(ready)).toBe('ready')
  })
})

describe('buildDataRetentionUpdateSettings', () => {
  const values = {
    logRetentionHours: 720,
    softDeleteRetentionHours: 2160,
    taskCleanupHours: 720,
    retentionOverrides: [],
    piiRedaction: { rules: [] },
  }

  it('omits the PII key entirely while the feature is disabled', () => {
    const settings = buildDataRetentionUpdateSettings(values, false)

    expect(settings).toEqual({
      logRetentionHours: 720,
      softDeleteRetentionHours: 2160,
      taskCleanupHours: 720,
      retentionOverrides: [],
    })
    expect(settings).not.toHaveProperty('piiRedaction')
  })

  it('includes PII only while the feature is enabled', () => {
    expect(buildDataRetentionUpdateSettings(values, true)).toHaveProperty('piiRedaction', {
      rules: [],
    })
  })
})
