/**
 * @vitest-environment node
 */
import type { DataRetentionSettings, PiiRedactionRule } from '@sim/db/schema'
import { describe, expect, it } from 'vitest'
import { resolveEffectivePiiRedaction } from '@/lib/billing/retention'

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
