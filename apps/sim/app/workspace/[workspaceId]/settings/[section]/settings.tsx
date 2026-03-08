'use client'

import { useSearchParams } from 'next/navigation'
import {
  ApiKeys,
  BYOK,
  Copilot,
  CredentialSets,
  Credentials,
  CustomTools,
  Debug,
  General,
  MCP,
  Skills,
  Subscription,
  TeamManagement,
  TemplateProfile,
  WorkflowMcpServers,
} from '@/app/workspace/[workspaceId]/settings/components'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  isBillingEnabled,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { AccessControl } from '@/ee/access-control/components/access-control'
import { SSO } from '@/ee/sso/components/sso-settings'

interface SettingsPageProps {
  section: SettingsSection
}

export function SettingsPage({ section }: SettingsPageProps) {
  const searchParams = useSearchParams()
  const mcpServerId = searchParams.get('mcpServerId')

  const effectiveSection =
    !isBillingEnabled && (section === 'subscription' || section === 'team') ? 'general' : section

  const label =
    allNavigationItems.find((item) => item.id === effectiveSection)?.label ?? effectiveSection

  return (
    <div>
      <h2 className='mb-[28px] font-medium text-[22px] text-[var(--text-primary)]'>{label}</h2>
      {effectiveSection === 'general' && <General />}
      {effectiveSection === 'credentials' && <Credentials />}
      {effectiveSection === 'template-profile' && <TemplateProfile />}
      {effectiveSection === 'credential-sets' && <CredentialSets />}
      {effectiveSection === 'access-control' && <AccessControl />}
      {effectiveSection === 'apikeys' && <ApiKeys />}
      {isBillingEnabled && effectiveSection === 'subscription' && <Subscription />}
      {isBillingEnabled && effectiveSection === 'team' && <TeamManagement />}
      {effectiveSection === 'sso' && <SSO />}
      {effectiveSection === 'byok' && <BYOK />}
      {effectiveSection === 'copilot' && <Copilot />}
      {effectiveSection === 'mcp' && <MCP initialServerId={mcpServerId} />}
      {effectiveSection === 'custom-tools' && <CustomTools />}
      {effectiveSection === 'skills' && <Skills />}
      {effectiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
      {effectiveSection === 'debug' && <Debug />}
    </div>
  )
}
