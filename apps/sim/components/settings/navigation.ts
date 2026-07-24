import type { ComponentType } from 'react'
import {
  ClipboardList,
  Clock,
  Database,
  HexSimple,
  Key,
  KeySquare,
  Link,
  Lock,
  LogIn,
  Palette,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Shuffle,
  TerminalWindow,
  TrashOutline,
  Upload,
  User,
  Users,
  Wrench,
} from '@sim/emcn/icons'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { McpIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'

export type SettingsPlane = 'account' | 'organization' | 'workspace'

export type AccountSettingsSection =
  | 'general'
  | 'billing'
  | 'api-keys'
  | 'copilot'
  | 'admin'
  | 'mothership'

export type OrganizationSettingsSection =
  | 'members'
  | 'billing'
  | 'access-control'
  | 'audit-logs'
  | 'sso'
  | 'domains'
  | 'sessions'
  | 'data-retention'
  | 'data-drains'
  | 'whitelabeling'

export type WorkspaceSettingsSection =
  | 'teammates'
  | 'secrets'
  | 'byok'
  | 'custom-tools'
  | 'mcp'
  | 'workflow-mcp-servers'
  | 'api-keys'
  | 'inbox'
  | 'recently-deleted'
  | 'forks'
  | 'custom-blocks'

export type SettingsSection =
  | AccountSettingsSection
  | OrganizationSettingsSection
  | WorkspaceSettingsSection

export type OrganizationSettingsRouteSection = OrganizationSettingsSection | 'unavailable'

export interface SettingsNavigationItem<Section extends string = string> {
  id: Section
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  group: string
  docsLink?: string
}

export type UnifiedSettingsSection =
  | 'general'
  | 'secrets'
  | 'access-control'
  | 'custom-blocks'
  | 'audit-logs'
  | 'apikeys'
  | 'byok'
  | 'billing'
  | 'teammates'
  | 'organization'
  | 'sso'
  | 'domains'
  | 'whitelabeling'
  | 'copilot'
  | 'forks'
  | 'mcp'
  | 'custom-tools'
  | 'workflow-mcp-servers'
  | 'inbox'
  | 'admin'
  | 'sessions'
  | 'data-retention'
  | 'data-drains'
  | 'mothership'
  | 'recently-deleted'

export type UnifiedNavigationSection =
  | 'account'
  | 'subscription'
  | 'tools'
  | 'system'
  | 'enterprise'
  | 'superuser'

export interface UnifiedSettingsNavigationItem {
  id: UnifiedSettingsSection
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  section: UnifiedNavigationSection
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresMax?: boolean
  requiresHosted?: boolean
  selfHostedOverride?: boolean
  requiresSuperUser?: boolean
  requiresAdminRole?: boolean
  allowNonOrgAdmin?: boolean
  showWhenLocked?: boolean
  hideForEnterprise?: boolean
  externalUrl?: string
  docsLink?: string
}

interface UnifiedSettingsProjection
  extends Omit<UnifiedSettingsNavigationItem, 'label' | 'icon' | 'section' | 'docsLink'> {
  group: UnifiedNavigationSection
}

interface SettingsPlaneSectionMap {
  account: AccountSettingsSection
  organization: OrganizationSettingsSection
  workspace: WorkspaceSettingsSection
}

interface SettingsPlaneProjection<Section extends string> {
  id: Section
  group: string
  order: number
  /** Plane-specific label, only when the surface's scope genuinely differs. */
  label?: string
  /** Plane-specific description, only when the surface's scope genuinely differs. */
  description?: string
}

type SettingsPlaneProjections = {
  readonly [Plane in SettingsPlane]?: SettingsPlaneProjection<SettingsPlaneSectionMap[Plane]>
}

export interface SettingsSectionRegistryEntry {
  label: string
  icon: ComponentType<{ className?: string }>
  docsLink?: string
  unified: UnifiedSettingsProjection
  planes?: SettingsPlaneProjections
}

const SETTINGS_SELF_HOSTED_OVERRIDES = {
  accessControl: isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED')),
  auditLogs: isTruthy(getEnv('NEXT_PUBLIC_AUDIT_LOGS_ENABLED')),
  customBlocks: isTruthy(getEnv('NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED')),
  dataDrains: isTruthy(getEnv('NEXT_PUBLIC_DATA_DRAINS_ENABLED')),
  dataRetention: isTruthy(getEnv('NEXT_PUBLIC_DATA_RETENTION_ENABLED')),
  inbox: isTruthy(getEnv('NEXT_PUBLIC_INBOX_ENABLED')),
  sessionPolicies: isTruthy(getEnv('NEXT_PUBLIC_SESSION_POLICIES_ENABLED')),
  sso: isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED')),
  whitelabeling: isTruthy(getEnv('NEXT_PUBLIC_WHITELABELING_ENABLED')),
} as const

export const SETTINGS_NAVIGATION_BILLING_ENABLED = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

type SettingsHrefSearchParams = Pick<URLSearchParams, 'toString'>

function withSettingsSearchParams(
  pathname: string,
  searchParams?: SettingsHrefSearchParams
): string {
  const query = searchParams?.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function getAccountSettingsHref(
  section: AccountSettingsSection,
  searchParams?: SettingsHrefSearchParams
): string {
  return withSettingsSearchParams(`/account/settings/${section}`, searchParams)
}

export function getOrganizationSettingsHref(
  organizationId: string,
  section: OrganizationSettingsRouteSection,
  searchParams?: SettingsHrefSearchParams
): string {
  return withSettingsSearchParams(
    `/organization/${organizationId}/settings/${section}`,
    searchParams
  )
}

export function getWorkspaceSettingsHref(
  workspaceId: string,
  section: WorkspaceSettingsSection,
  searchParams?: SettingsHrefSearchParams
): string {
  return withSettingsSearchParams(`/workspace/${workspaceId}/settings/${section}`, searchParams)
}

export const ACCOUNT_SETTINGS_PATH_ALIASES = {
  apikeys: 'api-keys',
} as const satisfies Readonly<Record<string, AccountSettingsSection>>

export const ORGANIZATION_SETTINGS_PATH_ALIASES = {
  organization: 'members',
} as const satisfies Readonly<Record<string, OrganizationSettingsSection>>

export const WORKSPACE_SETTINGS_PATH_ALIASES = {
  apikeys: 'api-keys',
} as const satisfies Readonly<Record<string, WorkspaceSettingsSection>>

interface ParseSettingsPathSectionOptions<
  Section extends string,
  DefaultSection extends Section | null,
> {
  path: string | null | undefined
  items: readonly SettingsNavigationItem<Section>[]
  defaultSection: DefaultSection
  aliases?: Readonly<Partial<Record<string, Section>>>
}

/**
 * Resolves the first segment after `settings`, or a route-provided section
 * segment, against a typed settings catalog.
 */
export function parseSettingsPathSection<
  Section extends string,
  const DefaultSection extends Section | null,
>({
  path,
  items,
  defaultSection,
  aliases,
}: ParseSettingsPathSectionOptions<Section, DefaultSection>): Section | DefaultSection {
  if (!path) return defaultSection

  const pathname = path.split(/[?#]/, 1)[0]
  const segments = pathname.split('/').filter(Boolean)
  const settingsIndex = segments.lastIndexOf('settings')
  let pathSection: string | undefined
  if (settingsIndex === -1) {
    pathSection = segments.length === 1 ? segments[0] : undefined
  } else {
    pathSection = segments[settingsIndex + 1]
  }
  if (!pathSection) return defaultSection

  const normalized = aliases?.[pathSection] ?? pathSection
  return items.find((item) => item.id === normalized)?.id ?? defaultSection
}

export const ACCOUNT_SETTINGS_GROUPS = [
  { key: 'account', title: 'Account' },
  { key: 'developer', title: 'Developer' },
  { key: 'platform', title: 'Platform' },
] as const

export const ORGANIZATION_SETTINGS_GROUPS = [
  { key: 'organization', title: 'Organization' },
  { key: 'security', title: 'Security' },
  { key: 'enterprise', title: 'Enterprise' },
] as const

export const WORKSPACE_SETTINGS_GROUPS = [
  { key: 'workspace', title: 'Workspace' },
  { key: 'tools', title: 'Tools' },
  { key: 'system', title: 'System' },
  { key: 'enterprise', title: 'Enterprise' },
] as const

export const SETTINGS_SECTION_REGISTRY: readonly SettingsSectionRegistryEntry[] = [
  {
    label: 'General',
    icon: Settings,
    unified: {
      id: 'general',
      description: 'Manage your profile, appearance, and preferences.',
      group: 'account',
    },
    planes: {
      account: { id: 'general', group: 'account', order: 0 },
    },
  },
  {
    label: 'Access control',
    icon: ShieldCheck,
    docsLink: 'https://docs.sim.ai/platform/enterprise/access-control',
    unified: {
      id: 'access-control',
      description: 'Manage permission groups across your organization.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.accessControl,
    },
    planes: {
      organization: { id: 'access-control', group: 'security', order: 2 },
    },
  },
  {
    label: 'Audit logs',
    icon: ClipboardList,
    docsLink: 'https://docs.sim.ai/platform/enterprise/audit-logs',
    unified: {
      id: 'audit-logs',
      description: 'Review activity and changes across your organization.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.auditLogs,
    },
    planes: {
      organization: { id: 'audit-logs', group: 'security', order: 3 },
    },
  },
  {
    label: 'Workspace Forks',
    icon: Shuffle,
    docsLink: 'https://docs.sim.ai/platform/enterprise/forks',
    unified: {
      id: 'forks',
      description: 'Fork this workspace and sync changes with its parent.',
      group: 'enterprise',
    },
    planes: {
      workspace: { id: 'forks', group: 'enterprise', order: 9 },
    },
  },
  {
    label: 'Billing',
    icon: ClipboardList,
    unified: {
      id: 'billing',
      description: 'Manage your plan, pricing, and invoices.',
      group: 'subscription',
      hideWhenBillingDisabled: true,
    },
    planes: {
      account: {
        id: 'billing',
        description: 'Manage your personal plan, usage, and invoices.',
        group: 'account',
        order: 1,
      },
      organization: {
        id: 'billing',
        description: 'Manage the organization plan, usage, and invoices.',
        group: 'organization',
        order: 1,
      },
    },
  },
  {
    label: 'Teammates',
    icon: User,
    unified: {
      id: 'teammates',
      description: 'Manage your teammates in this workspace.',
      group: 'subscription',
    },
    planes: {
      workspace: { id: 'teammates', group: 'workspace', order: 0 },
    },
  },
  {
    label: 'Organization',
    icon: Users,
    unified: {
      id: 'organization',
      description: "Manage your organization's members and seats.",
      group: 'subscription',
      hideWhenBillingDisabled: true,
      requiresHosted: true,
      requiresTeam: true,
    },
    planes: {
      organization: {
        id: 'members',
        label: 'Members',
        description: 'Manage organization members, roles, and seats.',
        group: 'organization',
        order: 0,
      },
    },
  },
  {
    label: 'Secrets',
    icon: Key,
    unified: {
      id: 'secrets',
      description: 'Store environment variables for your workflows.',
      group: 'account',
    },
    planes: {
      workspace: { id: 'secrets', group: 'workspace', order: 1 },
    },
  },
  {
    label: 'Custom tools',
    icon: Wrench,
    unified: {
      id: 'custom-tools',
      description: 'Create and manage custom tools for your agents.',
      group: 'tools',
    },
    planes: {
      workspace: { id: 'custom-tools', group: 'tools', order: 3 },
    },
  },
  {
    label: 'MCP tools',
    icon: McpIcon,
    unified: {
      id: 'mcp',
      description: 'Connect MCP servers and use their tools in workflows.',
      group: 'tools',
    },
    planes: {
      workspace: { id: 'mcp', group: 'tools', order: 4 },
    },
  },
  {
    label: 'Sim API keys',
    icon: TerminalWindow,
    unified: {
      id: 'apikeys',
      description: 'Create and manage API keys for the Sim API.',
      group: 'system',
    },
    planes: {
      account: {
        id: 'api-keys',
        description: 'Create and manage your personal Sim API keys.',
        group: 'developer',
        order: 2,
      },
      workspace: {
        id: 'api-keys',
        description: 'Manage workspace API keys and personal-key policy.',
        group: 'system',
        order: 6,
      },
    },
  },
  {
    label: 'MCP servers',
    icon: Server,
    unified: {
      id: 'workflow-mcp-servers',
      description: 'Expose your workflows as tools on an MCP server.',
      group: 'system',
    },
    planes: {
      workspace: { id: 'workflow-mcp-servers', group: 'tools', order: 5 },
    },
  },
  {
    label: 'BYOK',
    icon: KeySquare,
    unified: {
      id: 'byok',
      description: 'Bring your own model-provider API keys.',
      group: 'system',
      requiresHosted: true,
    },
    planes: {
      workspace: { id: 'byok', group: 'workspace', order: 2 },
    },
  },
  {
    label: 'Chat keys',
    icon: HexSimple,
    unified: {
      id: 'copilot',
      description: 'Manage the model-provider keys that power Chat.',
      group: 'system',
      requiresHosted: true,
    },
    planes: {
      account: { id: 'copilot', group: 'developer', order: 3 },
    },
  },
  {
    label: 'Sim mailer',
    icon: Send,
    unified: {
      id: 'inbox',
      description: 'Trigger and process workflows from incoming email.',
      group: 'system',
      requiresMax: true,
      requiresHosted: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.inbox,
      showWhenLocked: true,
    },
    planes: {
      workspace: { id: 'inbox', group: 'system', order: 7 },
    },
  },
  {
    label: 'Recently deleted',
    icon: TrashOutline,
    unified: {
      id: 'recently-deleted',
      description: 'Restore items deleted in the last 30 days.',
      group: 'system',
    },
    planes: {
      workspace: { id: 'recently-deleted', group: 'system', order: 8 },
    },
  },
  {
    label: 'Single sign-on',
    icon: LogIn,
    docsLink: 'https://docs.sim.ai/platform/enterprise/sso',
    unified: {
      id: 'sso',
      description: 'Configure single sign-on for your organization.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.sso,
    },
    planes: {
      organization: { id: 'sso', group: 'security', order: 4 },
    },
  },
  {
    label: 'Verified domains',
    icon: Link,
    docsLink: 'https://docs.sim.ai/platform/enterprise/verified-domains',
    unified: {
      id: 'domains',
      description: 'Prove ownership of your email domains before configuring SSO.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.sso,
    },
    planes: {
      organization: { id: 'domains', group: 'security', order: 5 },
    },
  },
  {
    label: 'Session policies',
    icon: Clock,
    docsLink: 'https://docs.sim.ai/platform/enterprise/session-policies',
    unified: {
      id: 'sessions',
      description: 'Limit session lifetimes and sign out members org-wide.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.sessionPolicies,
    },
    planes: {
      organization: { id: 'sessions', group: 'security', order: 6 },
    },
  },
  {
    label: 'Data retention',
    icon: Database,
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-retention',
    unified: {
      id: 'data-retention',
      description:
        'Control data retention windows and PII redaction. Workspaces without an override inherit the organization defaults.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.dataRetention,
    },
    planes: {
      organization: { id: 'data-retention', group: 'enterprise', order: 7 },
    },
  },
  {
    label: 'Data drains',
    icon: Upload,
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-drains',
    unified: {
      id: 'data-drains',
      description: 'Stream your logs and events to external destinations.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.dataDrains,
    },
    planes: {
      organization: { id: 'data-drains', group: 'enterprise', order: 8 },
    },
  },
  {
    label: 'Whitelabeling',
    icon: Palette,
    docsLink: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
    unified: {
      id: 'whitelabeling',
      description: 'Customize your workspace branding and appearance.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.whitelabeling,
    },
    planes: {
      organization: { id: 'whitelabeling', group: 'enterprise', order: 9 },
    },
  },
  {
    label: 'Custom blocks',
    icon: HexSimple,
    docsLink: 'https://docs.sim.ai/platform/enterprise/custom-blocks',
    unified: {
      id: 'custom-blocks',
      description: 'Publish workflows as reusable blocks for your organization.',
      group: 'enterprise',
      requiresHosted: true,
      requiresEnterprise: true,
      allowNonOrgAdmin: true,
      selfHostedOverride: SETTINGS_SELF_HOSTED_OVERRIDES.customBlocks,
    },
    planes: {
      workspace: { id: 'custom-blocks', group: 'enterprise', order: 10 },
    },
  },
  {
    label: 'Admin',
    icon: Lock,
    unified: {
      id: 'admin',
      description: 'Superuser administration and workspace tools.',
      group: 'superuser',
      requiresAdminRole: true,
    },
    planes: {
      account: { id: 'admin', group: 'platform', order: 4 },
    },
  },
  {
    label: 'Mothership',
    icon: Server,
    unified: {
      id: 'mothership',
      description: 'Internal Sim operations and license management.',
      group: 'superuser',
      requiresAdminRole: true,
    },
    planes: {
      account: { id: 'mothership', group: 'platform', order: 5 },
    },
  },
]

export function buildUnifiedSettingsNavigation(): UnifiedSettingsNavigationItem[] {
  return SETTINGS_SECTION_REGISTRY.map(({ label, icon, docsLink, unified }) => {
    const { group, ...item } = unified
    return {
      ...item,
      label,
      icon,
      section: group,
      ...(docsLink ? { docsLink } : {}),
    }
  })
}

function buildPlaneSettingsItems<Plane extends SettingsPlane>(
  plane: Plane
): SettingsNavigationItem<SettingsPlaneSectionMap[Plane]>[] {
  return SETTINGS_SECTION_REGISTRY.flatMap((entry) => {
    const projection = entry.planes?.[plane]
    return projection ? [{ entry, projection }] : []
  })
    .sort((left, right) => left.projection.order - right.projection.order)
    .map(({ entry, projection }) => ({
      id: projection.id,
      label: projection.label ?? entry.label,
      description: projection.description ?? entry.unified.description,
      icon: entry.icon,
      group: projection.group,
      ...(entry.docsLink ? { docsLink: entry.docsLink } : {}),
    }))
}

export const ACCOUNT_SETTINGS_ITEMS: SettingsNavigationItem<AccountSettingsSection>[] =
  buildPlaneSettingsItems('account')

export const ORGANIZATION_SETTINGS_ITEMS: SettingsNavigationItem<OrganizationSettingsSection>[] =
  buildPlaneSettingsItems('organization')

export const WORKSPACE_SETTINGS_ITEMS: SettingsNavigationItem<WorkspaceSettingsSection>[] =
  buildPlaneSettingsItems('workspace')

/**
 * Unified sections that resolve to organization-plane settings. The workspace
 * settings section page routes these through the organization gate (host
 * organization present + org-admin viewer), so workspace-plane navigation must
 * apply the same requirement before surfacing them.
 */
export const ORGANIZATION_PLANE_UNIFIED_SECTIONS: ReadonlySet<UnifiedSettingsSection> = new Set(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) =>
    entry.planes?.organization ? [entry.unified.id] : []
  )
)

export type OrganizationSectionAccess = 'unavailable' | 'view' | 'manage'

interface ResolveOrganizationSectionAccessOptions {
  section: OrganizationSettingsSection
  isTargetOrganizationMember: boolean
  isTargetOrganizationAdmin: boolean
}

export function resolveOrganizationSectionAccess({
  section,
  isTargetOrganizationMember,
  isTargetOrganizationAdmin,
}: ResolveOrganizationSectionAccessOptions): OrganizationSectionAccess {
  if (!isTargetOrganizationMember) return 'unavailable'
  if (section === 'members') return isTargetOrganizationAdmin ? 'manage' : 'view'
  return isTargetOrganizationAdmin ? 'manage' : 'unavailable'
}

export interface OrganizationSettingsFeatures {
  billingEnabled: boolean
  hasEnterprisePlan: boolean
  hosted: boolean
  selfHosted: Partial<Record<OrganizationSettingsSection, boolean>>
}

export function getOrganizationSettingsFeatures(
  hasEnterprisePlan: boolean
): OrganizationSettingsFeatures {
  return {
    billingEnabled: SETTINGS_NAVIGATION_BILLING_ENABLED,
    hasEnterprisePlan,
    hosted: isHosted,
    selfHosted: {
      'access-control': SETTINGS_SELF_HOSTED_OVERRIDES.accessControl,
      'audit-logs': SETTINGS_SELF_HOSTED_OVERRIDES.auditLogs,
      sso: SETTINGS_SELF_HOSTED_OVERRIDES.sso,
      domains: SETTINGS_SELF_HOSTED_OVERRIDES.sso,
      sessions: SETTINGS_SELF_HOSTED_OVERRIDES.sessionPolicies,
      'data-retention': SETTINGS_SELF_HOSTED_OVERRIDES.dataRetention,
      'data-drains': SETTINGS_SELF_HOSTED_OVERRIDES.dataDrains,
      whitelabeling: SETTINGS_SELF_HOSTED_OVERRIDES.whitelabeling,
    },
  }
}

/**
 * Applies deployment and target-organization plan gates without consulting the
 * viewer's active organization.
 */
export function isOrganizationSettingsSectionAvailable(
  section: OrganizationSettingsSection,
  features: OrganizationSettingsFeatures
): boolean {
  if (section === 'members') return true
  if (section === 'billing') return features.billingEnabled
  if (features.hosted) return features.hasEnterprisePlan
  return features.selfHosted[section] ?? false
}

export interface WorkspacePermissionConfig {
  hideSecretsTab?: boolean
  hideApiKeysTab?: boolean
  hideInboxTab?: boolean
  disableMcpTools?: boolean
  disableCustomTools?: boolean
}

export interface WorkspaceSettingsEntitlements {
  byok: boolean
  customBlocks: boolean
  forks: boolean
  inbox: boolean
}

interface ResolveWorkspaceNavigationOptions {
  permission: PermissionType
  permissionConfig: WorkspacePermissionConfig
  entitlements: WorkspaceSettingsEntitlements
}

export interface ResolvedWorkspaceNavigationItem
  extends SettingsNavigationItem<WorkspaceSettingsSection> {
  canMutate: boolean
  locked: boolean
}

const WORKSPACE_MUTATION_PERMISSION: Record<WorkspaceSettingsSection, PermissionType> = {
  teammates: 'admin',
  secrets: 'write',
  byok: 'admin',
  'custom-tools': 'write',
  mcp: 'write',
  'workflow-mcp-servers': 'write',
  'api-keys': 'admin',
  inbox: 'admin',
  'recently-deleted': 'write',
  forks: 'admin',
  'custom-blocks': 'admin',
}

export interface WorkspaceMutationCapabilities {
  canAdmin: boolean
  canEdit: boolean
}

export function canMutateWorkspaceSettingsSection(
  section: WorkspaceSettingsSection,
  capabilities: WorkspaceMutationCapabilities
): boolean {
  return WORKSPACE_MUTATION_PERMISSION[section] === 'admin'
    ? capabilities.canAdmin
    : capabilities.canEdit
}

export function resolveWorkspaceNavigation({
  permission,
  permissionConfig,
  entitlements,
}: ResolveWorkspaceNavigationOptions): ResolvedWorkspaceNavigationItem[] {
  return WORKSPACE_SETTINGS_ITEMS.flatMap((item) => {
    if (item.id === 'secrets' && permissionConfig.hideSecretsTab) return []
    if (item.id === 'api-keys' && permissionConfig.hideApiKeysTab) return []
    if (item.id === 'inbox' && permissionConfig.hideInboxTab) return []
    if (item.id === 'mcp' && permissionConfig.disableMcpTools) return []
    if (item.id === 'custom-tools' && permissionConfig.disableCustomTools) return []
    if (item.id === 'forks' && (permission !== 'admin' || !entitlements.forks)) return []
    if (item.id === 'byok' && !entitlements.byok) return []
    if (item.id === 'custom-blocks' && !entitlements.customBlocks) return []

    const locked = item.id === 'inbox' && !entitlements.inbox
    const canMutate =
      !locked &&
      canMutateWorkspaceSettingsSection(item.id, {
        canEdit: permissionSatisfies(permission, 'write'),
        canAdmin: permissionSatisfies(permission, 'admin'),
      })

    return [{ ...item, canMutate, locked }]
  })
}

export function getSettingsSectionMeta(
  plane: SettingsPlane,
  section: string
): Pick<SettingsNavigationItem, 'label' | 'description' | 'docsLink'> | null {
  const catalog =
    plane === 'account'
      ? ACCOUNT_SETTINGS_ITEMS
      : plane === 'organization'
        ? ORGANIZATION_SETTINGS_ITEMS
        : WORKSPACE_SETTINGS_ITEMS
  const item = catalog.find((candidate) => candidate.id === section)
  return item ? { label: item.label, description: item.description, docsLink: item.docsLink } : null
}
