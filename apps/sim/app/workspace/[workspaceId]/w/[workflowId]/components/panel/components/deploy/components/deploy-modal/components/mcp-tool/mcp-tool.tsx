'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Server } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Badge, Combobox, type ComboboxOption, Input, Label, Textarea } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { generateToolInputSchema, sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format-utils'
import { isValidStartBlockType } from '@/lib/workflows/triggers/trigger-utils'
import type { InputFormatField } from '@/lib/workflows/types'
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

/** InputFormatField with guaranteed name (after normalization) */
type NormalizedField = InputFormatField & { name: string }

interface McpToolDeployProps {
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  isDeployed: boolean
  onAddedToServer?: () => void
}

/**
 * Generate JSON Schema from input format with optional descriptions
 */
function generateParameterSchema(
  inputFormat: NormalizedField[],
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
  const updateToolMutation = useUpdateWorkflowMcpTool()

  const blocks = useWorkflowStore((state) => state.blocks)

  const starterBlockId = useMemo(() => {
    for (const [blockId, block] of Object.entries(blocks)) {
      if (!block || typeof block !== 'object') continue
      const blockType = (block as { type?: string }).type
      if (blockType && isValidStartBlockType(blockType)) {
        return blockId
      }
    }
    return null
  }, [blocks])

  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? {}) : {}
  )

  const inputFormat = useMemo((): NormalizedField[] => {
    if (!starterBlockId) return []

    // Try SubBlockStore first (runtime state)
    const storeValue = subBlockValues[starterBlockId]?.inputFormat
    const normalized = normalizeInputFormatValue(storeValue) as NormalizedField[]
    if (normalized.length > 0) return normalized

    // Fallback to block definition
    const startBlock = blocks[starterBlockId]
    const blockValue = startBlock?.subBlocks?.inputFormat?.value
    return normalizeInputFormatValue(blockValue) as NormalizedField[]
  }, [starterBlockId, subBlockValues, blocks])

  const [toolName, setToolName] = useState(() => sanitizeToolName(workflowName))
  const [toolDescription, setToolDescription] = useState(
    () => workflowDescription || `Execute ${workflowName} workflow`
  )
  const [parameterDescriptions, setParameterDescriptions] = useState<Record<string, string>>({})
  const [pendingServerChanges, setPendingServerChanges] = useState<Set<string>>(new Set())

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
    const ids: string[] = []
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        ids.push(server.id)
      }
    }
    return ids
  }, [servers, serverToolsMap])

  const hasLoadedInitialData = useRef(false)

  useEffect(() => {
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        setToolName(toolInfo.tool.toolName)
        setToolDescription(toolInfo.tool.toolDescription || '')

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
        hasLoadedInitialData.current = true
        break
      }
    }
  }, [servers, serverToolsMap])

  /**
   * Sync tool configuration changes to all deployed servers (debounced)
   */
  useEffect(() => {
    if (!hasLoadedInitialData.current) return
    if (!toolName.trim()) return

    const toolsToUpdate: Array<{ serverId: string; toolId: string }> = []
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        toolsToUpdate.push({ serverId: server.id, toolId: toolInfo.tool.id })
      }
    }

    if (toolsToUpdate.length === 0) return

    const timeoutId = setTimeout(async () => {
      for (const { serverId, toolId } of toolsToUpdate) {
        try {
          await updateToolMutation.mutateAsync({
            workspaceId,
            serverId,
            toolId,
            toolName: toolName.trim(),
            toolDescription: toolDescription.trim() || undefined,
            parameterSchema,
          })
        } catch (error) {
          logger.error(`Failed to sync tool ${toolId}:`, error)
        }
      }
    }, 500)

    return () => clearTimeout(timeoutId)
  }, [
    toolName,
    toolDescription,
    parameterSchema,
    servers,
    serverToolsMap,
    workspaceId,
    updateToolMutation,
  ])

  const serverOptions: ComboboxOption[] = useMemo(() => {
    return servers.map((server) => ({
      label: server.name,
      value: server.id,
      icon: Server,
    }))
  }, [servers])

  const handleServerSelectionChange = useCallback(
    async (newSelectedIds: string[]) => {
      if (!toolName.trim()) return

      const currentIds = new Set(selectedServerIds)
      const newIds = new Set(newSelectedIds)

      const toAdd = newSelectedIds.filter((id) => !currentIds.has(id))
      const toRemove = selectedServerIds.filter((id) => !newIds.has(id))

      for (const serverId of toAdd) {
        setPendingServerChanges((prev) => new Set(prev).add(serverId))
        try {
          await addToolMutation.mutateAsync({
            workspaceId,
            serverId,
            workflowId,
            toolName: toolName.trim(),
            toolDescription: toolDescription.trim() || undefined,
            parameterSchema,
          })
          refetchServers()
          onAddedToServer?.()
          logger.info(`Added workflow ${workflowId} as tool to server ${serverId}`)
        } catch (error) {
          logger.error('Failed to add tool:', error)
        } finally {
          setPendingServerChanges((prev) => {
            const next = new Set(prev)
            next.delete(serverId)
            return next
          })
        }
      }

      for (const serverId of toRemove) {
        const toolInfo = serverToolsMap[serverId]
        if (toolInfo?.tool) {
          setPendingServerChanges((prev) => new Set(prev).add(serverId))
          try {
            await deleteToolMutation.mutateAsync({
              workspaceId,
              serverId,
              toolId: toolInfo.tool.id,
            })
            setServerToolsMap((prev) => {
              const next = { ...prev }
              delete next[serverId]
              return next
            })
            refetchServers()
          } catch (error) {
            logger.error('Failed to remove tool:', error)
          } finally {
            setPendingServerChanges((prev) => {
              const next = new Set(prev)
              next.delete(serverId)
              return next
            })
          }
        }
      }
    },
    [
      selectedServerIds,
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

  const selectedServersLabel = useMemo(() => {
    const count = selectedServerIds.length
    if (count === 0) return 'Select servers...'
    if (count === 1) {
      const server = servers.find((s) => s.id === selectedServerIds[0])
      return server?.name || '1 server'
    }
    return `${count} servers selected`
  }, [selectedServerIds, servers])

  const isPending = pendingServerChanges.size > 0

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
            <Skeleton className='h-[34px] w-full rounded-[4px]' />
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

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Description
          </Label>
          <Textarea
            placeholder='Describe what this tool does...'
            className='min-h-[100px] resize-none'
            value={toolDescription}
            onChange={(e) => setToolDescription(e.target.value)}
          />
        </div>

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
                    placeholder='Description'
                    className='mt-[6px] h-[28px] text-[12px]'
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Servers
          </Label>
          <Combobox
            options={serverOptions}
            multiSelect
            multiSelectValues={selectedServerIds}
            onMultiSelectChange={handleServerSelectionChange}
            placeholder='Select servers...'
            searchable
            searchPlaceholder='Search servers...'
            disabled={!toolName.trim() || isPending}
            isLoading={isPending}
            overlayContent={
              <span className='flex items-center gap-[6px] truncate text-[var(--text-primary)]'>
                <Server className='h-[12px] w-[12px] flex-shrink-0 text-[var(--text-tertiary)]' />
                <span className='truncate'>{selectedServersLabel}</span>
              </span>
            }
          />
          {!toolName.trim() && (
            <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
              Enter a tool name to select servers
            </p>
          )}
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
