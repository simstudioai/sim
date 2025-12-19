'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Server } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Textarea,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { generateToolInputSchema, sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import {
  useAddWorkflowMcpTool,
  useDeleteWorkflowMcpTool,
  useWorkflowMcpServers,
  useWorkflowMcpTools,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/hooks/queries/workflow-mcp-servers'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('McpToolDeploy')

interface McpToolDeployProps {
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  isDeployed: boolean
  onAddedToServer?: () => void
}

/**
 * Extract input format from workflow blocks using SubBlockStore
 * The actual input format values are stored in useSubBlockStore, not directly in the block structure
 */
function extractInputFormat(
  blocks: Record<string, unknown>
): Array<{ name: string; type: string }> {
  // Find the starter block
  for (const [blockId, block] of Object.entries(blocks)) {
    if (!block || typeof block !== 'object') continue

    const blockObj = block as Record<string, unknown>
    const blockType = blockObj.type

    // Check for all possible start/trigger block types
    if (
      blockType === 'starter' ||
      blockType === 'start' ||
      blockType === 'start_trigger' || // This is the unified start block type
      blockType === 'api' ||
      blockType === 'api_trigger' ||
      blockType === 'input_trigger'
    ) {
      // Get the inputFormat value from the SubBlockStore (where the actual values are stored)
      const inputFormatValue = useSubBlockStore.getState().getValue(blockId, 'inputFormat')

      if (Array.isArray(inputFormatValue) && inputFormatValue.length > 0) {
        return inputFormatValue
          .filter(
            (field: unknown): field is { name: string; type: string } =>
              field !== null &&
              typeof field === 'object' &&
              'name' in field &&
              typeof (field as { name: unknown }).name === 'string' &&
              (field as { name: string }).name.trim() !== ''
          )
          .map((field) => ({
            name: field.name.trim(),
            type: field.type || 'string',
          }))
      }

      // Fallback: try to get from block's subBlocks structure (for backwards compatibility)
      const subBlocks = blockObj.subBlocks as Record<string, unknown> | undefined
      if (subBlocks?.inputFormat) {
        const inputFormatSubBlock = subBlocks.inputFormat as Record<string, unknown>
        const value = inputFormatSubBlock.value
        if (Array.isArray(value) && value.length > 0) {
          return value
            .filter(
              (field: unknown): field is { name: string; type: string } =>
                field !== null &&
                typeof field === 'object' &&
                'name' in field &&
                typeof (field as { name: unknown }).name === 'string' &&
                (field as { name: string }).name.trim() !== ''
            )
            .map((field) => ({
              name: field.name.trim(),
              type: field.type || 'string',
            }))
        }
      }
    }
  }

  return []
}

/**
 * Generate JSON Schema from input format with optional descriptions
 */
function generateParameterSchema(
  inputFormat: Array<{ name: string; type: string }>,
  descriptions: Record<string, string>
): Record<string, unknown> {
  const fieldsWithDescriptions = inputFormat.map((field) => ({
    ...field,
    description: descriptions[field.name]?.trim() || undefined,
  }))
  return generateToolInputSchema(fieldsWithDescriptions) as unknown as Record<string, unknown>
}

/**
 * Component to query tools for a single server and report back via callback.
 */
function ServerToolsQuery({
  workspaceId,
  server,
  workflowId,
  onData,
}: {
  workspaceId: string
  server: WorkflowMcpServer
  workflowId: string
  onData: (serverId: string, tool: WorkflowMcpTool | null, isLoading: boolean) => void
}) {
  const { data: tools, isLoading } = useWorkflowMcpTools(workspaceId, server.id)

  useEffect(() => {
    const tool = tools?.find((t) => t.workflowId === workflowId) || null
    onData(server.id, tool, isLoading)
  }, [tools, isLoading, workflowId, server.id, onData])

  return null
}

export function McpToolDeploy({
  workflowId,
  workflowName,
  workflowDescription,
  isDeployed,
  onAddedToServer,
}: McpToolDeployProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    data: servers = [],
    isLoading: isLoadingServers,
    refetch: refetchServers,
  } = useWorkflowMcpServers(workspaceId)
  const addToolMutation = useAddWorkflowMcpTool()
  const deleteToolMutation = useDeleteWorkflowMcpTool()

  const blocks = useWorkflowStore((state) => state.blocks)

  const starterBlockId = useMemo(() => {
    for (const [blockId, block] of Object.entries(blocks)) {
      if (!block || typeof block !== 'object') continue
      const blockType = (block as { type?: string }).type
      if (
        blockType === 'starter' ||
        blockType === 'start' ||
        blockType === 'start_trigger' ||
        blockType === 'api' ||
        blockType === 'api_trigger' ||
        blockType === 'input_trigger'
      ) {
        return blockId
      }
    }
    return null
  }, [blocks])

  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? {}) : {}
  )

  const inputFormat = useMemo(() => {
    if (starterBlockId && subBlockValues[starterBlockId]) {
      const inputFormatValue = subBlockValues[starterBlockId].inputFormat

      if (Array.isArray(inputFormatValue) && inputFormatValue.length > 0) {
        const filtered = inputFormatValue
          .filter(
            (field: unknown): field is { name: string; type: string } =>
              field !== null &&
              typeof field === 'object' &&
              'name' in field &&
              typeof (field as { name: unknown }).name === 'string' &&
              (field as { name: string }).name.trim() !== ''
          )
          .map((field) => ({
            name: field.name.trim(),
            type: field.type || 'string',
          }))
        if (filtered.length > 0) {
          return filtered
        }
      }
    }

    if (starterBlockId && blocks[starterBlockId]) {
      const startBlock = blocks[starterBlockId]
      const subBlocksValue = startBlock?.subBlocks?.inputFormat?.value as unknown

      if (Array.isArray(subBlocksValue) && subBlocksValue.length > 0) {
        const validFields: Array<{ name: string; type: string }> = []
        for (const field of subBlocksValue) {
          if (
            field !== null &&
            typeof field === 'object' &&
            'name' in field &&
            typeof field.name === 'string' &&
            field.name.trim() !== ''
          ) {
            validFields.push({
              name: field.name.trim(),
              type: typeof field.type === 'string' ? field.type : 'string',
            })
          }
        }
        if (validFields.length > 0) {
          return validFields
        }
      }
    }

    return extractInputFormat(blocks)
  }, [starterBlockId, subBlockValues, blocks])

  const [toolName, setToolName] = useState(() => sanitizeToolName(workflowName))
  const [toolDescription, setToolDescription] = useState(
    () => workflowDescription || `Execute ${workflowName} workflow`
  )
  const [showServerSelector, setShowServerSelector] = useState(false)
  const [parameterDescriptions, setParameterDescriptions] = useState<Record<string, string>>({})

  const parameterSchema = useMemo(
    () => generateParameterSchema(inputFormat, parameterDescriptions),
    [inputFormat, parameterDescriptions]
  )

  const [serverToolsMap, setServerToolsMap] = useState<
    Record<string, { tool: WorkflowMcpTool | null; isLoading: boolean }>
  >({})

  const handleServerToolData = useCallback(
    (serverId: string, tool: WorkflowMcpTool | null, isLoading: boolean) => {
      setServerToolsMap((prev) => {
        const existing = prev[serverId]
        if (existing?.tool?.id === tool?.id && existing?.isLoading === isLoading) {
          return prev
        }
        return {
          ...prev,
          [serverId]: { tool, isLoading },
        }
      })
    },
    []
  )

  const selectedServerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        ids.add(server.id)
      }
    }
    return ids
  }, [servers, serverToolsMap])

  // Load existing tool name, description, and parameter descriptions from the first deployed tool
  useEffect(() => {
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        setToolName(toolInfo.tool.toolName)
        setToolDescription(toolInfo.tool.toolDescription || '')

        // Load parameter descriptions
        const schema = toolInfo.tool.parameterSchema as Record<string, unknown> | undefined
        const properties = schema?.properties as
          | Record<string, { description?: string }>
          | undefined
        if (properties) {
          const descriptions: Record<string, string> = {}
          for (const [name, prop] of Object.entries(properties)) {
            if (
              prop.description &&
              prop.description !== name &&
              prop.description !== 'Array of file objects'
            ) {
              descriptions[name] = prop.description
            }
          }
          if (Object.keys(descriptions).length > 0) {
            setParameterDescriptions(descriptions)
          }
        }
        break
      }
    }
  }, [servers, serverToolsMap])

  const handleServerToggle = useCallback(
    async (server: WorkflowMcpServer) => {
      const toolInfo = serverToolsMap[server.id]
      const isSelected = !!toolInfo?.tool

      if (isSelected && toolInfo?.tool) {
        // Remove from server
        try {
          await deleteToolMutation.mutateAsync({
            workspaceId,
            serverId: server.id,
            toolId: toolInfo.tool.id,
          })
          setServerToolsMap((prev) => {
            const next = { ...prev }
            delete next[server.id]
            return next
          })
          refetchServers()
        } catch (error) {
          logger.error('Failed to remove tool:', error)
        }
      } else {
        // Add to server
        if (!toolName.trim()) return
        try {
          await addToolMutation.mutateAsync({
            workspaceId,
            serverId: server.id,
            workflowId,
            toolName: toolName.trim(),
            toolDescription: toolDescription.trim() || undefined,
            parameterSchema,
          })
          refetchServers()
          onAddedToServer?.()
          logger.info(`Added workflow ${workflowId} as tool to server ${server.id}`)
        } catch (error) {
          logger.error('Failed to add tool:', error)
        }
      }
    },
    [
      serverToolsMap,
      toolName,
      toolDescription,
      workspaceId,
      workflowId,
      parameterSchema,
      addToolMutation,
      deleteToolMutation,
      refetchServers,
      onAddedToServer,
    ]
  )

  const selectedServersText = useMemo(() => {
    const count = selectedServerIds.size
    if (count === 0) return 'Select servers'
    if (count === 1) {
      const serverId = Array.from(selectedServerIds)[0]
      const server = servers.find((s) => s.id === serverId)
      return server?.name || '1 server'
    }
    return `${count} servers`
  }, [selectedServerIds, servers])

  if (!isDeployed) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-[12px] text-center'>
        <Server className='h-[32px] w-[32px] text-[var(--text-muted)]' />
        <div className='flex flex-col gap-[4px]'>
          <p className='text-[14px] text-[var(--text-primary)]'>Deploy workflow first</p>
          <p className='text-[13px] text-[var(--text-muted)]'>
            You need to deploy your workflow before adding it as an MCP tool.
          </p>
        </div>
      </div>
    )
  }

  if (isLoadingServers) {
    return (
      <div className='-mx-1 space-y-4 px-1'>
        <div className='space-y-[12px]'>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[70px]' />
            <Skeleton className='h-[34px] w-full rounded-[4px]' />
          </div>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[80px]' />
            <Skeleton className='h-[34px] w-full rounded-[4px]' />
          </div>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[50px]' />
            <Skeleton className='h-[24px] w-[100px] rounded-[6px]' />
          </div>
        </div>
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-[12px] text-center'>
        <Server className='h-[32px] w-[32px] text-[var(--text-muted)]' />
        <div className='flex flex-col gap-[4px]'>
          <p className='text-[14px] text-[var(--text-primary)]'>No MCP servers yet</p>
          <p className='text-[13px] text-[var(--text-muted)]'>
            Create an MCP Server in Settings → MCP Servers first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='-mx-1 space-y-4 overflow-y-auto px-1'>
      {/* Query tools for each server */}
      {servers.map((server) => (
        <ServerToolsQuery
          key={server.id}
          workspaceId={workspaceId}
          server={server}
          workflowId={workflowId}
          onData={handleServerToolData}
        />
      ))}

      <div className='space-y-[12px]'>
        {/* Tool Name */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Tool name
          </Label>
          <Input
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            placeholder='e.g., book_flight'
          />
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            Use lowercase letters, numbers, and underscores only
          </p>
        </div>

        {/* Description */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Description
          </Label>
          <Textarea
            placeholder='Describe what this tool does...'
            className='min-h-[160px] resize-none'
            value={toolDescription}
            onChange={(e) => setToolDescription(e.target.value)}
          />
        </div>

        {/* Parameters */}
        {inputFormat.length > 0 && (
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              Parameters ({inputFormat.length})
            </Label>
            <div className='flex flex-col gap-[8px]'>
              {inputFormat.map((field) => (
                <div
                  key={field.name}
                  className='rounded-[6px] border bg-[var(--surface-3)] px-[10px] py-[8px]'
                >
                  <div className='flex items-center justify-between'>
                    <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                      {field.name}
                    </p>
                    <Badge variant='outline' className='text-[10px]'>
                      {field.type}
                    </Badge>
                  </div>
                  <Input
                    value={parameterDescriptions[field.name] || ''}
                    onChange={(e) =>
                      setParameterDescriptions((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                    placeholder='Add description for MCP clients...'
                    className='mt-[6px] h-[28px] text-[12px]'
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Servers - multi-select like OutputSelect */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Servers
          </Label>
          <Popover open={showServerSelector} onOpenChange={setShowServerSelector}>
            <PopoverTrigger asChild>
              <div>
                <Badge variant='outline' className='cursor-pointer whitespace-nowrap rounded-[6px]'>
                  <span className='text-[12px]'>{selectedServersText}</span>
                </Badge>
              </div>
            </PopoverTrigger>
            <PopoverContent side='bottom' align='start' sideOffset={4} border>
              {servers.map((server) => {
                const isSelected = selectedServerIds.has(server.id)
                const isPending = addToolMutation.isPending || deleteToolMutation.isPending
                return (
                  <PopoverItem
                    key={server.id}
                    active={isSelected}
                    onClick={() => !isPending && toolName.trim() && handleServerToggle(server)}
                  >
                    <Server className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                    <span className='flex-1'>{server.name}</span>
                    {isSelected && <Check className='h-3 w-3' />}
                  </PopoverItem>
                )
              })}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {addToolMutation.isError && (
        <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>
          {addToolMutation.error?.message || 'Failed to add tool'}
        </p>
      )}
    </div>
  )
}
