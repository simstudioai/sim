import type { DataRetentionSettings, PiiRedactionRule } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PII_REDACTION,
  getForeignWorkspaceTargetsReason,
  resolveEffectivePiiRedaction,
  resolveEffectiveRetentionHours,
} from '@/lib/billing/retention'

function settings(rules: PiiRedactionRule[]): DataRetentionSettings {
  return { piiRedaction: { rules } }
}

const DISABLED = { enabled: false, entityTypes: [], language: 'en', customPatterns: [] }

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
        logs: {
          enabled: true,
          entityTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'],
          language: 'en',
          customPatterns: [],
        },
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
        logs: { enabled: true, entityTypes: ['US_SSN'], language: 'en', customPatterns: [] },
      })
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
        input: { enabled: true, entityTypes: ['PERSON'], language: 'es', customPatterns: [] },
        blockOutputs: {
          enabled: true,
          entityTypes: ['EMAIL_ADDRESS'],
          language: 'en',
          customPatterns: [],
        },
        logs: {
          enabled: true,
          entityTypes: ['US_SSN', 'PHONE_NUMBER'],
          language: 'en',
          customPatterns: [],
        },
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
      expect(result.logs).toEqual({
        enabled: true,
        entityTypes: ['PERSON'],
        language: 'en',
        customPatterns: [],
      })
    })

    it('strips spaCy-NER entities from blockOutputs at resolve time (regex-only)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          {
            id: 'r-1',
            workspaceId: 'ws-1',
            stages: {
              input: stage(true, ['PERSON', 'EMAIL_ADDRESS']),
              blockOutputs: stage(true, ['PERSON', 'EMAIL_ADDRESS']),
              logs: stage(true, ['DATE_TIME']),
            },
          },
        ]),
        workspaceId: 'ws-1',
      })
      // input + logs keep NER; blockOutputs drops it (regex-only execution path).
      expect(result.input.entityTypes).toEqual(['PERSON', 'EMAIL_ADDRESS'])
      expect(result.blockOutputs.entityTypes).toEqual(['EMAIL_ADDRESS'])
      expect(result.logs.entityTypes).toEqual(['DATE_TIME'])
    })

    it('disables blockOutputs when only NER was stored (un-migrated rule)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          {
            id: 'r-1',
            workspaceId: 'ws-1',
            stages: {
              input: stage(false, []),
              blockOutputs: stage(true, ['PERSON']),
              logs: stage(false, []),
            },
          },
        ]),
        workspaceId: 'ws-1',
      })
      expect(result.blockOutputs).toEqual(DISABLED)
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
      expect(result.input).toEqual({
        enabled: true,
        entityTypes: ['PERSON'],
        language: 'en',
        customPatterns: [],
      })
      // The all rule's logs entity types are NOT unioned in.
      expect(result.logs).toEqual(DISABLED)
    })

    it('carries custom patterns through each stage (blockOutputs strips NER but keeps them)', () => {
      const result = resolveEffectivePiiRedaction({
        orgSettings: settings([
          {
            id: 'r-1',
            workspaceId: 'ws-1',
            stages: {
              input: {
                enabled: true,
                entityTypes: [],
                customPatterns: [{ name: 'Emp', regex: 'EMP-\\d{6}', replacement: '<EMP>' }],
              },
              blockOutputs: {
                enabled: true,
                entityTypes: ['PERSON'],
                customPatterns: [{ name: 'Tck', regex: 'TCK-\\d+', replacement: '<TCK>' }],
              },
              logs: stage(false, []),
            },
          },
        ]),
        workspaceId: 'ws-1',
      })
      // Input: enabled by custom pattern alone (no entity types).
      expect(result.input.enabled).toBe(true)
      expect(result.input.customPatterns).toEqual([
        { name: 'Emp', regex: 'EMP-\\d{6}', replacement: '<EMP>' },
      ])
      // Block outputs: NER stripped, but the custom pattern keeps the stage enabled.
      expect(result.blockOutputs.entityTypes).toEqual([])
      expect(result.blockOutputs.enabled).toBe(true)
      expect(result.blockOutputs.customPatterns).toEqual([
        { name: 'Tck', regex: 'TCK-\\d+', replacement: '<TCK>' },
      ])
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
})

describe('resolveEffectiveRetentionHours', () => {
  const orgSettings: DataRetentionSettings = {
    logRetentionHours: 720,
    softDeleteRetentionHours: 2160,
    taskCleanupHours: null,
  }

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
})

describe('getForeignWorkspaceTargetsReason', () => {
  beforeEach(resetDbChainMock)
  afterAll(resetDbChainMock)

  it('rejects an override naming a workspace the organization does not own', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws-1' }])

    await expect(
      getForeignWorkspaceTargetsReason({
        organizationId: 'org-1',
        retentionOverrides: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-foreign' }],
      })
    ).resolves.toContain('ws-foreign')
  })

  it('also checks workspaces named by PII rules, not just overrides', async () => {
    queueTableRows(schemaMock.workspace, [])

    await expect(
      getForeignWorkspaceTargetsReason({
        organizationId: 'org-1',
        piiRedaction: { rules: [{ workspaceId: 'ws-foreign' }] },
      })
    ).resolves.toContain('ws-foreign')
  })
})
