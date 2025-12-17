'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Plus, RefreshCw, Server, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Input as EmcnInput,
  Label,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/core/utils/cn'
import { createLogger } from '@/lib/logs/console/logger'
import {
  useAddWorkflowMcpTool,
  useDeleteWorkflowMcpTool,
  useUpdateWorkflowMcpTool,
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
 * Sanitize a workflow name to be a valid MCP tool name.
 */
function sanitizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 64) || 'workflow_tool'
}

/**
 * Extract input format from workflow blocks using SubBlockStore
 * The actual input format values are stored in useSubBlockStore, not directly in the block structure
 */
function extractInputFormat(blocks: Record<string, unknown>): Array<{ name: string; type: string }> {
  // Find the starter block
  for (const [blockId, block] of Object.entries(blocks)) {
    if (!block || typeof block !== 'object') continue

    const blockObj = block as Record<string, unknown>
    const blockType = blockObj.type

    // Check for all possible start/trigger block types
    if (
      blockType === 'starter' ||
      blockType === 'start' ||
      blockType === 'start_trigger' ||  // This is the unified start block type
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
 * Generate JSON Schema from input format
 */
function generateParameterSchema(
  inputFormat: Array<{ name: string; type: string }>
): Record<string, unknown> {
  if (inputFormat.length === 0) {
    return {
      type: 'object',
      properties: {},
    }
  }

  const properties: Record<string, { type: string; description: string }> = {}
  const required: string[] = []

  for (const field of inputFormat) {
    let jsonType = 'string'
    switch (field.type) {
      case 'number':
        jsonType = 'number'
        break
      case 'boolean':
        jsonType = 'boolean'
        break
      case 'object':
        jsonType = 'object'
        break
      case 'array':
      case 'files':
        jsonType = 'array'
        break
      default:
        jsonType = 'string'
    }

    properties[field.name] = {
      type: jsonType,
      description: field.name,
    }
    required.push(field.name)
  }

  return {
    type: 'object',
    properties,
    required,
  }
}

/**
 * Extract parameter names from a tool's parameter schema
 */
function getToolParameterNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties as Record<string, unknown> | undefined
  if (!properties) return []
  return Object.keys(properties)
}

/**
 * Check if the tool's parameters differ from the current workflow's input format
 */
function hasParameterMismatch(
  tool: WorkflowMcpTool,
  currentInputFormat: Array<{ name: string; type: string }>
): boolean {
  const toolParams = getToolParameterNames(tool.parameterSchema as Record<string, unknown>)
  const currentParams = currentInputFormat.map((f) => f.name)

  if (toolParams.length !== currentParams.length) return true

  const toolParamSet = new Set(toolParams)
  for (const param of currentParams) {
    if (!toolParamSet.has(param)) return true
  }

  return false
}

/**
 * Component to query tools for a single server and report back via callback.
 * This pattern avoids calling hooks in a loop.
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

  return null // This component doesn't render anything
}

interface ToolOnServerProps {
  server: WorkflowMcpServer
  tool: WorkflowMcpTool
  workspaceId: string
  currentInputFormat: Array<{ name: string; type: string }>
  currentParameterSchema: Record<string, unknown>
  workflowDescription: string | null | undefined
  onRemoved: (serverId: string) => void
  onUpdated: () => void
}

function ToolOnServer({
  server,
  tool,
  workspaceId,
  currentInputFormat,
  currentParameterSchema,
  workflowDescription,
  onRemoved,
  onUpdated,
}: ToolOnServerProps) {
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const updateToolMutation = useUpdateWorkflowMcpTool()
  const [showConfirm, setShowConfirm] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const needsUpdate = hasParameterMismatch(tool, currentInputFormat)
  const toolParams = getToolParameterNames(tool.parameterSchema as Record<string, unknown>)

  const handleRemove = async () => {
    try {
      await deleteToolMutation.mutateAsync({
        workspaceId,
        serverId: server.id,
        toolId: tool.id,
      })
      onRemoved(server.id)
    } catch (error) {
      logger.error('Failed to remove tool:', error)
    }
  }

  const handleUpdate = async () => {
    try {
      await updateToolMutation.mutateAsync({
        workspaceId,
        serverId: server.id,
        toolId: tool.id,
        toolDescription: workflowDescription || `Execute workflow`,
        parameterSchema: currentParameterSchema,
      })
      onUpdated()
      logger.info(`Updated tool ${tool.id} with new parameters`)
    } catch (error) {
      logger.error('Failed to update tool:', error)
    }
  }

  if (showConfirm) {
    return (
      <div className='flex items-center justify-between rounded-[6px] border border-[var(--text-error)]/30 bg-[var(--surface-3)] px-[10px] py-[8px]'>
        <span className='text-[12px] text-[var(--text-secondary)]'>Remove from {server.name}?</span>
        <div className='flex items-center gap-[4px]'>
          <Button
            variant='ghost'
            onClick={() => setShowConfirm(false)}
            className='h-[24px] px-[8px] text-[11px]'
            disabled={deleteToolMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant='ghost'
            onClick={handleRemove}
            className='h-[24px] px-[8px] text-[11px] text-[var(--text-error)] hover:text-[var(--text-error)]'
            disabled={deleteToolMutation.isPending}
          >
            {deleteToolMutation.isPending ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='rounded-[6px] border bg-[var(--surface-3)]'>
      <div
        className='flex cursor-pointer items-center justify-between px-[10px] py-[8px]'
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className='flex items-center gap-[8px]'>
          {showDetails ? (
            <ChevronDown className='h-[12px] w-[12px] text-[var(--text-tertiary)]' />
          ) : (
            <ChevronRight className='h-[12px] w-[12px] text-[var(--text-tertiary)]' />
          )}
          <span className='text-[13px] text-[var(--text-primary)]'>{server.name}</span>
          {server.isPublished && (
            <Badge variant='outline' className='text-[10px]'>
              Published
            </Badge>
          )}
          {needsUpdate && (
            <Badge variant='outline' className='border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-500'>
              <AlertTriangle className='mr-[4px] h-[10px] w-[10px]' />
              Needs Update
            </Badge>
          )}
        </div>
        <div className='flex items-center gap-[4px]' onClick={(e) => e.stopPropagation()}>
          {needsUpdate && (
            <Button
              variant='ghost'
              onClick={handleUpdate}
              disabled={updateToolMutation.isPending}
              className='h-[24px] px-[8px] text-[11px] text-amber-500 hover:text-amber-600'
            >
              <RefreshCw className={cn('mr-[4px] h-[10px] w-[10px]', updateToolMutation.isPending && 'animate-spin')} />
              {updateToolMutation.isPending ? 'Updating...' : 'Update'}
            </Button>
          )}
          <Button
            variant='ghost'
            onClick={() => setShowConfirm(true)}
            className='h-[24px] w-[24px] p-0 text-[var(--text-tertiary)] hover:text-[var(--text-error)]'
          >
            <Trash2 className='h-[12px] w-[12px]' />
          </Button>
        </div>
      </div>

      {showDetails && (
        <div className='border-t border-[var(--border)] px-[10px] py-[8px]'>
          <div className='flex flex-col gap-[6px]'>
            <div className='flex items-center justify-between'>
              <span className='text-[11px] text-[var(--text-muted)]'>Tool Name</span>
              <span className='font-mono text-[11px] text-[var(--text-secondary)]'>{tool.toolName}</span>
            </div>
            <div className='flex items-start justify-between gap-[8px]'>
              <span className='flex-shrink-0 text-[11px] text-[var(--text-muted)]'>Description</span>
              <span className='text-right text-[11px] text-[var(--text-secondary)]'>
                {tool.toolDescription || '—'}
              </span>
            </div>
            <div className='flex items-start justify-between gap-[8px]'>
              <span className='flex-shrink-0 text-[11px] text-[var(--text-muted)]'>
                Parameters ({toolParams.length})
              </span>
              <div className='flex flex-wrap justify-end gap-[4px]'>
                {toolParams.length === 0 ? (
                  <span className='text-[11px] text-[var(--text-muted)]'>None</span>
                ) : (
                  toolParams.map((param) => (
                    <Badge key={param} variant='outline' className='text-[9px]'>
                      {param}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
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

  const { data: servers = [], isLoading: isLoadingServers, refetch: refetchServers } = useWorkflowMcpServers(workspaceId)
  const addToolMutation = useAddWorkflowMcpTool()

  // Get workflow blocks
  const blocks = useWorkflowStore((state) => state.blocks)
  
  // Find the starter block ID to subscribe to its inputFormat changes
  const starterBlockId = useMemo(() => {
    for (const [blockId, block] of Object.entries(blocks)) {
      if (!block || typeof block !== 'object') continue
      const blockType = (block as { type?: string }).type
      // Check for all possible start/trigger block types
      if (
        blockType === 'starter' ||
        blockType === 'start' ||
        blockType === 'start_trigger' ||  // This is the unified start block type
        blockType === 'api' ||
        blockType === 'api_trigger' ||
        blockType === 'input_trigger'
      ) {
        return blockId
      }
    }
    return null
  }, [blocks])

  // Subscribe to the inputFormat value in SubBlockStore for reactivity
  // Use workflowId prop directly (not activeWorkflowId from registry) to ensure we get the correct workflow's data
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] ?? {} : {}
  )

  // Extract and normalize input format - now reactive to SubBlockStore changes
  const inputFormat = useMemo(() => {
    // First try to get from SubBlockStore (where runtime values are stored)
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

    // Fallback: try to get from block structure (for initial load or backwards compatibility)
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

    // Last fallback: use extractInputFormat helper
    return extractInputFormat(blocks)
  }, [starterBlockId, subBlockValues, blocks])

  const parameterSchema = useMemo(() => generateParameterSchema(inputFormat), [inputFormat])

  const [selectedServer, setSelectedServer] = useState<WorkflowMcpServer | null>(null)
  const [toolName, setToolName] = useState('')
  const [toolDescription, setToolDescription] = useState('')
  const [showServerSelector, setShowServerSelector] = useState(false)
  const [showParameterSchema, setShowParameterSchema] = useState(false)

  // Track tools data from each server using state instead of hooks in a loop
  const [serverToolsMap, setServerToolsMap] = useState<Record<string, { tool: WorkflowMcpTool | null; isLoading: boolean }>>({})

  // Stable callback to handle tool data from ServerToolsQuery components
  const handleServerToolData = useCallback((serverId: string, tool: WorkflowMcpTool | null, isLoading: boolean) => {
    setServerToolsMap((prev) => {
      // Only update if data has changed to prevent infinite loops
      const existing = prev[serverId]
      if (existing?.tool?.id === tool?.id && existing?.isLoading === isLoading) {
        return prev
      }
      return {
        ...prev,
        [serverId]: { tool, isLoading },
      }
    })
  }, [])

  // Find which servers already have this workflow as a tool and get the tool info
  const serversWithThisWorkflow = useMemo(() => {
    const result: Array<{ server: WorkflowMcpServer; tool: WorkflowMcpTool }> = []
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        result.push({ server, tool: toolInfo.tool })
      }
    }
    return result
  }, [servers, serverToolsMap])

  // Check if any tools need updating
  const toolsNeedingUpdate = useMemo(() => {
    return serversWithThisWorkflow.filter(({ tool }) => hasParameterMismatch(tool, inputFormat))
  }, [serversWithThisWorkflow, inputFormat])

  // Reset form when selected server changes
  useEffect(() => {
    if (selectedServer) {
      setToolName(sanitizeToolName(workflowName))
      setToolDescription(workflowDescription || `Execute ${workflowName} workflow`)
    }
  }, [selectedServer, workflowName, workflowDescription])

  const handleAddTool = useCallback(async () => {
    if (!selectedServer || !toolName.trim()) return

    try {
      await addToolMutation.mutateAsync({
        workspaceId,
        serverId: selectedServer.id,
        workflowId,
        toolName: toolName.trim(),
        toolDescription: toolDescription.trim() || undefined,
        parameterSchema,
      })

      setSelectedServer(null)
      setToolName('')
      setToolDescription('')
      
      // Refetch servers to update tool count
      refetchServers()
      onAddedToServer?.()

      logger.info(`Added workflow ${workflowId} as tool to server ${selectedServer.id}`)
    } catch (error) {
      logger.error('Failed to add tool:', error)
    }
  }, [
    selectedServer,
    toolName,
    toolDescription,
    workspaceId,
    workflowId,
    parameterSchema,
    addToolMutation,
    refetchServers,
    onAddedToServer,
  ])

  const handleToolChanged = useCallback((removedServerId?: string) => {
    // If a tool was removed from a specific server, clear just that entry
    // The ServerToolsQuery component will re-query and update the map
    if (removedServerId) {
      setServerToolsMap((prev) => {
        const next = { ...prev }
        delete next[removedServerId]
        return next
      })
    }
    refetchServers()
  }, [refetchServers])

  const availableServers = useMemo(() => {
    const addedServerIds = new Set(serversWithThisWorkflow.map((s) => s.server.id))
    return servers.filter((server) => !addedServerIds.has(server.id))
  }, [servers, serversWithThisWorkflow])

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
      <div className='flex flex-col gap-[16px]'>
        <Skeleton className='h-[60px] w-full' />
        <Skeleton className='h-[40px] w-full' />
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
            Create a Workflow MCP Server in Settings → Workflow MCP Servers first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-[16px]'>
      {/* Query tools for each server using separate components to follow Rules of Hooks */}
      {servers.map((server) => (
        <ServerToolsQuery
          key={server.id}
          workspaceId={workspaceId}
          server={server}
          workflowId={workflowId}
          onData={handleServerToolData}
        />
      ))}

      <div className='flex flex-col gap-[4px]'>
        <p className='text-[13px] text-[var(--text-secondary)]'>
          Add this workflow as an MCP tool to make it callable by external MCP clients like Cursor or Claude Desktop.
        </p>
      </div>

      {/* Update Warning */}
      {toolsNeedingUpdate.length > 0 && (
        <div className='flex items-center gap-[8px] rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-[10px] py-[8px]'>
          <AlertTriangle className='h-[14px] w-[14px] flex-shrink-0 text-amber-500' />
          <p className='text-[12px] text-amber-600 dark:text-amber-400'>
            {toolsNeedingUpdate.length} server{toolsNeedingUpdate.length > 1 ? 's have' : ' has'} outdated tool
            definitions. Click "Update" on each to sync with current parameters.
          </p>
        </div>
      )}

      {/* Parameter Schema Preview */}
      <div className='flex flex-col gap-[8px]'>
        <button
          type='button'
          onClick={() => setShowParameterSchema(!showParameterSchema)}
          className='flex items-center gap-[6px] text-left'
        >
          {showParameterSchema ? (
            <ChevronDown className='h-[12px] w-[12px] text-[var(--text-tertiary)]' />
          ) : (
            <ChevronRight className='h-[12px] w-[12px] text-[var(--text-tertiary)]' />
          )}
          <Label className='cursor-pointer text-[13px] text-[var(--text-primary)]'>
            Current Tool Parameters ({inputFormat.length})
          </Label>
        </button>
        
        {showParameterSchema && (
          <div className='rounded-[6px] border bg-[var(--surface-4)] p-[12px]'>
            {inputFormat.length === 0 ? (
              <p className='text-[12px] text-[var(--text-muted)]'>
                No parameters defined. Add input fields in the Starter block to define tool parameters.
              </p>
            ) : (
              <div className='flex flex-col gap-[8px]'>
                {inputFormat.map((field, index) => (
                  <div key={index} className='flex items-center justify-between'>
                    <span className='font-mono text-[12px] text-[var(--text-primary)]'>
                      {field.name}
                    </span>
                    <Badge variant='outline' className='text-[10px]'>
                      {field.type}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Servers with this workflow */}
      {serversWithThisWorkflow.length > 0 && (
        <div className='flex flex-col gap-[8px]'>
          <Label className='text-[13px] text-[var(--text-primary)]'>
            Added to ({serversWithThisWorkflow.length})
          </Label>
          <div className='flex flex-col gap-[6px]'>
            {serversWithThisWorkflow.map(({ server, tool }) => (
              <ToolOnServer
                key={server.id}
                server={server}
                tool={tool}
                workspaceId={workspaceId}
                currentInputFormat={inputFormat}
                currentParameterSchema={parameterSchema}
                workflowDescription={workflowDescription}
                onRemoved={(serverId) => handleToolChanged(serverId)}
                onUpdated={() => handleToolChanged()}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add to new server */}
      {availableServers.length > 0 ? (
        <>
          <div className='flex flex-col gap-[8px]'>
            <Label className='text-[13px] text-[var(--text-primary)]'>Add to Server</Label>
            <Popover open={showServerSelector} onOpenChange={setShowServerSelector}>
              <PopoverTrigger asChild>
                <Button
                  variant='default'
                  className='h-[36px] w-full justify-between border bg-[var(--surface-3)]'
                >
                  <span className={cn(!selectedServer && 'text-[var(--text-muted)]')}>
                    {selectedServer?.name || 'Choose a server...'}
                  </span>
                  <ChevronDown className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side='bottom'
                align='start'
                sideOffset={4}
                className='w-[var(--radix-popover-trigger-width)]'
                border
              >
                {availableServers.map((server) => (
                  <PopoverItem
                    key={server.id}
                    onClick={() => {
                      setSelectedServer(server)
                      setShowServerSelector(false)
                    }}
                  >
                    <Server className='mr-[8px] h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                    <span>{server.name}</span>
                    {server.isPublished && (
                      <Badge variant='outline' className='ml-auto text-[10px]'>
                        Published
                      </Badge>
                    )}
                  </PopoverItem>
                ))}
              </PopoverContent>
            </Popover>
          </div>

          {selectedServer && (
            <>
              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[13px] text-[var(--text-primary)]'>Tool Name</Label>
                <EmcnInput
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder='e.g., book_flight'
                  className='h-[36px]'
                />
                <p className='text-[11px] text-[var(--text-muted)]'>
                  Use lowercase letters, numbers, and underscores only.
                </p>
              </div>

              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[13px] text-[var(--text-primary)]'>Description</Label>
                <EmcnInput
                  value={toolDescription}
                  onChange={(e) => setToolDescription(e.target.value)}
                  placeholder='Describe what this tool does...'
                  className='h-[36px]'
                />
              </div>

              <Button
                variant='primary'
                onClick={handleAddTool}
                disabled={addToolMutation.isPending || !toolName.trim()}
                className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
              >
                <Plus className='mr-[6px] h-[14px] w-[14px]' />
                {addToolMutation.isPending ? 'Adding...' : 'Add to Server'}
              </Button>

              {addToolMutation.isError && (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {addToolMutation.error?.message || 'Failed to add tool'}
                </p>
              )}
            </>
          )}
        </>
      ) : serversWithThisWorkflow.length > 0 ? (
        <p className='text-[13px] text-[var(--text-muted)]'>
          This workflow has been added to all available servers.
        </p>
      ) : null}
    </div>
  )
}
