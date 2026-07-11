'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import type { WorkspaceSettingsSection } from '@/components/settings/navigation'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { captureEvent } from '@/lib/posthog/client'

const Teammates = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/teammates/teammates').then(
    (module) => module.Teammates
  )
)
const Secrets = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets').then(
    (module) => module.Secrets
  )
)
const BYOK = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/byok/byok').then(
    (module) => module.BYOK
  )
)
const CustomTools = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tools').then(
    (module) => module.CustomTools
  )
)
const MCP = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/mcp/mcp').then((module) => module.MCP)
)
const WorkflowMcpServers = dynamic(() =>
  import(
    '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers'
  ).then((module) => module.WorkflowMcpServers)
)
const ApiKeys = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
    (module) => module.ApiKeys
  )
)
const Inbox = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/inbox/inbox').then(
    (module) => module.Inbox
  )
)
const RecentlyDeleted = dynamic(() =>
  import(
    '@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'
  ).then((module) => module.RecentlyDeleted)
)
const CustomBlocks = dynamic(() =>
  import('@/ee/custom-blocks/components/custom-blocks').then((module) => module.CustomBlocks)
)
const Forks = dynamic(() =>
  import('@/ee/workspace-forking/components/forks').then((module) => module.Forks)
)

interface WorkspaceSettingsRendererProps {
  section: WorkspaceSettingsSection
}

export function WorkspaceSettingsRenderer({ section }: WorkspaceSettingsRendererProps) {
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'settings_tab_viewed', { plane: 'workspace', section })
  }, [posthog, section])

  let content
  if (section === 'teammates') content = <Teammates />
  else if (section === 'secrets') content = <Secrets />
  else if (section === 'byok') content = <BYOK />
  else if (section === 'custom-tools') content = <CustomTools />
  else if (section === 'mcp') content = <MCP />
  else if (section === 'workflow-mcp-servers') content = <WorkflowMcpServers />
  else if (section === 'api-keys') content = <ApiKeys scope='workspace' />
  else if (section === 'inbox') content = <Inbox />
  else if (section === 'recently-deleted') content = <RecentlyDeleted />
  else if (section === 'custom-blocks') content = <CustomBlocks />
  else content = <Forks />

  return (
    <SettingsSectionProvider plane='workspace' section={section}>
      {content}
    </SettingsSectionProvider>
  )
}
