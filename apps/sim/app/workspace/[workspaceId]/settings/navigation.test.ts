import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTION_REGISTRY,
  WORKSPACE_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import {
  allNavigationItems,
  resolveSettingsSection,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'

describe('unified settings navigation', () => {
  it('groups settings by the scope they affect', () => {
    expect(sectionConfig).toEqual([
      { key: 'account', title: 'Account' },
      { key: 'workspace', title: 'Workspace' },
      { key: 'organization', title: 'Organization' },
      { key: 'platform', title: 'Platform' },
    ])
  })

  it('keeps account, workspace, organization, and platform settings in one catalog', () => {
    expect(allNavigationItems.map(({ id, label, section }) => ({ id, label, section }))).toEqual([
      { id: 'general', label: 'General', section: 'account' },
      { id: 'desktop', label: 'Desktop', section: 'account' },
      { id: 'browser', label: 'Browser', section: 'account' },
      { id: 'terminal', label: 'Terminal', section: 'account' },
      { id: 'access-control', label: 'Permission groups', section: 'organization' },
      { id: 'audit-logs', label: 'Audit logs', section: 'organization' },
      { id: 'forks', label: 'Workspace forks', section: 'organization' },
      { id: 'billing', label: 'Subscription', section: 'account' },
      { id: 'teammates', label: 'Teammates', section: 'workspace' },
      { id: 'organization', label: 'Members', section: 'organization' },
      { id: 'usage', label: 'Usage tracking', section: 'organization' },
      { id: 'secrets', label: 'Secrets', section: 'workspace' },
      { id: 'credential-groups', label: 'Credential groups', section: 'workspace' },
      { id: 'custom-tools', label: 'Custom tools', section: 'workspace' },
      { id: 'mcp', label: 'MCP tools', section: 'workspace' },
      { id: 'apikeys', label: 'Sim API keys', section: 'workspace' },
      { id: 'workflow-mcp-servers', label: 'MCP servers', section: 'workspace' },
      { id: 'byok', label: 'BYOK', section: 'workspace' },
      { id: 'sandboxes', label: 'Sandboxes', section: 'workspace' },
      { id: 'inbox', label: 'Sim Mailer', section: 'workspace' },
      { id: 'recently-deleted', label: 'Recently deleted', section: 'workspace' },
      { id: 'self-host', label: 'Self hosting', section: 'platform' },
      { id: 'sso', label: 'Single sign-on', section: 'organization' },
      { id: 'sessions', label: 'Session policies', section: 'organization' },
      { id: 'data-retention', label: 'Data retention', section: 'organization' },
      { id: 'data-drains', label: 'Data drains', section: 'organization' },
      { id: 'whitelabeling', label: 'White-labeling', section: 'organization' },
      { id: 'custom-blocks', label: 'Custom blocks', section: 'organization' },
      { id: 'admin', label: 'Admin', section: 'platform' },
      { id: 'mothership', label: 'Mothership', section: 'platform' },
    ])
  })

  it('orders each scope around its primary settings', () => {
    const idsForSection = (section: (typeof sectionConfig)[number]['key']) =>
      allNavigationItems
        .filter((item) => item.section === section)
        .sort((left, right) => left.order - right.order)
        .map(({ id }) => id)

    expect(idsForSection('account')).toEqual([
      'general',
      'billing',
      'desktop',
      'browser',
      'terminal',
    ])
    expect(idsForSection('workspace')).toEqual([
      'teammates',
      'secrets',
      'mcp',
      'custom-tools',
      'byok',
      'inbox',
      'workflow-mcp-servers',
      'apikeys',
      'sandboxes',
      'credential-groups',
      'recently-deleted',
    ])
    expect(idsForSection('organization')).toEqual([
      'organization',
      'usage',
      'custom-blocks',
      'forks',
      'access-control',
      'audit-logs',
      'whitelabeling',
      'sso',
      'sessions',
      'data-retention',
      'data-drains',
    ])
    expect(idsForSection('platform')).toEqual(['admin', 'mothership', 'self-host'])
  })

  it('derives every unified item from exactly one registry entry', () => {
    expect(allNavigationItems).toHaveLength(
      SETTINGS_SECTION_REGISTRY.filter(({ unified }) => unified).length
    )
    for (const item of allNavigationItems) {
      expect(
        SETTINGS_SECTION_REGISTRY.filter(({ unified }) => unified?.id === item.id)
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

describe('resolveSettingsSection', () => {
  const LEGACY_SEGMENTS = {
    subscription: 'billing',
    team: 'organization',
    'api-keys': 'apikeys',
    domains: 'sso',
  } as const

  it('keeps legacy section links working', () => {
    for (const [segment, id] of Object.entries(LEGACY_SEGMENTS)) {
      expect(resolveSettingsSection(segment)?.id).toBe(id)
    }
  })

  it('never shadows a real section with an alias', () => {
    // The day someone adds a section whose id collides with an alias key, that section becomes
    // unreachable — the alias would rewrite the segment before the catalog is consulted.
    for (const segment of Object.keys(LEGACY_SEGMENTS)) {
      expect(allNavigationItems.some((item) => item.id === segment)).toBe(false)
    }
  })

  it('resolves a canonical segment to itself and an unknown one to null', () => {
    expect(resolveSettingsSection('secrets')?.id).toBe('secrets')
    expect(resolveSettingsSection('unknown')).toBeNull()
    expect(resolveSettingsSection('')).toBeNull()
  })

  it('carries the catalog label through as the header title', () => {
    // `billing` is the case where id and label visibly differ, and the title feeds both the
    // shell heading and the document title via generateMetadata.
    const billing = allNavigationItems.find((item) => item.id === 'billing')
    expect(resolveSettingsSection('subscription')?.meta.title).toBe(billing?.label)
    expect(billing?.label).not.toBe('billing')
  })
})
