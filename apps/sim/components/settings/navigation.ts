import type { ComponentType } from 'react'
import {
  ChartColumn,
  ClipboardList,
  Clock,
  Credit,
  Database,
  Globe,
  GridOffset,
  HexSimple,
  Key,
  KeySquare,
  Lock,
  LogIn,
  Palette,
  PanelLeft,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Shuffle,
  Sprout,
  TerminalWindow,
  Trash,
  Upload,
  Users,
  Wrench,
} from '@sim/emcn/icons'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { CodeIcon, McpIcon } from '@/components/icons'
import type { SettingsHeaderMeta } from '@/components/settings/settings-header'
import type { DeploymentFeatures, DeploymentShape } from '@/lib/api/contracts/workspaces'

export type SettingsPlane = 'account' | 'selfhost' | 'workspace'

export type AccountSettingsSection = 'general' | 'billing' | 'api-keys' | 'admin' | 'mothership'

/**
 * Settings a self-hoster needs from the managed service: their profile, what
 * they pay for, and the Chat keys their own deployment authenticates with.
 */
export type SelfHostSettingsSection = 'general' | 'billing' | 'chat-keys'

export type OrganizationSettingsSection =
  | 'members'
  | 'billing'
  | 'usage'
  | 'access-control'
  | 'audit-logs'
  | 'sso'
  | 'sessions'
  | 'data-retention'
  | 'data-drains'
  | 'whitelabeling'

export type WorkspaceSettingsSection =
  | 'teammates'
  | 'secrets'
  | 'credential-groups'
  | 'byok'
  | 'sandboxes'
  | 'custom-tools'
  | 'mcp'
  | 'workflow-mcp-servers'
  | 'api-keys'
  | 'inbox'
  | 'recently-deleted'
  | 'forks'
  | 'custom-blocks'
  | 'self-host'

export type SettingsSection =
  | AccountSettingsSection
  | OrganizationSettingsSection
  | SelfHostSettingsSection
  | WorkspaceSettingsSection

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
  | 'desktop'
  | 'browser'
  | 'terminal'
  | 'secrets'
  | 'credential-groups'
  | 'access-control'
  | 'custom-blocks'
  | 'audit-logs'
  | 'apikeys'
  | 'byok'
  | 'billing'
  | 'teammates'
  | 'organization'
  | 'usage'
  | 'sso'
  | 'whitelabeling'
  | 'forks'
  | 'mcp'
  | 'custom-tools'
  | 'workflow-mcp-servers'
  | 'inbox'
  | 'sandboxes'
  | 'admin'
  | 'sessions'
  | 'data-retention'
  | 'data-drains'
  | 'mothership'
  | 'recently-deleted'
  | 'self-host'

export type UnifiedNavigationSection = 'account' | 'workspace' | 'organization' | 'platform'

/**
 * A bridge surface the desktop shell must expose for a section to be worth
 * showing. Gated on the surface, never on the user's device toggle — the
 * Browser and Terminal pages are where that toggle is flipped back on.
 */
export type DesktopSettingsSurface = 'settings' | 'browser' | 'terminal'

export interface UnifiedSettingsNavigationItem {
  id: UnifiedSettingsSection
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  section: UnifiedNavigationSection
  order: number
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresMax?: boolean
  requiresHosted?: boolean
  /**
   * The inverse of {@link UnifiedSettingsNavigationItem.requiresHosted}: the
   * section exists only on a self-hosted deployment and is absent on Sim Cloud,
   * where the same surface is reached from the managed service instead.
   */
  requiresSelfHosted?: boolean
  /** See {@link SelfHostedOverride}; resolved against the deployment shape at filter time. */
  selfHostedOverride?: SelfHostedOverride
  requiresSuperUser?: boolean
  requiresAdminRole?: boolean
  requiresDesktopSurface?: DesktopSettingsSurface
  allowNonOrgAdmin?: boolean
  showWhenLocked?: boolean
  hideForEnterprise?: boolean
  externalUrl?: string
  docsLink?: string
  /**
   * The organization-scoped counterpart of this section. Declaring it marks the
   * section as acting on the host organization rather than the workspace, which
   * routes it through the organization gate (host organization present, org-admin
   * viewer, plan entitlement) in both the sidebar and the section page.
   *
   * This is the single source for {@link ORGANIZATION_PLANE_UNIFIED_SECTIONS} and
   * {@link UNIFIED_TO_ORGANIZATION_SECTION}, so the two cannot drift apart.
   */
  organizationSection?: OrganizationSettingsSection
}

interface UnifiedSettingsProjection
  extends Omit<UnifiedSettingsNavigationItem, 'label' | 'icon' | 'section' | 'docsLink'> {
  group: UnifiedNavigationSection
}

interface SettingsPlaneSectionMap {
  account: AccountSettingsSection
  selfhost: SelfHostSettingsSection
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
  /** Omit for sections that exist only on a standalone plane. */
  unified?: UnifiedSettingsProjection
  planes?: SettingsPlaneProjections
}

/**
 * How a section unlocks on a self-hosted deployment: `'always'` unconditionally, or
 * when the named enterprise feature resolves on for the deployment. Named rather than
 * read here so the catalog stays a constant and the sidebar and the server gate resolve
 * the same server-provided shape — see {@link isSelfHostedOverrideEnabled}. That is what
 * keeps nav and server agreeing: a section is visible exactly when its API would accept
 * the request.
 */
export type SelfHostedOverride = 'always' | keyof DeploymentFeatures

/**
 * Whether a section's self-hosted override unlocks it on this deployment. Always false
 * on Sim Cloud, where subscription plans decide entitlement instead.
 */
export function isSelfHostedOverrideEnabled(
  override: SelfHostedOverride | undefined,
  deployment: DeploymentShape
): boolean {
  if (override === undefined || deployment.hosted) return false
  return override === 'always' || deployment.features[override]
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

export function getSelfHostSettingsHref(
  section: SelfHostSettingsSection,
  searchParams?: SettingsHrefSearchParams
): string {
  return withSettingsSearchParams(`/selfhost/settings/${section}`, searchParams)
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

/** Planes with their own standalone shell; the workspace plane renders inside the editor. */
export type StandaloneSettingsPlane = Exclude<SettingsPlane, 'workspace'>

/**
 * Per-plane sidebar chrome. Self-host is reached from outside the app (the CLI
 * wizard, the README), so it leads with the brand mark rather than a Back link
 * into a workspace the visitor may not even be using.
 */
export const SETTINGS_PLANE_CHROME: Record<
  StandaloneSettingsPlane,
  { label: string; showWordmark: boolean }
> = {
  account: { label: 'Account', showWordmark: false },
  selfhost: { label: 'Self-host', showWordmark: true },
}

export const SELFHOST_SETTINGS_GROUPS = [
  { key: 'account', title: 'Account' },
  { key: 'developer', title: 'Developer' },
] as const

export const SETTINGS_SECTION_REGISTRY: readonly SettingsSectionRegistryEntry[] = [
  {
    label: 'General',
    icon: Settings,
    unified: {
      id: 'general',
      description: 'Manage your profile, appearance, and preferences.',
      group: 'account',
      order: 0,
    },
    planes: {
      account: { id: 'general', group: 'account', order: 0 },
      selfhost: { id: 'general', group: 'account', order: 0 },
    },
  },
  {
    label: 'Desktop',
    icon: PanelLeft,
    unified: {
      id: 'desktop',
      description: 'Manage notifications, startup, local folders, and updates.',
      group: 'account',
      order: 2,
      requiresDesktopSurface: 'settings',
    },
  },
  {
    label: 'Browser',
    icon: Globe,
    unified: {
      id: 'browser',
      description: 'Control the browser Chat drives and the data it keeps.',
      group: 'account',
      order: 3,
      requiresDesktopSurface: 'browser',
    },
  },
  {
    label: 'Terminal',
    icon: TerminalWindow,
    unified: {
      id: 'terminal',
      description: 'Control the shells Chat runs commands in.',
      group: 'account',
      order: 4,
      requiresDesktopSurface: 'terminal',
    },
  },
  {
    label: 'Permission groups',
    icon: ShieldCheck,
    docsLink: 'https://docs.sim.ai/platform/enterprise/access-control',
    unified: {
      id: 'access-control',
      description: 'Manage permission groups across your organization.',
      group: 'organization',
      order: 4,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'accessControl',
      organizationSection: 'access-control',
    },
  },
  {
    label: 'Audit logs',
    icon: ClipboardList,
    docsLink: 'https://docs.sim.ai/platform/enterprise/audit-logs',
    unified: {
      id: 'audit-logs',
      description: 'Review activity and changes across your organization.',
      group: 'organization',
      order: 5,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'auditLogs',
      organizationSection: 'audit-logs',
    },
  },
  {
    label: 'Workspace forks',
    icon: Shuffle,
    docsLink: 'https://docs.sim.ai/platform/enterprise/forks',
    unified: {
      id: 'forks',
      description: 'Fork this workspace and sync changes with its parent.',
      group: 'organization',
      order: 3,
    },
    planes: {
      workspace: { id: 'forks', group: 'enterprise', order: 10 },
    },
  },
  {
    label: 'Subscription',
    icon: Credit,
    unified: {
      id: 'billing',
      description: 'Manage your plan, pricing, and invoices.',
      group: 'account',
      order: 1,
      hideWhenBillingDisabled: true,
      organizationSection: 'billing',
    },
    planes: {
      account: {
        id: 'billing',
        description: 'Manage your personal plan, usage, and invoices.',
        group: 'account',
        order: 1,
      },
      selfhost: {
        id: 'billing',
        description: 'Manage your personal plan, usage, and invoices.',
        group: 'account',
        order: 1,
      },
    },
  },
  {
    label: 'Teammates',
    icon: Users,
    unified: {
      id: 'teammates',
      description: 'Manage your teammates in this workspace.',
      group: 'workspace',
      order: 0,
    },
    planes: {
      workspace: { id: 'teammates', group: 'workspace', order: 0 },
    },
  },
  {
    label: 'Members',
    icon: Users,
    unified: {
      id: 'organization',
      description: "Manage your organization's members and seats.",
      group: 'organization',
      order: 0,
      hideWhenBillingDisabled: true,
      requiresHosted: true,
      requiresTeam: true,
      /**
       * A plain member sees the roster read-only — `resolveOrganizationSectionAccess`
       * grants them `'view'` on this one section, and `TeamManagement` renders
       * without management controls. Every other organization section stays
       * admin-only.
       */
      allowNonOrgAdmin: true,
      organizationSection: 'members',
    },
  },
  {
    label: 'Usage tracking',
    icon: ChartColumn,
    unified: {
      id: 'usage',
      description: 'Monitor credit usage across your organization.',
      group: 'organization',
      order: 1,
      /**
       * Deliberately no `hideWhenBillingDisabled`, unlike Members above.
       *
       * The sidebar applies that filter *before* it consults `selfHostedOverride`,
       * so pairing the two hid this section from exactly the deployment the
       * override exists to serve: self-hosted, billing off, `USAGE_MONITORING_ENABLED`
       * on. Members can carry the flag because it has no override to reach. Here the
       * two gates below already answer both cases — hosted needs the plan, and
       * self-hosted needs the flag.
       */
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'usageMonitoring',
      organizationSection: 'usage',
    },
  },
  {
    label: 'Secrets',
    icon: Key,
    unified: {
      id: 'secrets',
      description: 'Store environment variables for your workflows.',
      group: 'workspace',
      order: 1,
    },
    planes: {
      workspace: { id: 'secrets', group: 'workspace', order: 1 },
    },
  },
  {
    label: 'Credential groups',
    icon: GridOffset,
    unified: {
      id: 'credential-groups',
      description: 'Collect and manage OAuth credentials for people outside this workspace.',
      group: 'workspace',
      order: 9,
      requiresEnterprise: true,
      allowNonOrgAdmin: true,
      selfHostedOverride: 'always',
    },
    planes: {
      workspace: { id: 'credential-groups', group: 'workspace', order: 4 },
    },
  },
  {
    label: 'Custom tools',
    icon: Wrench,
    unified: {
      id: 'custom-tools',
      description: 'Create and manage custom tools for your agents.',
      group: 'workspace',
      order: 3,
    },
    planes: {
      workspace: { id: 'custom-tools', group: 'tools', order: 4 },
    },
  },
  {
    label: 'MCP tools',
    icon: McpIcon,
    unified: {
      id: 'mcp',
      description: 'Connect external MCP servers and use their tools in this workspace.',
      group: 'workspace',
      order: 2,
    },
    planes: {
      workspace: { id: 'mcp', group: 'tools', order: 5 },
    },
  },
  {
    label: 'Sim API keys',
    icon: TerminalWindow,
    unified: {
      id: 'apikeys',
      description: 'Create and manage API keys for the Sim API.',
      group: 'workspace',
      order: 7,
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
        order: 7,
      },
    },
  },
  {
    label: 'MCP servers',
    icon: Server,
    unified: {
      id: 'workflow-mcp-servers',
      description: 'Expose workflows from this workspace as tools on an MCP server.',
      group: 'workspace',
      order: 6,
    },
    planes: {
      workspace: { id: 'workflow-mcp-servers', group: 'tools', order: 6 },
    },
  },
  {
    label: 'BYOK',
    icon: KeySquare,
    unified: {
      id: 'byok',
      description: 'Bring your own model-provider API keys.',
      group: 'workspace',
      order: 4,
      requiresHosted: true,
    },
    planes: {
      workspace: { id: 'byok', group: 'workspace', order: 2 },
    },
  },
  {
    label: 'Sandboxes',
    icon: CodeIcon,
    docsLink: 'https://docs.sim.ai/workflows/blocks/function',
    unified: {
      id: 'sandboxes',
      description: 'Install Python or npm packages for Function blocks to import.',
      group: 'workspace',
      order: 8,
      requiresMax: true,
      selfHostedOverride: 'sandboxes',
      showWhenLocked: true,
    },
    planes: {
      workspace: { id: 'sandboxes', group: 'workspace', order: 3 },
    },
  },
  {
    label: 'Chat keys',
    icon: HexSimple,
    planes: {
      selfhost: {
        id: 'chat-keys',
        description: 'Manage the model-provider keys that power Chat.',
        group: 'developer',
        order: 2,
      },
    },
  },
  {
    label: 'Sim Mailer',
    icon: Send,
    unified: {
      id: 'inbox',
      description: 'Trigger and process workflows from incoming email.',
      group: 'workspace',
      order: 5,
      requiresMax: true,
      requiresHosted: true,
      selfHostedOverride: 'inbox',
      showWhenLocked: true,
    },
    planes: {
      workspace: { id: 'inbox', group: 'system', order: 8 },
    },
  },
  {
    label: 'Recently deleted',
    icon: Trash,
    unified: {
      id: 'recently-deleted',
      description: 'Restore items deleted in the last 30 days.',
      group: 'workspace',
      order: 10,
    },
    planes: {
      workspace: { id: 'recently-deleted', group: 'system', order: 9 },
    },
  },
  {
    label: 'Self hosting',
    icon: Sprout,
    unified: {
      id: 'self-host',
      description: 'Manage this deployment from the Sim managed service.',
      group: 'platform',
      order: 2,
      requiresSelfHosted: true,
    },
    planes: {
      workspace: { id: 'self-host', group: 'system', order: 12 },
    },
  },
  {
    label: 'Single sign-on',
    icon: LogIn,
    docsLink: 'https://docs.sim.ai/platform/enterprise/sso',
    unified: {
      id: 'sso',
      description: 'Manage sign-in, verified domains, and provisioning.',
      group: 'organization',
      order: 7,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'sso',
      organizationSection: 'sso',
    },
  },
  {
    label: 'Session policies',
    icon: Clock,
    docsLink: 'https://docs.sim.ai/platform/enterprise/session-policies',
    unified: {
      id: 'sessions',
      description: 'Limit session lifetimes and sign out members org-wide.',
      group: 'organization',
      order: 8,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'sessionPolicies',
      organizationSection: 'sessions',
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
      group: 'organization',
      order: 9,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'dataRetention',
      organizationSection: 'data-retention',
    },
  },
  {
    label: 'Data drains',
    icon: Upload,
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-drains',
    unified: {
      id: 'data-drains',
      description: 'Stream your logs and events to external destinations.',
      group: 'organization',
      order: 10,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'dataDrains',
      organizationSection: 'data-drains',
    },
  },
  {
    label: 'White-labeling',
    icon: Palette,
    docsLink: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
    unified: {
      id: 'whitelabeling',
      description: 'Customize your workspace branding and appearance.',
      group: 'organization',
      order: 6,
      requiresHosted: true,
      requiresEnterprise: true,
      selfHostedOverride: 'whitelabeling',
      organizationSection: 'whitelabeling',
    },
  },
  {
    label: 'Custom blocks',
    icon: HexSimple,
    docsLink: 'https://docs.sim.ai/platform/enterprise/custom-blocks',
    unified: {
      id: 'custom-blocks',
      description: 'Publish workflows as reusable blocks for your organization.',
      group: 'organization',
      order: 2,
      requiresHosted: true,
      requiresEnterprise: true,
      allowNonOrgAdmin: true,
      selfHostedOverride: 'customBlocks',
    },
    planes: {
      workspace: { id: 'custom-blocks', group: 'enterprise', order: 11 },
    },
  },
  {
    label: 'Admin',
    icon: Lock,
    unified: {
      id: 'admin',
      description: 'Superuser administration and workspace tools.',
      group: 'platform',
      order: 0,
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
      group: 'platform',
      order: 1,
      requiresAdminRole: true,
    },
    planes: {
      account: { id: 'mothership', group: 'platform', order: 5 },
    },
  },
]

/**
 * Every unified section this build can render, including ones the current deployment
 * does not offer. Deployment filtering (`requiresHosted`, `requiresSelfHosted`, billing)
 * belongs to the sidebar and the section gate, which read the server-resolved shape.
 * Keeping an unavailable section in the catalog is what lets the route treat it as a
 * known segment and redirect to General rather than answer 404.
 */
export function buildUnifiedSettingsCatalog(): UnifiedSettingsNavigationItem[] {
  return SETTINGS_SECTION_REGISTRY.flatMap(({ label, icon, docsLink, unified }) => {
    if (!unified) return []
    const { group, ...item } = unified
    return [
      {
        ...item,
        label,
        icon,
        section: group,
        ...(docsLink ? { docsLink } : {}),
      },
    ]
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
    .map(({ entry, projection }) => {
      // A plane-only section carries no unified projection to inherit from, so
      // its own description is the only source — missing one is a registry bug.
      const description = projection.description ?? entry.unified?.description
      if (!description) {
        throw new Error(`Settings section "${projection.id}" is missing a description`)
      }
      return {
        id: projection.id,
        label: projection.label ?? entry.label,
        description,
        icon: entry.icon,
        group: projection.group,
        ...(entry.docsLink ? { docsLink: entry.docsLink } : {}),
      }
    })
}

export const ACCOUNT_SETTINGS_ITEMS: SettingsNavigationItem<AccountSettingsSection>[] =
  buildPlaneSettingsItems('account')

export const SELFHOST_SETTINGS_ITEMS: SettingsNavigationItem<SelfHostSettingsSection>[] =
  buildPlaneSettingsItems('selfhost')

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
    entry.unified?.organizationSection ? [entry.unified.id] : []
  )
)

/**
 * Unified section id to the organization-scoped section it acts on, for the gates
 * that take an {@link OrganizationSettingsSection} (`canOpenOrganizationSettingsSection`,
 * `isOrganizationSettingsSectionAvailable`).
 *
 * Derived from the registry rather than hand-listed: a section added to one and
 * forgotten in the other used to mean the page applied *no* organization gate at
 * all, since an unmapped section reads as "not organization-scoped".
 */
export const UNIFIED_TO_ORGANIZATION_SECTION: Readonly<
  Partial<Record<UnifiedSettingsSection, OrganizationSettingsSection>>
> = Object.fromEntries(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) =>
    entry.unified?.organizationSection
      ? [[entry.unified.id, entry.unified.organizationSection] as const]
      : []
  )
)

export const UNIFIED_TO_WORKSPACE_SECTION: Readonly<
  Partial<Record<UnifiedSettingsSection, WorkspaceSettingsSection>>
> = Object.fromEntries(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) => {
    const unifiedSection = entry.unified?.id
    const workspaceSection = entry.planes?.workspace?.id
    return unifiedSection && workspaceSection ? [[unifiedSection, workspaceSection] as const] : []
  })
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
  hasEnterprisePlan: boolean,
  deployment: DeploymentShape
): OrganizationSettingsFeatures {
  const { features } = deployment
  return {
    billingEnabled: deployment.billingEnabled,
    hasEnterprisePlan,
    hosted: deployment.hosted,
    selfHosted: {
      'access-control': features.accessControl,
      'audit-logs': features.auditLogs,
      sso: features.sso,
      sessions: features.sessionPolicies,
      'data-retention': features.dataRetention,
      'data-drains': features.dataDrains,
      usage: features.usageMonitoring,
      whitelabeling: features.whitelabeling,
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
  hideSandboxesTab?: boolean
}

const WORKSPACE_PERMISSION_CONFIG_KEYS: Partial<
  Record<WorkspaceSettingsSection, keyof WorkspacePermissionConfig>
> = {
  secrets: 'hideSecretsTab',
  'api-keys': 'hideApiKeysTab',
  inbox: 'hideInboxTab',
  mcp: 'disableMcpTools',
  'custom-tools': 'disableCustomTools',
  sandboxes: 'hideSandboxesTab',
}

export function workspaceSectionUsesPermissionConfig(section: WorkspaceSettingsSection): boolean {
  return WORKSPACE_PERMISSION_CONFIG_KEYS[section] !== undefined
}

export interface WorkspaceSettingsEntitlements {
  credentialGroups: boolean
  customBlocks: boolean
  forks: boolean
  inbox: boolean
  sandboxes: boolean
}

/**
 * Sections that stay visible without their entitlement, rendering a locked
 * upgrade prompt instead of disappearing from the nav. Keyed by the entitlement
 * that unlocks them, so adding a gated section is one entry rather than another
 * hardcoded id check in {@link resolveWorkspaceNavigation}.
 */
const LOCKABLE_WORKSPACE_SECTIONS: Partial<
  Record<WorkspaceSettingsSection, keyof WorkspaceSettingsEntitlements>
> = {
  inbox: 'inbox',
  sandboxes: 'sandboxes',
}

interface ResolveWorkspaceNavigationOptions {
  permission: PermissionType
  permissionConfig: WorkspacePermissionConfig
  entitlements: WorkspaceSettingsEntitlements
  /** Resolves the catalog's deployment gates the same way the sidebar does. */
  deployment: DeploymentShape
}

/**
 * Unified projection of each workspace-plane section, so the route gate reads the
 * deployment requirements (`requiresHosted`, `requiresSelfHosted`, `selfHostedOverride`)
 * from the same catalog entry the sidebar filters on. Nav and server then agree: a
 * section is reachable exactly when it is listed.
 */
const WORKSPACE_UNIFIED_PROJECTIONS: Readonly<
  Partial<Record<WorkspaceSettingsSection, UnifiedSettingsProjection>>
> = Object.fromEntries(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) => {
    const workspaceSection = entry.planes?.workspace?.id
    return workspaceSection && entry.unified ? [[workspaceSection, entry.unified] as const] : []
  })
)

/**
 * Whether the deployment itself offers a workspace section, before viewer permission
 * and plan entitlement are considered. Mirrors the sidebar's deployment pass.
 */
function isWorkspaceSectionOfferedByDeployment(
  section: WorkspaceSettingsSection,
  deployment: DeploymentShape
): boolean {
  const unified = WORKSPACE_UNIFIED_PROJECTIONS[section]
  if (!unified) return true
  if (unified.requiresSelfHosted && deployment.hosted) return false
  if (unified.requiresHosted && !deployment.hosted) {
    return isSelfHostedOverrideEnabled(unified.selfHostedOverride, deployment)
  }
  return true
}

export interface ResolvedWorkspaceNavigationItem
  extends SettingsNavigationItem<WorkspaceSettingsSection> {
  canMutate: boolean
  locked: boolean
}

const WORKSPACE_MUTATION_PERMISSION: Record<WorkspaceSettingsSection, PermissionType> = {
  teammates: 'admin',
  secrets: 'write',
  'credential-groups': 'admin',
  byok: 'admin',
  sandboxes: 'admin',
  'custom-tools': 'write',
  mcp: 'write',
  'workflow-mcp-servers': 'write',
  'api-keys': 'admin',
  inbox: 'admin',
  'recently-deleted': 'write',
  forks: 'admin',
  'custom-blocks': 'admin',
  'self-host': 'admin',
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
  deployment,
}: ResolveWorkspaceNavigationOptions): ResolvedWorkspaceNavigationItem[] {
  return WORKSPACE_SETTINGS_ITEMS.flatMap((item) => {
    if (!isWorkspaceSectionOfferedByDeployment(item.id, deployment)) return []
    const permissionConfigKey = WORKSPACE_PERMISSION_CONFIG_KEYS[item.id]
    if (permissionConfigKey && permissionConfig[permissionConfigKey]) return []
    if (item.id === 'forks' && (permission !== 'admin' || !entitlements.forks)) return []
    if (
      item.id === 'credential-groups' &&
      (permission !== 'admin' || !entitlements.credentialGroups)
    ) {
      return []
    }
    if (item.id === 'custom-blocks' && !entitlements.customBlocks) return []

    const lockedBy = LOCKABLE_WORKSPACE_SECTIONS[item.id]
    const locked = lockedBy !== undefined && !entitlements[lockedBy]
    const canMutate =
      !locked &&
      canMutateWorkspaceSettingsSection(item.id, {
        canEdit: permissionSatisfies(permission, 'write'),
        canAdmin: permissionSatisfies(permission, 'admin'),
      })

    return [{ ...item, canMutate, locked }]
  })
}

/**
 * Adapts a navigation entry to the header shell's static identity.
 *
 * The catalog calls it `label` because it names a sidebar row; the shell calls it `title`
 * because it renders a heading. One adapter keeps every plane's shell fed from the catalog
 * instead of each one restating the mapping.
 */
export function toSettingsHeaderMeta(
  item: Pick<SettingsNavigationItem, 'label' | 'description' | 'docsLink'>
): SettingsHeaderMeta {
  return { title: item.label, description: item.description, docsLink: item.docsLink }
}

export function getSettingsSectionMeta(
  plane: SettingsPlane,
  section: string
): Pick<SettingsNavigationItem, 'label' | 'description' | 'docsLink'> | null {
  const catalog =
    plane === 'account'
      ? ACCOUNT_SETTINGS_ITEMS
      : plane === 'selfhost'
        ? SELFHOST_SETTINGS_ITEMS
        : WORKSPACE_SETTINGS_ITEMS
  const item = catalog.find((candidate) => candidate.id === section)
  return item ? { label: item.label, description: item.description, docsLink: item.docsLink } : null
}
