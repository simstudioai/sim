import {
  Bug,
  KeySquare,
  LogIn,
  Mail,
  Server,
  Settings,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from 'lucide-react'
import { Card, HexSimple, Key, TerminalWindow } from '@/components/emcn'
import { AgentSkillsIcon, McpIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'

export type SettingsSection =
  | 'general'
  | 'credentials'
  | 'template-profile'
  | 'credential-sets'
  | 'access-control'
  | 'apikeys'
  | 'byok'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'skills'
  | 'workflow-mcp-servers'
  | 'debug'

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
  requiresHosted?: boolean
  selfHostedOverride?: boolean
  requiresSuperUser?: boolean
}

const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
const isCredentialSetsEnabled = isTruthy(getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED'))
const isAccessControlEnabled = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))

export const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

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
  { id: 'template-profile', label: 'Template Profile', icon: User, section: 'account' },
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
  { id: 'credentials', label: 'Secrets', icon: Key, section: 'account' },
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
    id: 'credential-sets',
    label: 'Email Polling',
    icon: Mail,
    section: 'system',
    requiresHosted: true,
    selfHostedOverride: isCredentialSetsEnabled,
  },
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
    id: 'debug',
    label: 'Debug',
    icon: Bug,
    section: 'superuser',
    requiresSuperUser: true,
  },
]
