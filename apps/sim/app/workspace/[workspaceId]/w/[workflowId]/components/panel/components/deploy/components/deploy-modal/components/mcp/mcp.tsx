'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Textarea,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
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
import { useSettingsModalStore } from '@/stores/settings-modal/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('McpToolDeploy')

/** InputFormatField with guaranteed name (after normalization) */
type NormalizedField = InputFormatField & { name: string }

interface McpDeployProps {
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  isDeployed: boolean
  onAddedToServer?: () => void
  onSubmittingChange?: (submitting: boolean) => void
  onCanSaveChange?: (canSave: boolean) => void
  onHasServersChange?: (hasServers: boolean) => void
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

export function McpDeploy({
  workflowId,
  workflowName,
  workflowDescription,
  isDeployed,
  onAddedToServer,
  onSubmittingChange,
  onCanSaveChange,
  onHasServersChange,
}: McpDeployProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const openSettingsModal = useSettingsModalStore((state) => state.openModal)

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

    const storeValue = subBlockValues[starterBlockId]?.inputFormat
    const normalized = normalizeInputFormatValue(storeValue) as NormalizedField[]
    if (normalized.length > 0) return normalized

    const startBlock = blocks[starterBlockId]
    const blockValue = startBlock?.subBlocks?.inputFormat?.value
    return normalizeInputFormatValue(blockValue) as NormalizedField[]
  }, [starterBlockId, subBlockValues, blocks])

  const [toolName, setToolName] = useState(() => sanitizeToolName(workflowName))
  const [toolDescription, setToolDescription] = useState(() => {
    const isDefaultDescription =
      !workflowDescription ||
      workflowDescription === workflowName ||
      workflowDescription.toLowerCase() === 'new workflow'

    return isDefaultDescription ? '' : workflowDescription
  })
  const [parameterDescriptions, setParameterDescriptions] = useState<Record<string, string>>({})
  const [pendingServerChanges, setPendingServerChanges] = useState<Set<string>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const isSavingRef = useRef(false)

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

  const actualServerIds = useMemo(() => {
    const ids: string[] = []
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        ids.push(server.id)
      }
    }
    return ids
  }, [servers, serverToolsMap])

  const [pendingSelectedServerIds, setPendingSelectedServerIds] = useState<string[] | null>(null)

  const selectedServerIds = pendingSelectedServerIds ?? actualServerIds

  useEffect(() => {
    if (isSavingRef.current) return
    if (pendingSelectedServerIds !== null) {
      const pendingSet = new Set(pendingSelectedServerIds)
      const actualSet = new Set(actualServerIds)
      if (pendingSet.size === actualSet.size && [...pendingSet].every((id) => actualSet.has(id))) {
        setPendingSelectedServerIds(null)
      }
    }
  }, [actualServerIds, pendingSelectedServerIds])

  const hasLoadedInitialData = useRef(false)

  useEffect(() => {
    for (const server of servers) {
      const toolInfo = serverToolsMap[server.id]
      if (toolInfo?.tool) {
        setToolName(toolInfo.tool.toolName)

        const loadedDescription = toolInfo.tool.toolDescription || ''
        const isDefaultDescription =
          !loadedDescription ||
          loadedDescription === workflowName ||
          loadedDescription.toLowerCase() === 'new workflow'
        setToolDescription(isDefaultDescription ? '' : loadedDescription)

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
  }, [servers, serverToolsMap, workflowName])

  const [savedValues, setSavedValues] = useState<{
    toolName: string
    toolDescription: string
    parameterDescriptions: Record<string, string>
  } | null>(null)

  useEffect(() => {
    if (hasLoadedInitialData.current && !savedValues) {
      setSavedValues({
        toolName,
        toolDescription,
        parameterDescriptions: { ...parameterDescriptions },
      })
    }
  }, [toolName, toolDescription, parameterDescriptions, savedValues])

  const hasDeployedTools = selectedServerIds.length > 0

  const hasServerSelectionChanges = useMemo(() => {
    if (pendingSelectedServerIds === null) return false
    const pendingSet = new Set(pendingSelectedServerIds)
    const actualSet = new Set(actualServerIds)
    if (pendingSet.size !== actualSet.size) return true
    return ![...pendingSet].every((id) => actualSet.has(id))
  }, [pendingSelectedServerIds, actualServerIds])

  const hasChanges = useMemo(() => {
    if (hasServerSelectionChanges && selectedServerIds.length > 0) return true
    if (!savedValues || !hasDeployedTools) return false
    if (toolName !== savedValues.toolName) return true
    if (toolDescription !== savedValues.toolDescription) return true
    if (
      JSON.stringify(parameterDescriptions) !== JSON.stringify(savedValues.parameterDescriptions)
    ) {
      return true
    }
    return false
  }, [
    toolName,
    toolDescription,
    parameterDescriptions,
    hasDeployedTools,
    savedValues,
    hasServerSelectionChanges,
    selectedServerIds.length,
  ])

  useEffect(() => {
    onCanSaveChange?.(hasChanges && hasDeployedTools && !!toolName.trim())
  }, [hasChanges, hasDeployedTools, toolName, onCanSaveChange])

  useEffect(() => {
    onHasServersChange?.(servers.length > 0)
  }, [servers.length, onHasServersChange])

  /**
   * Save tool configuration to all selected servers.
   * This handles both adding to new servers and updating existing tools.
   */
  const handleSave = useCallback(async () => {
    if (!toolName.trim()) return
    if (selectedServerIds.length === 0) return

    isSavingRef.current = true
    onSubmittingChange?.(true)
    setSaveError(null)

    const actualSet = new Set(actualServerIds)
    const toAdd = selectedServerIds.filter((id) => !actualSet.has(id))
    const toRemove = actualServerIds.filter((id) => !selectedServerIds.includes(id))
    const toUpdate = selectedServerIds.filter((id) => actualSet.has(id))

    const errors: string[] = []

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
        onAddedToServer?.()
        logger.info(`Added workflow ${workflowId} as tool to server ${serverId}`)
      } catch (error) {
        const serverName = servers.find((s) => s.id === serverId)?.name || serverId
        errors.push(`Failed to add to "${serverName}"`)
        logger.error(`Failed to add tool to server ${serverId}:`, error)
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
        } catch (error) {
          const serverName = servers.find((s) => s.id === serverId)?.name || serverId
          errors.push(`Failed to remove from "${serverName}"`)
          logger.error(`Failed to remove tool from server ${serverId}:`, error)
        } finally {
          setPendingServerChanges((prev) => {
            const next = new Set(prev)
            next.delete(serverId)
            return next
          })
        }
      }
    }

    for (const serverId of toUpdate) {
      const toolInfo = serverToolsMap[serverId]
      if (toolInfo?.tool) {
        setPendingServerChanges((prev) => new Set(prev).add(serverId))
        try {
          await updateToolMutation.mutateAsync({
            workspaceId,
            serverId,
            toolId: toolInfo.tool.id,
            toolName: toolName.trim(),
            toolDescription: toolDescription.trim() || undefined,
            parameterSchema,
          })
        } catch (error) {
          const serverName = servers.find((s) => s.id === serverId)?.name || serverId
          errors.push(`Failed to update "${serverName}"`)
          logger.error(`Failed to update tool on server ${serverId}:`, error)
        } finally {
          setPendingServerChanges((prev) => {
            const next = new Set(prev)
            next.delete(serverId)
            return next
          })
        }
      }
    }

    if (errors.length > 0) {
      setSaveError(errors.join('. '))
    } else {
      refetchServers()
      setPendingSelectedServerIds(null)
      setSavedValues({
        toolName,
        toolDescription,
        parameterDescriptions: { ...parameterDescriptions },
      })
      onCanSaveChange?.(false)
    }

    isSavingRef.current = false
    onSubmittingChange?.(false)
  }, [
    toolName,
    toolDescription,
    parameterDescriptions,
    parameterSchema,
    servers,
    serverToolsMap,
    workspaceId,
    workflowId,
    selectedServerIds,
    actualServerIds,
    addToolMutation,
    deleteToolMutation,
    updateToolMutation,
    refetchServers,
    onSubmittingChange,
    onCanSaveChange,
    onAddedToServer,
  ])

  const serverOptions: ComboboxOption[] = useMemo(() => {
    return servers.map((server) => ({
      label: server.name,
      value: server.id,
    }))
  }, [servers])

  /**
   * Handle server selection change - only updates local state.
   * Actual add/remove operations happen when user clicks Save.
   */
  const handleServerSelectionChange = useCallback((newSelectedIds: string[]) => {
    setPendingSelectedServerIds(newSelectedIds)
  }, [])

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
      <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
        Deploy your workflow first to add it as an MCP tool.
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
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <p className='text-[13px] text-[var(--text-muted)]'>
          Create an MCP Server in Settings → Deployed MCPs first.
        </p>
        <Button
          variant='tertiary'
          onClick={() => openSettingsModal({ section: 'workflow-mcp-servers' })}
        >
          Create MCP Server
        </Button>
      </div>
    )
  }

  return (
    <form
      id='mcp-deploy-form'
      className='-mx-1 space-y-[12px] overflow-y-auto px-1'
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      {/* Hidden submit button for parent modal to trigger */}
      <button type='submit' hidden />

      {servers.map((server) => (
        <ServerToolsQuery
          key={server.id}
          workspaceId={workspaceId}
          server={server}
          workflowId={workflowId}
          onData={handleServerToolData}
        />
      ))}

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
                  <p className='font-medium text-[13px] text-[var(--text-primary)]'>{field.name}</p>
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
            <span className='truncate text-[var(--text-primary)]'>{selectedServersLabel}</span>
          }
        />
        {!toolName.trim() && (
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            Enter a tool name to select servers
          </p>
        )}
      </div>

      {saveError && <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{saveError}</p>}
    </form>
  )
}
