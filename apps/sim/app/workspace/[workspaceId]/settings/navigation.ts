import {
  ClipboardList,
  Database,
  HexSimple,
  Key,
  KeySquare,
  Lock,
  LogIn,
  Mail,
  Palette,
  Send,
  Server,
  Settings,
  ShieldCheck,
  TerminalWindow,
  TrashOutline,
  Upload,
  User,
  Users,
  Wrench,
} from '@sim/emcn'
import { McpIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'

export type SettingsSection =
  | 'general'
  | 'secrets'
  | 'credential-sets'
  | 'access-control'
  | 'custom-blocks'
  | 'audit-logs'
  | 'apikeys'
  | 'byok'
  | 'billing'
  | 'teammates'
  | 'organization'
  | 'sso'
  | 'whitelabeling'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'workflow-mcp-servers'
  | 'inbox'
  | 'admin'
  | 'data-retention'
  | 'data-drains'
  | 'mothership'
  | 'recently-deleted'

export type NavigationSection =
  | 'account'
  | 'subscription'
  | 'tools'
  | 'system'
  | 'enterprise'
  | 'superuser'

export interface NavigationItem {
  id: SettingsSection
  label: string
  /** One-line summary shown as the page subtitle under the title. */
  description: string
  icon: React.ComponentType<{ className?: string }>
  section: NavigationSection
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresMax?: boolean
  requiresHosted?: boolean
  selfHostedOverride?: boolean
  requiresSuperUser?: boolean
  requiresAdminRole?: boolean
  /** Show in the sidebar even when the user lacks the required plan, with an upgrade badge. */
  showWhenLocked?: boolean
  /** Hide for enterprise plans, which manage billing out-of-band. */
  hideForEnterprise?: boolean
  externalUrl?: string
  /** Absolute docs URL surfaced as a "Docs" link in the page header. */
  docsLink?: string
}

const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
const isCredentialSetsEnabled = isTruthy(getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED'))
const isAccessControlEnabled = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
const isCustomBlocksEnabled = isTruthy(getEnv('NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED'))
const isInboxEnabled = isTruthy(getEnv('NEXT_PUBLIC_INBOX_ENABLED'))
const isWhitelabelingEnabled = isTruthy(getEnv('NEXT_PUBLIC_WHITELABELING_ENABLED'))
const isAuditLogsEnabled = isTruthy(getEnv('NEXT_PUBLIC_AUDIT_LOGS_ENABLED'))
const isDataRetentionEnabled = isTruthy(getEnv('NEXT_PUBLIC_DATA_RETENTION_ENABLED'))
const isDataDrainsEnabled = isTruthy(getEnv('NEXT_PUBLIC_DATA_DRAINS_ENABLED'))

export const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
export { isCredentialSetsEnabled }

export const sectionConfig: { key: NavigationSection; title: string }[] = [
  { key: 'account', title: 'Account' },
  { key: 'tools', title: 'Tools' },
  { key: 'subscription', title: 'Subscription' },
  { key: 'system', title: 'System' },
  { key: 'enterprise', title: 'Enterprise' },
  { key: 'superuser', title: 'Superuser' },
]

export const allNavigationItems: NavigationItem[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Manage your profile, appearance, and preferences.',
    icon: Settings,
    section: 'account',
  },
  {
    id: 'access-control',
    label: 'Access control',
    description: 'Manage permission groups across your organization.',
    icon: ShieldCheck,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAccessControlEnabled,
    docsLink: 'https://docs.sim.ai/platform/enterprise/access-control',
  },
  {
    id: 'audit-logs',
    label: 'Audit logs',
    description: 'Review activity and changes across your organization.',
    icon: ClipboardList,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAuditLogsEnabled,
    docsLink: 'https://docs.sim.ai/platform/enterprise/audit-logs',
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Manage your plan, pricing, and invoices.',
    icon: ClipboardList,
    section: 'subscription',
    hideWhenBillingDisabled: true,
  },
  {
    id: 'teammates',
    label: 'Teammates',
    description: 'Manage your teammates in this workspace.',
    icon: User,
    section: 'subscription',
  },
  {
    id: 'organization',
    label: 'Organization',
    description: "Manage your organization's members and seats.",
    icon: Users,
    section: 'subscription',
    hideWhenBillingDisabled: true,
    requiresHosted: true,
    requiresTeam: true,
  },
  {
    id: 'secrets',
    label: 'Secrets',
    description: 'Store environment variables for your workflows.',
    icon: Key,
    section: 'account',
  },
  {
    id: 'custom-tools',
    label: 'Custom tools',
    description: 'Create and manage custom tools for your agents.',
    icon: Wrench,
    section: 'tools',
  },
  {
    id: 'mcp',
    label: 'MCP tools',
    description: 'Connect MCP servers and use their tools in workflows.',
    icon: McpIcon,
    section: 'tools',
  },
  {
    id: 'apikeys',
    label: 'Sim API keys',
    description: 'Create and manage API keys for the Sim API.',
    icon: TerminalWindow,
    section: 'system',
  },
  {
    id: 'workflow-mcp-servers',
    label: 'MCP servers',
    description: 'Expose your workflows as tools on an MCP server.',
    icon: Server,
    section: 'system',
  },
  {
    id: 'byok',
    label: 'BYOK',
    description: 'Bring your own model-provider API keys.',
    icon: KeySquare,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'copilot',
    label: 'Chat keys',
    description: 'Manage the model-provider keys that power Chat.',
    icon: HexSimple,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'inbox',
    label: 'Sim mailer',
    description: 'Trigger and process workflows from incoming email.',
    icon: Send,
    section: 'system',
    requiresMax: true,
    requiresHosted: true,
    selfHostedOverride: isInboxEnabled,
    showWhenLocked: true,
  },
  ...(isCredentialSetsEnabled
    ? [
        {
          id: 'credential-sets' as const,
          label: 'Email polling',
          description: 'Share email-polling credentials across your team.',
          icon: Mail,
          section: 'system' as const,
        },
      ]
    : []),
  {
    id: 'recently-deleted',
    label: 'Recently deleted',
    description: 'Restore items deleted in the last 30 days.',
    icon: TrashOutline,
    section: 'system',
  },
  {
    id: 'sso',
    label: 'Single sign-on',
    description: 'Configure single sign-on for your organization.',
    icon: LogIn,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isSSOEnabled,
    docsLink: 'https://docs.sim.ai/platform/enterprise/sso',
  },
  {
    id: 'data-retention',
    label: 'Data retention',
    description:
      'Control data retention windows and PII redaction. Workspaces without an override inherit the organization defaults.',
    icon: Database,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isDataRetentionEnabled,
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-retention',
  },
  {
    id: 'data-drains',
    label: 'Data drains',
    description: 'Stream your logs and events to external destinations.',
    icon: Upload,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isDataDrainsEnabled,
    docsLink: 'https://docs.sim.ai/platform/enterprise/data-drains',
  },
  {
    id: 'whitelabeling',
    label: 'Whitelabeling',
    description: 'Customize your workspace branding and appearance.',
    icon: Palette,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isWhitelabelingEnabled,
    docsLink: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
  },
  {
    id: 'custom-blocks',
    label: 'Custom blocks',
    description: 'Publish workflows as reusable blocks for your organization.',
    icon: HexSimple,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isCustomBlocksEnabled,
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Superuser administration and workspace tools.',
    icon: Lock,
    section: 'superuser',
    requiresAdminRole: true,
  },
  {
    id: 'mothership',
    label: 'Mothership',
    description: 'Internal Sim operations and license management.',
    icon: Server,
    section: 'superuser',
    requiresAdminRole: true,
  },
]

/**
 * Title + description for a settings section, the single source of truth used by
 * `SettingsPanel` to render the page header. Falls back to `null` for sections
 * that are gated off (callers render no title in that case).
 */
export function getSettingsSectionMeta(
  section: SettingsSection
): { label: string; description: string; docsLink?: string } | null {
  const item = allNavigationItems.find((navItem) => navItem.id === section)
  return item ? { label: item.label, description: item.description, docsLink: item.docsLink } : null
}
