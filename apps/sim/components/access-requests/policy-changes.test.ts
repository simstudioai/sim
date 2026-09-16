/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  describePolicyChange,
  describePolicyValue,
} from '@/components/access-requests/policy-changes'

const target = { kind: 'integration', id: 'slack_v2' } as const

describe('permission change summaries', () => {
  it('names only newly allowed entries without hiding the changed field', () => {
    expect(
      describePolicyChange(
        {
          configKey: 'allowedIntegrations',
          label: 'Integrations',
          before: ['github_v2'],
          after: ['github_v2', 'slack_v2'],
        },
        target,
        'Slack'
      )
    ).toBe('Allow Slack')
  })
  it('preserves broader provider changes instead of replacing every value with the requested target', () => {
    expect(
      describePolicyChange(
        {
          configKey: 'allowedModelProviders',
          label: 'Providers',
          before: ['anthropic'],
          after: ['anthropic', 'openai'],
        },
        { kind: 'model', id: 'gpt-4.1' },
        'GPT-4.1'
      )
    ).toBe('Allow openai')
  })
  it('distinguishes removal from allowlists and denylists', () => {
    expect(
      describePolicyChange(
        {
          configKey: 'allowedIntegrations',
          label: 'Integrations',
          before: ['slack_v2'],
          after: [],
        },
        target,
        'Slack'
      )
    ).toBe('Remove Slack')
    expect(
      describePolicyChange(
        { configKey: 'deniedTools', label: 'Blocked tools', before: ['slack_canvas'], after: [] },
        { kind: 'tool', id: 'slack_canvas' },
        'Slack canvas'
      )
    ).toBe('Unblock Slack canvas')
  })
  it('reports both additions and removals', () => {
    expect(
      describePolicyChange(
        {
          configKey: 'allowedIntegrations',
          label: 'Integrations',
          before: ['github_v2'],
          after: ['slack_v2'],
        },
        target,
        'Slack'
      )
    ).toBe('Allow Slack; Remove GitHub')
  })
  it('distinguishes unrestricted and empty allowlists', () => {
    expect(
      describePolicyChange(
        { configKey: 'allowedIntegrations', label: 'Integrations', before: [], after: null },
        target,
        'Slack'
      )
    ).toBe('Allow all')
    expect(
      describePolicyChange(
        { configKey: 'allowedIntegrations', label: 'Integrations', before: null, after: [] },
        target,
        'Slack'
      )
    ).toBe('Allow none')
    expect(
      describePolicyChange(
        {
          configKey: 'allowedIntegrations',
          label: 'Integrations',
          before: null,
          after: ['slack_v2'],
        },
        target,
        'Slack'
      )
    ).toBe('Allow only Slack')
  })
  it('shows the direction of a boolean restriction', () => {
    expect(
      describePolicyChange(
        { configKey: 'hideTablesTab', label: 'Tables', before: true, after: false },
        { kind: 'feature', configKey: 'hideTablesTab' },
        'Tables'
      )
    ).toBe('Restricted → Allowed')
  })
})

describe('permission change details', () => {
  it('uses canonical names for every integration and preserves the original snapshot', () => {
    const values = ['github_v2', 'notion_v2', 'slack_v2', 'loop', 'parallel']
    const before = structuredClone(values)
    expect(describePolicyValue(values, 'allowedIntegrations', target, 'Slack')).toBe(
      'GitHub, Notion, Slack, Loop, Parallel'
    )
    expect(values).toEqual(before)
  })

  it('collapses only equivalent integration aliases in both lists and change summaries', () => {
    expect(
      describePolicyValue(
        ['GitHub', 'github_v2', 'notion', 'notion_v2'],
        'allowedIntegrations',
        target,
        'Slack'
      )
    ).toBe('GitHub, Notion')
    expect(
      describePolicyChange(
        {
          configKey: 'allowedIntegrations',
          label: 'Integrations',
          before: ['github', 'notion'],
          after: ['github_v2', 'notion_v2', 'slack_v2'],
        },
        target,
        'Slack'
      )
    ).toBe('Allow Slack')
    expect(
      describePolicyChange(
        {
          configKey: 'allowedIntegrations',
          label: 'Integrations',
          before: ['slack'],
          after: ['slack_v2'],
        },
        target,
        'Slack'
      )
    ).toBe('No membership change')
  })

  it('retains unknown IDs exactly and does not read inherited object properties', () => {
    expect(
      describePolicyValue(
        ['Unknown_Integration_v2', 'constructor', 'toString', '__proto__'],
        'allowedIntegrations',
        target,
        'Slack'
      )
    ).toBe('Unknown_Integration_v2, constructor, toString, __proto__')
  })

  it('uses the request label for an integration outside the built-in registry', () => {
    expect(
      describePolicyValue(
        ['Custom_Integration'],
        'allowedIntegrations',
        { kind: 'integration', id: 'custom_integration' },
        'Custom integration'
      )
    ).toBe('Custom integration')
  })

  it('keeps meaningful model and tool versions distinct', () => {
    expect(describePolicyValue(['model_v1', 'model_v2'], 'deniedModels', target, 'Slack')).toBe(
      'model_v1, model_v2'
    )
    expect(describePolicyValue(['tool_v1', 'tool_v2'], 'deniedTools', target, 'Slack')).toBe(
      'tool_v1, tool_v2'
    )
  })

  it('preserves the difference between unrestricted, empty, and boolean values', () => {
    expect(describePolicyValue(null, 'allowedIntegrations', target, 'Slack')).toBe('All allowed')
    expect(describePolicyValue([], 'allowedIntegrations', target, 'Slack')).toBe('None')
    expect(
      describePolicyValue(
        true,
        'hideTablesTab',
        { kind: 'feature', configKey: 'hideTablesTab' },
        'Tables'
      )
    ).toBe('Restricted')
  })
})
