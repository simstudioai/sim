/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { describePolicyChange } from '@/components/access-requests/policy-changes'

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
    ).toBe('Allow Slack; Remove github_v2')
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
