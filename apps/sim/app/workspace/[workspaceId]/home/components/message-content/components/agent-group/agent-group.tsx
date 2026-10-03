'use client'

import {
  type AgentGroupProps,
  AgentGroupView,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { ToolCallItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { CredentialDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

function renderBrowserTakeover(reason: string) {
  return <CredentialDisplay data={[{ type: 'browser_takeover', name: reason }]} />
}

/** Workspace adapter retains permission, handoff, and integration lookup behavior. */
export function AgentGroup(props: AgentGroupProps) {
  return (
    <AgentGroupView
      {...props}
      ToolCallComponent={ToolCallItem}
      renderBrowserTakeover={renderBrowserTakeover}
    />
  )
}
