import type { ComponentType } from 'react'
import {
  ClipboardList,
  Database,
  HexSimple,
  Key,
  KeySquare,
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
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

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

export const ACCOUNT_SETTINGS_ITEMS: SettingsNavigationItem<AccountSettingsSection>[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Manage your profile, appearance, and preferences.',
    icon: Settings,
    group: 'account',
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Manage your personal plan, usage, and invoices.',
    icon: ClipboardList,
    group: 'account',
  },
  {
    id: 'api-keys',
    label: 'Sim API keys',
    description: 'Create and manage your personal Sim API keys.',
    icon: TerminalWindow,
    group: 'developer',
  },
  {
    id: 'copilot',
    label: 'Chat keys',
    description: 'Manage the model-provider keys that power Chat.',
    icon: HexSimple,
    group: 'developer',
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Manage platform users and superuser preferences.',
    icon: Lock,
    group: 'platform',
  },
  {
    id: 'mothership',
    label: 'Mothership',
    description: 'Manage internal operations and license settings.',
    icon: Server,
    group: 'platform',
  },
]

export const ORGANIZATION_SETTINGS_ITEMS: SettingsNavigationItem<OrganizationSettingsSection>[] = [
  {
    id: 'members',
    label: 'Members',
    description: 'Manage organization members, roles, and seats.',
    icon: Users,
    group: 'organization',
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Manage the organization plan, usage, and invoices.',
    icon: ClipboardList,
    group: 'organization',
  },
  {
    id: 'access-control',
    label: 'Access control',
    description: 'Manage permission groups across the organization.',
    icon: ShieldCheck,
    group: 'security',
    docsLink: 'https://docs.sim.ai/platform/enterprise/access-control',
  },
  {
    id: 'audit-logs',
    label: 'Audit logs',
    description: 'Review activity and changes across the organization.',
    icon: ClipboardList,
    group: 'security',
    docsLink: 'https://docs.sim.ai/platform/enterprise/audit-logs',
  },
  {
    id: 'sso',
    label: 'Single sign-on',
    description: 'Configure single sign-on for the organization.',
    icon: LogIn,
    group: 'security',
    docsLink: 'https://docs.sim.ai/platform/enterprise/sso',
  },
  {
    id: 'data-retention',
    label: 'Data retention',
    description: 'Control retention windows and PII redaction.',
    icon: Database,
    group: 'enterprise',
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-retention',
  },
  {
    id: 'data-drains',
    label: 'Data drains',
    description: 'Stream organization logs to external destinations.',
    icon: Upload,
    group: 'enterprise',
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-drains',
  },
  {
    id: 'whitelabeling',
    label: 'Whitelabeling',
    description: 'Customize organization branding and appearance.',
    icon: Palette,
    group: 'enterprise',
    docsLink: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
  },
]

export const WORKSPACE_SETTINGS_ITEMS: SettingsNavigationItem<WorkspaceSettingsSection>[] = [
  {
    id: 'teammates',
    label: 'Teammates',
    description: 'View and manage teammates in this workspace.',
    icon: User,
    group: 'workspace',
  },
  {
    id: 'secrets',
    label: 'Secrets',
    description: 'Store environment variables for your workflows.',
    icon: Key,
    group: 'workspace',
  },
  {
    id: 'byok',
    label: 'BYOK',
    description: 'Manage workspace model-provider API keys.',
    icon: KeySquare,
    group: 'workspace',
  },
  {
    id: 'custom-tools',
    label: 'Custom tools',
    description: 'Create and manage custom tools for your agents.',
    icon: Wrench,
    group: 'tools',
  },
  {
    id: 'mcp',
    label: 'MCP tools',
    description: 'Connect MCP servers and use tools in workflows.',
    icon: McpIcon,
    group: 'tools',
  },
  {
    id: 'workflow-mcp-servers',
    label: 'MCP servers',
    description: 'Expose workflows as tools on an MCP server.',
    icon: Server,
    group: 'tools',
  },
  {
    id: 'api-keys',
    label: 'Sim API keys',
    description: 'Manage workspace API keys and personal-key policy.',
    icon: TerminalWindow,
    group: 'system',
  },
  {
    id: 'inbox',
    label: 'Sim mailer',
    description: 'Configure incoming email for this workspace.',
    icon: Send,
    group: 'system',
  },
  {
    id: 'recently-deleted',
    label: 'Recently deleted',
    description: 'Restore workspace items deleted in the last 30 days.',
    icon: TrashOutline,
    group: 'system',
  },
  {
    id: 'forks',
    label: 'Workspace forks',
    description: 'Fork this workspace and synchronize changes.',
    icon: Shuffle,
    group: 'enterprise',
    docsLink: 'https://docs.sim.ai/platform/enterprise/forks',
  },
  {
    id: 'custom-blocks',
    label: 'Custom blocks',
    description: 'Publish workspace workflows as reusable blocks.',
    icon: HexSimple,
    group: 'enterprise',
    docsLink: 'https://docs.sim.ai/platform/enterprise/custom-blocks',
  },
]

interface LegacyAccountSettingsSection {
  legacySection: string
  plane: 'account'
  section: AccountSettingsSection
}

interface LegacyOrganizationSettingsSection {
  legacySection: string
  plane: 'organization'
  section: OrganizationSettingsSection
}

interface LegacyWorkspaceSettingsSection {
  legacySection: string
  plane: 'workspace'
  section: WorkspaceSettingsSection
}

export type LegacySettingsSection =
  | LegacyAccountSettingsSection
  | LegacyOrganizationSettingsSection
  | LegacyWorkspaceSettingsSection

const LEGACY_TOP_LEVEL_WORKSPACE_SECTIONS = ['integrations', 'skills'] as const

export function getLegacyTopLevelWorkspaceHref(
  workspaceId: string,
  legacySection: string
): string | null {
  const section = LEGACY_TOP_LEVEL_WORKSPACE_SECTIONS.find(
    (candidate) => candidate === legacySection
  )
  return section ? `/workspace/${workspaceId}/${section}` : null
}

export const LEGACY_SETTINGS_SECTIONS: LegacySettingsSection[] = [
  { legacySection: 'general', plane: 'account', section: 'general' },
  { legacySection: 'billing', plane: 'organization', section: 'billing' },
  { legacySection: 'subscription', plane: 'organization', section: 'billing' },
  { legacySection: 'copilot', plane: 'account', section: 'copilot' },
  { legacySection: 'admin', plane: 'account', section: 'admin' },
  { legacySection: 'mothership', plane: 'account', section: 'mothership' },
  { legacySection: 'organization', plane: 'organization', section: 'members' },
  { legacySection: 'team', plane: 'organization', section: 'members' },
  { legacySection: 'access-control', plane: 'organization', section: 'access-control' },
  { legacySection: 'audit-logs', plane: 'organization', section: 'audit-logs' },
  { legacySection: 'sso', plane: 'organization', section: 'sso' },
  { legacySection: 'data-retention', plane: 'organization', section: 'data-retention' },
  { legacySection: 'data-drains', plane: 'organization', section: 'data-drains' },
  { legacySection: 'whitelabeling', plane: 'organization', section: 'whitelabeling' },
  { legacySection: 'teammates', plane: 'workspace', section: 'teammates' },
  { legacySection: 'secrets', plane: 'workspace', section: 'secrets' },
  { legacySection: 'byok', plane: 'workspace', section: 'byok' },
  { legacySection: 'custom-tools', plane: 'workspace', section: 'custom-tools' },
  { legacySection: 'mcp', plane: 'workspace', section: 'mcp' },
  {
    legacySection: 'workflow-mcp-servers',
    plane: 'workspace',
    section: 'workflow-mcp-servers',
  },
  { legacySection: 'apikeys', plane: 'workspace', section: 'api-keys' },
  { legacySection: 'inbox', plane: 'workspace', section: 'inbox' },
  { legacySection: 'recently-deleted', plane: 'workspace', section: 'recently-deleted' },
  { legacySection: 'forks', plane: 'workspace', section: 'forks' },
  { legacySection: 'custom-blocks', plane: 'workspace', section: 'custom-blocks' },
]

interface ResolveLegacySettingsHrefOptions {
  legacySection: string
  workspaceId: string
  hostOrganizationId: string | null
  isTargetOrganizationMember: boolean
}

export function resolveLegacySettingsHref({
  legacySection,
  workspaceId,
  hostOrganizationId,
  isTargetOrganizationMember,
}: ResolveLegacySettingsHrefOptions): string {
  const topLevelHref = getLegacyTopLevelWorkspaceHref(workspaceId, legacySection)
  if (topLevelHref) return topLevelHref

  const match = LEGACY_SETTINGS_SECTIONS.find((item) => item.legacySection === legacySection)
  if (!match) return getWorkspaceSettingsHref(workspaceId, 'teammates')

  if (match.plane === 'account') {
    return getAccountSettingsHref(match.section)
  }

  if (match.plane === 'workspace') {
    return getWorkspaceSettingsHref(workspaceId, match.section)
  }

  if (!hostOrganizationId) {
    return match.section === 'billing'
      ? getAccountSettingsHref('billing')
      : getWorkspaceSettingsHref(workspaceId, 'teammates')
  }

  if (!isTargetOrganizationMember) {
    return getOrganizationSettingsHref(hostOrganizationId, 'unavailable')
  }

  return getOrganizationSettingsHref(hostOrganizationId, match.section)
}

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
    billingEnabled: isBillingEnabled,
    hasEnterprisePlan,
    hosted: isHosted,
    selfHosted: {
      'access-control': isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED')),
      'audit-logs': isTruthy(getEnv('NEXT_PUBLIC_AUDIT_LOGS_ENABLED')),
      sso: isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED')),
      'data-retention': isTruthy(getEnv('NEXT_PUBLIC_DATA_RETENTION_ENABLED')),
      'data-drains': isTruthy(getEnv('NEXT_PUBLIC_DATA_DRAINS_ENABLED')),
      whitelabeling: isTruthy(getEnv('NEXT_PUBLIC_WHITELABELING_ENABLED')),
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
