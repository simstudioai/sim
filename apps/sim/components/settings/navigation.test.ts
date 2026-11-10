import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  canMutateWorkspaceSettingsSection,
  getOrganizationSettingsFeatures,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
} from '@/components/settings/navigation'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import { organizationPlanAllowsSettingsSection } from '@/lib/settings/section-availability'

const SELF_HOSTED: DeploymentShape = {
  hosted: false,
  billingEnabled: false,
  chatEnabled: true,
  azureConfigured: false,
  cohereConfigured: false,
  invitationsDisabled: false,
  features: {
    accessControl: false,
    auditLogs: false,
    customBlocks: false,
    dataDrains: false,
    dataRetention: false,
    inbox: true,
    sandboxes: false,
    sessionPolicies: true,
    sso: false,
    usageMonitoring: false,
    whitelabeling: true,
  },
}

describe('settings navigation boundaries', () => {
  it('parses canonical, nested, and aliased account settings paths', () => {
    const parseAccountPath = (path: string, defaultSection: 'general' | null) =>
      parseSettingsPathSection({
        path,
        items: ACCOUNT_SETTINGS_ITEMS,
        defaultSection,
        aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
      })

    expect(parseAccountPath('general', null)).toBe('general')
    expect(parseAccountPath('/account/settings/billing/credit-usage', null)).toBe('billing')
    expect(parseAccountPath('/account/settings/apikeys', null)).toBe('api-keys')
    expect(parseAccountPath('/account/settings/not-a-section', null)).toBeNull()
    expect(parseAccountPath('/account/settings', 'general')).toBe('general')
  })

  it('requires target-organization membership and admin authority', () => {
    expect(
      resolveOrganizationSectionAccess({
        section: 'members',
        isTargetOrganizationMember: false,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'members',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('view')
    expect(
      resolveOrganizationSectionAccess({
        section: 'sso',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'sso',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('manage')
  })

  it('allows member requests while reserving management for organization admins', () => {
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('view')
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: false,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('manage')
    expect(
      organizationPlanAllowsSettingsSection(
        'requests',
        getOrganizationSettingsFeatures(false, SELF_HOSTED)
      )
    ).toBe(true)
    expect(
      organizationPlanAllowsSettingsSection(
        'requests',
        getOrganizationSettingsFeatures(false, {
          ...SELF_HOSTED,
          features: { ...SELF_HOSTED.features, accessControl: true },
        })
      )
    ).toBe(true)
  })

  it('uses server-aligned mutation permissions for workspace settings', () => {
    const writer = { canEdit: true, canAdmin: false }
    expect(canMutateWorkspaceSettingsSection('custom-tools', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('mcp', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('recently-deleted', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('workflow-mcp-servers', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('api-keys', writer)).toBe(false)
    expect(canMutateWorkspaceSettingsSection('inbox', writer)).toBe(false)
  })
})
