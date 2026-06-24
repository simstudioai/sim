/**
 * @vitest-environment node
 */
import type { DataRetentionSettings, PiiRedactionRule } from '@sim/db/schema'
import { describe, expect, it } from 'vitest'
import {
  resolveEffectivePiiRedaction,
  resolveEffectiveRetentionHours,
} from '@/lib/billing/retention'

function settings(rules: PiiRedactionRule[]): DataRetentionSettings {
  return { piiRedaction: { rules } }
}

describe('resolveEffectivePiiRedaction', () => {
  const allRule: PiiRedactionRule = {
    id: 'r-all',
    entityTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'],
    workspaceId: null,
  }

  it('applies the all-workspaces rule when the workspace has no specific rule', () => {
    const result = resolveEffectivePiiRedaction({
      orgSettings: settings([allRule]),
      workspaceId: 'ws-1',
    })
    expect(result).toEqual({
      enabled: true,
      entityTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'],
      language: 'en',
    })
  })

  it('lets a workspace-specific rule override the all rule', () => {
    const result = resolveEffectivePiiRedaction({
      orgSettings: settings([allRule, { id: 'r-1', entityTypes: ['US_SSN'], workspaceId: 'ws-1' }]),
      workspaceId: 'ws-1',
    })
    expect(result).toEqual({ enabled: true, entityTypes: ['US_SSN'], language: 'en' })
  })

  it('carries the rule language through (defaults to en)', () => {
    const result = resolveEffectivePiiRedaction({
      orgSettings: settings([
        { id: 'r-es', entityTypes: ['ES_NIF'], workspaceId: 'ws-1', language: 'es' },
      ]),
      workspaceId: 'ws-1',
    })
    expect(result).toEqual({ enabled: true, entityTypes: ['ES_NIF'], language: 'es' })
  })

  it('falls back to en when a stored language is unsupported/stale', () => {
    const result = resolveEffectivePiiRedaction({
      orgSettings: settings([
        { id: 'r-de', entityTypes: ['EMAIL_ADDRESS'], workspaceId: 'ws-1', language: 'de' },
      ]),
      workspaceId: 'ws-1',
    })
    expect(result).toEqual({ enabled: true, entityTypes: ['EMAIL_ADDRESS'], language: 'en' })
  })

  it('exempts a workspace when its specific rule has no entity types', () => {
    const result = resolveEffectivePiiRedaction({
      orgSettings: settings([allRule, { id: 'r-1', entityTypes: [], workspaceId: 'ws-1' }]),
      workspaceId: 'ws-1',
    })
    expect(result).toEqual({ enabled: false, entityTypes: [], language: 'en' })
  })

  it('is disabled when no rule matches and there is no all rule', () => {
    const result = resolveEffectivePiiRedaction({
      orgSettings: settings([{ id: 'r-1', entityTypes: ['US_SSN'], workspaceId: 'ws-2' }]),
      workspaceId: 'ws-1',
    })
    expect(result).toEqual({ enabled: false, entityTypes: [], language: 'en' })
  })

  it('is disabled when there are no rules', () => {
    expect(
      resolveEffectivePiiRedaction({ orgSettings: settings([]), workspaceId: 'ws-1' })
    ).toEqual({ enabled: false, entityTypes: [], language: 'en' })
    expect(resolveEffectivePiiRedaction({ orgSettings: null, workspaceId: 'ws-1' })).toEqual({
      enabled: false,
      entityTypes: [],
      language: 'en',
    })
  })
})

describe('resolveEffectiveRetentionHours', () => {
  const orgSettings: DataRetentionSettings = {
    logRetentionHours: 720,
    softDeleteRetentionHours: 2160,
    taskCleanupHours: null,
  }

  it('returns the org value when the workspace has no override', () => {
    expect(
      resolveEffectiveRetentionHours({ orgSettings, workspaceId: 'ws-1', key: 'logRetentionHours' })
    ).toBe(720)
  })

  it('returns the org value when an override exists but omits the field (inherit)', () => {
    expect(
      resolveEffectiveRetentionHours({
        orgSettings: { ...orgSettings, retentionOverrides: [{ workspaceId: 'ws-1' }] },
        workspaceId: 'ws-1',
        key: 'logRetentionHours',
      })
    ).toBe(720)
  })

  it('uses the override hours when the field is set to a number', () => {
    expect(
      resolveEffectiveRetentionHours({
        orgSettings: {
          ...orgSettings,
          retentionOverrides: [{ workspaceId: 'ws-1', logRetentionHours: 168 }],
        },
        workspaceId: 'ws-1',
        key: 'logRetentionHours',
      })
    ).toBe(168)
  })

  it('uses null (forever) when the override field is explicitly null', () => {
    expect(
      resolveEffectiveRetentionHours({
        orgSettings: {
          ...orgSettings,
          retentionOverrides: [{ workspaceId: 'ws-1', logRetentionHours: null }],
        },
        workspaceId: 'ws-1',
        key: 'logRetentionHours',
      })
    ).toBeNull()
  })

  it('only applies the override to its own workspace', () => {
    const settingsWithOverride: DataRetentionSettings = {
      ...orgSettings,
      retentionOverrides: [{ workspaceId: 'ws-1', logRetentionHours: 168 }],
    }
    expect(
      resolveEffectiveRetentionHours({
        orgSettings: settingsWithOverride,
        workspaceId: 'ws-2',
        key: 'logRetentionHours',
      })
    ).toBe(720)
  })

  it('returns null when neither an override nor an org value is configured', () => {
    expect(
      resolveEffectiveRetentionHours({ orgSettings, workspaceId: 'ws-1', key: 'taskCleanupHours' })
    ).toBeNull()
    expect(
      resolveEffectiveRetentionHours({
        orgSettings: null,
        workspaceId: 'ws-1',
        key: 'logRetentionHours',
      })
    ).toBeNull()
  })
})
