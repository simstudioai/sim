import {
  Card,
  ClipboardList,
  Connections,
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
  Users,
  Wrench,
} from '@/components/emcn'
import { AgentSkillsIcon, McpIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'

export type SettingsSection =
  | 'general'
  | 'integrations'
  | 'secrets'
  | 'template-profile'
  | 'credential-sets'
  | 'access-control'
  | 'audit-logs'
  | 'apikeys'
  | 'byok'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'whitelabeling'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'skills'
  | 'workflow-mcp-servers'
  | 'inbox'
  | 'admin'
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
  externalUrl?: string
}

const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
const isCredentialSetsEnabled = isTruthy(getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED'))
const isAccessControlEnabled = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
const isInboxEnabled = isTruthy(getEnv('NEXT_PUBLIC_INBOX_ENABLED'))
const isWhitelabelingEnabled = isTruthy(getEnv('NEXT_PUBLIC_WHITELABELING_ENABLED'))
const isAuditLogsEnabled = isTruthy(getEnv('NEXT_PUBLIC_AUDIT_LOGS_ENABLED'))

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
  // { id: 'template-profile', label: 'Template Profile', icon: User, section: 'account' },
  {
    id: 'access-control',
    label: 'Access Control',
    icon: ShieldCheck,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAccessControlEnabled,
  },
  {
    id: 'audit-logs',
    label: 'Audit Logs',
    icon: ClipboardList,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAuditLogsEnabled,
  },
  {
    id: 'subscription',
    label: 'Subscription',
    icon: Card,
    section: 'subscription',
    hideWhenBillingDisabled: true,
  },
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    section: 'subscription',
    hideWhenBillingDisabled: true,
    requiresHosted: true,
    requiresTeam: true,
  },
  { id: 'integrations', label: 'Integrations', icon: Connections, section: 'account' },
  { id: 'secrets', label: 'Secrets', icon: Key, section: 'account' },
  { id: 'custom-tools', label: 'Custom Tools', icon: Wrench, section: 'tools' },
  { id: 'skills', label: 'Skills', icon: AgentSkillsIcon, section: 'tools' },
  { id: 'mcp', label: 'MCP Tools', icon: McpIcon, section: 'tools' },
  { id: 'apikeys', label: 'Sim Keys', icon: TerminalWindow, section: 'system' },
  { id: 'workflow-mcp-servers', label: 'MCP Servers', icon: Server, section: 'system' },
  {
    id: 'byok',
    label: 'BYOK',
    icon: KeySquare,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'copilot',
    label: 'Copilot Keys',
    icon: HexSimple,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'inbox',
    label: 'Sim Mailer',
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
          label: 'Email Polling',
          icon: Mail,
          section: 'system' as const,
        },
      ]
    : []),
  { id: 'recently-deleted', label: 'Recently Deleted', icon: TrashOutline, section: 'system' },
  {
    id: 'sso',
    label: 'Single Sign-On',
    icon: LogIn,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isSSOEnabled,
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
]
