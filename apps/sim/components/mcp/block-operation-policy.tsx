'use client'

import { useParams } from 'next/navigation'
import { McpOperationPolicyEditor } from '@/components/mcp/operation-policy-editor'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useMcpTools } from '@/hooks/mcp/use-mcp-tools'

interface McpBlockOperationPolicyProps {
  blockId: string
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

export function McpBlockOperationPolicy({
  blockId,
  disabled,
  isPreview,
  previewValue,
}: McpBlockOperationPolicyProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [value, setValue] = useSubBlockValue(blockId, 'operationPolicy')
  const [server] = useSubBlockValue(blockId, 'server')
  const { mcpTools, isLoading, error } = useMcpTools(workspaceId)
  const operations = mcpTools
    .filter(
      (tool) =>
        !server ||
        String(server).includes('<') ||
        String(server).includes('{{') ||
        tool.serverId === server ||
        tool.canonicalServerId === server
    )
    .map((tool) => ({ ...tool, serverId: tool.canonicalServerId ?? tool.serverId }))
  return (
    <McpOperationPolicyEditor
      value={isPreview ? previewValue : value}
      onChange={(policy) => setValue(policy)}
      operations={operations}
      disabled={disabled || isPreview}
      isLoading={isLoading}
      error={error}
    />
  )
}
