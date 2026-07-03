/**
 * @vitest-environment node
 */
import type { DataRetentionSettings, PiiRedactionRule } from '@sim/db/schema'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PII_REDACTION,
  resolveEffectivePiiRedaction,
  resolveEffectiveRetentionHours,
} from '@/lib/billing/retention'

function settings(rules: PiiRedactionRule[]): DataRetentionSettings {
  return { piiRedaction: { rules } }
}

const DISABLED = { enabled: false, entityTypes: [], language: 'en' }

describe('resolveEffectivePiiRedaction', () => {
  const allRule: PiiRedactionRule = {
    id: 'r-all',
    entityTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'],
    workspaceId: null,
  }

  describe('legacy flat rules (back-compat)', () => {
    it('resolves an all-workspaces flat rule to logs-only', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([allRule]),
        workspaceId: 'ws-1',
      })
      expect(result).toEqual({
        input: DISABLED,
        blockOutputs: DISABLED,
        logs: { enabled: true, entityTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'], language: 'en' },
      })
    })

    it('lets a workspace-specific flat rule override the all rule (logs-only)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          allRule,
          { id: 'r-1', entityTypes: ['US_SSN'], workspaceId: 'ws-1' },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result).toEqual({
        input: DISABLED,
        blockOutputs: DISABLED,
        logs: { enabled: true, entityTypes: ['US_SSN'], language: 'en' },
      })
    })

    it('carries the flat rule language through (defaults to en)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          { id: 'r-es', entityTypes: ['ES_NIF'], workspaceId: 'ws-1', language: 'es' },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result.logs).toEqual({ enabled: true, entityTypes: ['ES_NIF'], language: 'es' })
    })

    it('falls back to en when a stored language is unsupported/stale', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          { id: 'r-de', entityTypes: ['EMAIL_ADDRESS'], workspaceId: 'ws-1', language: 'de' },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result.logs).toEqual({ enabled: true, entityTypes: ['EMAIL_ADDRESS'], language: 'en' })
    })

    it('exempts a workspace when its specific flat rule has no entity types', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([allRule, { id: 'r-1', entityTypes: [], workspaceId: 'ws-1' }]),
        workspaceId: 'ws-1',
      })
      expect(result).toEqual(DEFAULT_PII_REDACTION)
    })
  })

  describe('per-stage rules', () => {
    const stage = (enabled: boolean, entityTypes: string[], language?: string) => ({
      enabled,
      entityTypes,
      ...(language ? { language } : {}),
    })

    it('resolves each stage independently', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          {
            id: 'r-1',
            workspaceId: 'ws-1',
            stages: {
              input: stage(true, ['PERSON'], 'es'),
              blockOutputs: stage(true, ['EMAIL_ADDRESS']),
              logs: stage(true, ['US_SSN', 'PHONE_NUMBER']),
            },
          },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result).toEqual({
        input: { enabled: true, entityTypes: ['PERSON'], language: 'es' },
        blockOutputs: { enabled: true, entityTypes: ['EMAIL_ADDRESS'], language: 'en' },
        logs: { enabled: true, entityTypes: ['US_SSN', 'PHONE_NUMBER'], language: 'en' },
      })
    })

    it('disables a stage that is enabled but has no entity types (empty = off)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          {
            id: 'r-1',
            workspaceId: 'ws-1',
            stages: {
              input: stage(true, []),
              blockOutputs: stage(false, ['PERSON']),
              logs: stage(true, ['PERSON']),
            },
          },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result.input).toEqual(DISABLED)
      expect(result.blockOutputs).toEqual(DISABLED)
      expect(result.logs).toEqual({ enabled: true, entityTypes: ['PERSON'], language: 'en' })
    })

    it('selects the whole workspace rule over the all rule (no per-stage merge)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          allRule,
          {
            id: 'r-ws',
            workspaceId: 'ws-1',
            stages: {
              input: stage(true, ['PERSON']),
              blockOutputs: stage(false, []),
              logs: stage(false, []),
            },
          },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result.input).toEqual({ enabled: true, entityTypes: ['PERSON'], language: 'en' })
      // The all rule's logs entity types are NOT unioned in.
      expect(result.logs).toEqual(DISABLED)
    })
  })

  it('is the default when no rule matches and there is no all rule', () => {
    expect(
      resolveEffectivePiiRedaction({
        orgSettings: settings([{ id: 'r-1', entityTypes: ['US_SSN'], workspaceId: 'ws-2' }]),
        workspaceId: 'ws-1',
      })
    ).toEqual(DEFAULT_PII_REDACTION)
  })

  it('is the default when there are no rules', () => {
    expect(
      resolveEffectivePiiRedaction({ orgSettings: settings([]), workspaceId: 'ws-1' })
    ).toEqual(DEFAULT_PII_REDACTION)
    expect(resolveEffectivePiiRedaction({ orgSettings: null, workspaceId: 'ws-1' })).toEqual(
      DEFAULT_PII_REDACTION
    )
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
