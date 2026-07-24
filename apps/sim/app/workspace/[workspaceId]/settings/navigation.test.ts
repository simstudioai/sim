import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTION_REGISTRY,
  WORKSPACE_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import {
  allNavigationItems,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'

describe('unified settings navigation', () => {
  it('preserves the original settings groups', () => {
    expect(sectionConfig).toEqual([
      { key: 'account', title: 'Account' },
      { key: 'tools', title: 'Tools' },
      { key: 'subscription', title: 'Subscription' },
      { key: 'system', title: 'System' },
      { key: 'enterprise', title: 'Enterprise' },
      { key: 'superuser', title: 'Superuser' },
    ])
  })

  it('keeps account, workspace, organization, and platform settings in one catalog', () => {
    expect(allNavigationItems.map(({ id, label, section }) => ({ id, label, section }))).toEqual([
      { id: 'general', label: 'General', section: 'account' },
      { id: 'access-control', label: 'Access control', section: 'enterprise' },
      { id: 'audit-logs', label: 'Audit logs', section: 'enterprise' },
      { id: 'forks', label: 'Workspace Forks', section: 'enterprise' },
      { id: 'billing', label: 'Billing', section: 'subscription' },
      { id: 'teammates', label: 'Teammates', section: 'subscription' },
      { id: 'organization', label: 'Organization', section: 'subscription' },
      { id: 'secrets', label: 'Secrets', section: 'account' },
      { id: 'custom-tools', label: 'Custom tools', section: 'tools' },
      { id: 'mcp', label: 'MCP tools', section: 'tools' },
      { id: 'apikeys', label: 'Sim API keys', section: 'system' },
      { id: 'workflow-mcp-servers', label: 'MCP servers', section: 'system' },
      { id: 'byok', label: 'BYOK', section: 'system' },
      { id: 'copilot', label: 'Chat keys', section: 'system' },
      { id: 'inbox', label: 'Sim mailer', section: 'system' },
      { id: 'recently-deleted', label: 'Recently deleted', section: 'system' },
      { id: 'sso', label: 'Single sign-on', section: 'enterprise' },
      { id: 'domains', label: 'Verified domains', section: 'enterprise' },
      { id: 'sessions', label: 'Session policies', section: 'enterprise' },
      { id: 'data-retention', label: 'Data retention', section: 'enterprise' },
      { id: 'data-drains', label: 'Data drains', section: 'enterprise' },
      { id: 'whitelabeling', label: 'Whitelabeling', section: 'enterprise' },
      { id: 'custom-blocks', label: 'Custom blocks', section: 'enterprise' },
      { id: 'admin', label: 'Admin', section: 'superuser' },
      { id: 'mothership', label: 'Mothership', section: 'superuser' },
    ])
  })

  it('derives every unified item from exactly one registry entry', () => {
    expect(allNavigationItems).toHaveLength(SETTINGS_SECTION_REGISTRY.length)
    for (const item of allNavigationItems) {
      expect(
        SETTINGS_SECTION_REGISTRY.filter(({ unified }) => unified.id === item.id)
      ).toHaveLength(1)
    }
  })

  it('shares labels, icons, and docs links with plane projections', () => {
    const unifiedForks = allNavigationItems.find(({ id }) => id === 'forks')
    const workspaceForks = WORKSPACE_SETTINGS_ITEMS.find(({ id }) => id === 'forks')

    expect(workspaceForks?.label).toBe(unifiedForks?.label)
    expect(workspaceForks?.icon).toBe(unifiedForks?.icon)
    expect(workspaceForks?.docsLink).toBe(unifiedForks?.docsLink)
  })
})
