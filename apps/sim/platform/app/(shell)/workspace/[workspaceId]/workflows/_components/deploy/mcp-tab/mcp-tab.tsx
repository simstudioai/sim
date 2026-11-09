'use client'

import { useEffect } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { InlineNotice } from '@sim/emcn/status'
import type { McpToolForm } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/use-mcp-tool'
import { ParameterDescriptions } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/parameter-descriptions/parameter-descriptions'
import {
  useWorkflowMcpTools,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/platform/lib/data/workflow-deploy'

interface ServerToolQueryProps {
  workspaceId: string
  server: WorkflowMcpServer
  workflowId: string
  onData: (serverId: string, tool: WorkflowMcpTool | null) => void
}

/** Reads one server's tools and reports this workflow's, so each server keeps its own query. */
function ServerToolQuery({ workspaceId, server, workflowId, onData }: ServerToolQueryProps) {
  const { data: tools } = useWorkflowMcpTools(workspaceId, server.id)
  useEffect(() => {
    onData(server.id, tools?.find((tool) => tool.workflowId === workflowId) ?? null)
  }, [tools, workflowId, server.id, onData])
  return null
}

interface McpTabProps {
  workspaceId: string
  workflowId: string
  isDeployed: boolean
  isLoadingDeployedState: boolean
  hasDeployedState: boolean
  tool: McpToolForm
  onCreateServer: () => void
}

/** The MCP tab: the deployed workflow as a tool on the workspace's MCP servers. */
export function McpTab({
  workspaceId,
  workflowId,
  isDeployed,
  isLoadingDeployedState,
  hasDeployedState,
  tool,
  onCreateServer,
}: McpTabProps) {
  if (!isDeployed)
    return (
      <EmptyState
        title='Not deployed'
        description='Deploy your workflow first to add it as an MCP tool.'
      />
    )
  if (tool.isLoadingServers || (isLoadingDeployedState && !hasDeployedState)) return null
  if (tool.servers.length === 0)
    return (
      <EmptyState
        title='No MCP servers'
        description='Create an MCP server to expose your workflows as tools.'
        action={
          <Button variant='secondary' size='compact' onClick={onCreateServer}>
            Create MCP server
          </Button>
        }
      />
    )

  const nameReady = Boolean(tool.toolName.trim()) && !tool.toolNameError
  return (
    <>
      {tool.servers.map((server) => (
        <ServerToolQuery
          key={server.id}
          workspaceId={workspaceId}
          server={server}
          workflowId={workflowId}
          onData={tool.onServerTool}
        />
      ))}
      <TextField
        label='Tool name'
        placeholder='e.g., book_flight'
        value={tool.toolName}
        onChange={tool.setToolName}
        error={tool.toolNameError ?? undefined}
        hint={
          tool.toolNameError ? undefined : 'Use lowercase letters, numbers, and underscores only'
        }
        autoComplete='off'
      />
      <TextAreaField
        label='Description'
        placeholder={
          tool.descriptionFallback
            ? `Defaults to the workflow description: ${tool.descriptionFallback}`
            : 'Describe what this tool does'
        }
        value={tool.toolDescription}
        onChange={tool.setToolDescription}
      />
      <ParameterDescriptions
        fields={tool.inputFormat}
        value={(name) => tool.parameterDescriptions[name] ?? tool.startDescriptions[name] ?? ''}
        placeholder={(name) => tool.startDescriptions[name] || `Describe ${name}`}
        onChange={tool.setParameterDescription}
        hint='Descriptions default to your Start block inputs; edit to override for this tool.'
      />
      <MultiSelect
        label='Servers'
        options={tool.servers.map((server) => ({ value: server.id, label: server.name }))}
        value={tool.selectedServerIds}
        onValueChange={tool.setSelectedServerIds}
        placeholder='Select servers'
        searchLabel='Search servers'
        disabled={!nameReady || tool.isPending || tool.submitting}
        hint={
          !tool.toolName.trim()
            ? 'Enter a tool name to select servers'
            : tool.toolNameError
              ? 'Fix the tool name to select servers'
              : (tool.saveDisabledReason ?? undefined)
        }
      />
      {tool.saveErrors.length > 0 && (
        <InlineNotice intent='danger' message={tool.saveErrors.join('. ')} />
      )}
    </>
  )
}
