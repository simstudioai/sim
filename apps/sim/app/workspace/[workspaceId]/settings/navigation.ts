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
} from '@/components/emcn'
import { McpIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'

export type SettingsSection =
  | 'general'
  | 'secrets'
  | 'credential-sets'
  | 'access-control'
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
}

const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
const isCredentialSetsEnabled = isTruthy(getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED'))
const isAccessControlEnabled = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
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
  { id: 'general', label: 'General', icon: Settings, section: 'account' },
  {
    id: 'access-control',
    label: 'Access control',
    icon: ShieldCheck,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAccessControlEnabled,
  },
  {
    id: 'audit-logs',
    label: 'Audit logs',
    icon: ClipboardList,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAuditLogsEnabled,
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: ClipboardList,
    section: 'subscription',
    hideWhenBillingDisabled: true,
  },
  {
    id: 'teammates',
    label: 'Teammates',
    icon: User,
    section: 'subscription',
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Users,
    section: 'subscription',
    hideWhenBillingDisabled: true,
    requiresHosted: true,
    requiresTeam: true,
  },
  { id: 'secrets', label: 'Secrets', icon: Key, section: 'account' },
  { id: 'custom-tools', label: 'Custom tools', icon: Wrench, section: 'tools' },
  { id: 'mcp', label: 'MCP tools', icon: McpIcon, section: 'tools' },
  { id: 'apikeys', label: 'Sim API keys', icon: TerminalWindow, section: 'system' },
  { id: 'workflow-mcp-servers', label: 'MCP servers', icon: Server, section: 'system' },
  {
    id: 'byok',
    label: 'BYOK',
    icon: KeySquare,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'copilot',
    label: 'Chat keys',
    icon: HexSimple,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'inbox',
    label: 'Sim mailer',
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
          icon: Mail,
          section: 'system' as const,
        },
      ]
    : []),
  { id: 'recently-deleted', label: 'Recently deleted', icon: TrashOutline, section: 'system' },
  {
    id: 'sso',
    label: 'Single sign-on',
    icon: LogIn,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isSSOEnabled,
  },
  {
    id: 'data-retention',
    label: 'Data retention',
    icon: Database,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isDataRetentionEnabled,
  },
  {
    id: 'data-drains',
    label: 'Data drains',
    icon: Upload,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isDataDrainsEnabled,
  },
  {
    id: 'whitelabeling',
    label: 'Whitelabeling',
    icon: Palette,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isWhitelabelingEnabled,
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Lock,
    section: 'superuser',
    requiresAdminRole: true,
  },
  {
    id: 'mothership',
    label: 'Mothership',
    icon: Server,
    section: 'superuser',
    requiresAdminRole: true,
  },
]
