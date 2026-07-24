import { describe, expect, it } from 'vitest'
import type { OrganizationDataRetention } from '@/lib/api/contracts/organization'
import {
  buildRetentionOverride,
  buildRetentionPutBody,
  captureConfiguredRetention,
  retentionHoursToDayValue,
  retentionOverrideToDayValues,
  SETTINGS_PRIMARY_RETENTION_BASELINE,
} from '@/e2e/support/data-retention'

describe('data retention E2E helpers', () => {
  it('captures a detached full configured snapshot', () => {
    const configured = {
      logRetentionHours: 721,
      softDeleteRetentionHours: null,
      taskCleanupHours: 2160,
      piiRedaction: null,
      retentionOverrides: [
        {
          workspaceId: 'workspace-1',
          logRetentionHours: 336,
        },
      ],
    }
    const snapshot = captureConfiguredRetention({
      configured,
    } as Pick<OrganizationDataRetention, 'configured'>)

    configured.retentionOverrides[0].logRetentionHours = 720
    expect(snapshot).toEqual({
      logRetentionHours: 721,
      softDeleteRetentionHours: null,
      taskCleanupHours: 2160,
      piiRedaction: null,
      retentionOverrides: [{ workspaceId: 'workspace-1', logRetentionHours: 336 }],
    })
    expect(buildRetentionPutBody(snapshot)).toEqual({
      logRetentionHours: 721,
      softDeleteRetentionHours: null,
      taskCleanupHours: 2160,
      retentionOverrides: [{ workspaceId: 'workspace-1', logRetentionHours: 336 }],
    })
  })

  it('preserves unrelated fields and omits PII from every E2E PUT', () => {
    const snapshot = {
      logRetentionHours: 720,
      softDeleteRetentionHours: 2160,
      taskCleanupHours: 720,
      piiRedaction: { rules: [] },
      retentionOverrides: [
        {
          workspaceId: 'workspace-1',
          logRetentionHours: 168,
        },
      ],
    } satisfies OrganizationDataRetention['configured']

    const body = buildRetentionPutBody(snapshot, { logRetentionHours: 1440 })

    expect(body).toEqual({
      logRetentionHours: 1440,
      softDeleteRetentionHours: 2160,
      taskCleanupHours: 720,
      retentionOverrides: [{ workspaceId: 'workspace-1', logRetentionHours: 168 }],
    })
    expect(body).not.toHaveProperty('piiRedaction')
  })

  it('round-trips a concrete override while leaving inherited fields absent', () => {
    const override = buildRetentionOverride('workspace-1', {
      logRetention: '14',
      softDeleteRetention: 'inherit',
      taskCleanup: 'inherit',
    })

    expect(override).toEqual({ workspaceId: 'workspace-1', logRetentionHours: 336 })
    expect(retentionOverrideToDayValues(override)).toEqual({
      logRetention: '14',
      softDeleteRetention: 'inherit',
      taskCleanup: 'inherit',
    })
  })

  it('constructs an exact baseline restoration body without PII', () => {
    expect(buildRetentionPutBody(SETTINGS_PRIMARY_RETENTION_BASELINE)).toEqual({
      logRetentionHours: 720,
      softDeleteRetentionHours: 2160,
      taskCleanupHours: 720,
      retentionOverrides: [],
    })
  })

  it('rejects lossy conversion of non-day-aligned hours', () => {
    expect(() => retentionHoursToDayValue(25, false)).toThrow('Retention hours must be day-aligned')
  })
})
