'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  ChipCombobox,
  ChipInput,
  type ComboboxOption,
  Label,
  Skeleton,
  Textarea,
} from '@/components/emcn'
import { ApiClientError } from '@/lib/api/client/errors'
import { cn } from '@/lib/core/utils/cn'
import {
  extractDescriptionOverrides,
  extractInputFormatFromBlocks,
  generateToolInputSchema,
  getMeaningfulWorkflowDescription,
  sanitizeToolName,
} from '@/lib/mcp/workflow-tool-schema'
import type { InputFormatField } from '@/lib/workflows/types'
import { CreateWorkflowMcpServerModal } from '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/components/create-workflow-mcp-server-modal'
import {
  useAddWorkflowMcpTool,
  useDeleteWorkflowMcpTool,
  useUpdateWorkflowMcpTool,
  useWorkflowMcpServers,
  useWorkflowMcpTools,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/hooks/queries/workflow-mcp-servers'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { useTranslations } from 'next-intl'

const logger = createLogger('McpToolDeploy')

/**
 * Mirrors the server's `sanitizeToolName` output: lowercase alphanumerics with single
 * underscores between segments. Disallows leading/trailing and consecutive underscores so
 * the validated name matches exactly what the server persists (no silent rewrite).
 */
const TOOL_NAME_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/
const MAX_TOOL_NAME_LENGTH = 64

/** InputFormatField with guaranteed name (after normalization) */
type NormalizedField = InputFormatField & { name: string }

interface McpDeployProps {
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  isDeployed: boolean
  deployedState?: WorkflowState | null
  isLoadingDeployedState: boolean
  onAddedToServer?: () => void
  onSubmittingChange?: (submitting: boolean) => void
  onCanSaveChange?: (canSave: boolean) => void
  onSaveDisabledReasonChange?: (reason: string | null) => void
  onActiveServerChange?: (serverId: string | null) => void
}

function haveSameServerSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

function haveSameOverrides(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => a[key] === b[key])
}

/**
 * Reduce the edited descriptions to the sparse set that actually overrides the Start-block
 * defaults: a real value that differs from both the field name and the field's Start-block
 * description. Mirrors the server's extractDescriptionOverrides so the deploy-modal and
 * Settings/legacy write paths agree on what counts as an override.
 */
function computeDescriptionOverrides(
  descriptions: Record<string, string>,
  startBlockDescriptions: Record<string, string>
): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const [name, value] of Object.entries(descriptions)) {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name && trimmed !== (startBlockDescriptions[name] ?? '').trim()) {
      overrides[name] = trimmed
    }
  }
  return overrides
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
  onData: (serverId: string, tool: WorkflowMcpTool | null) => void
}) {
  const { data: tools } = useWorkflowMcpTools(workspaceId, server.id)

  useEffect(() => {
    const tool = tools?.find((t) => t.workflowId === workflowId) || null
    onData(server.id, tool)
  }, [tools, workflowId, server.id, onData])

  return null
}

export function McpDeploy({
  workflowId,
  workflowName,
  workflowDescription,
  isDeployed,
  deployedState,
  isLoadingDeployedState,
  onAddedToServer,
  onSubmittingChange,
  onCanSaveChange,
  onSaveDisabledReasonChange,
  onActiveServerChange,
}: McpDeployProps) {
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data: servers = [], isLoading: isLoadingServers } = useWorkflowMcpServers(workspaceId)
  const addToolMutation = useAddWorkflowMcpTool()
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const updateToolMutation = useUpdateWorkflowMcpTool()

  // The MCP tool is built from the DEPLOYED Start block and the server materializes overrides
  // against it; the form waits for the deployed-state load below, so it works off the deployed
  // snapshot (never the live editor), keeping its defaults and override classification in lockstep
  // with what MCP clients receive.
  const inputFormat = useMemo((): NormalizedField[] => {
    const deployedBlocks = deployedState?.blocks
    if (!deployedBlocks) return []
    return (extractInputFormatFromBlocks(deployedBlocks as Record<string, unknown>) ??
      []) as NormalizedField[]
  }, [deployedState])

  const [toolName, setToolName] = useState(() => sanitizeToolName(workflowName))
  const [toolDescription, setToolDescription] = useState('')
  const workflowDescriptionFallback = getMeaningfulWorkflowDescription(
    workflowDescription,
    workflowName
  )
  const [parameterDescriptions, setParameterDescriptions] = useState<Record<string, string>>({})
  const [pendingServerChanges, setPendingServerChanges] = useState<Set<string>>(() => new Set())
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  const startBlockDescriptions = useMemo(() => {
    const map: Record<string, string> = {}
    for (const field of inputFormat) {
      map[field.name] = field.description?.trim() ?? ''
    }
    return map
  }, [inputFormat])

  const parameterDescriptionOverrides = useMemo(
    () => computeDescriptionOverrides(parameterDescriptions, startBlockDescriptions),
    [parameterDescriptions, startBlockDescriptions]
  )

  const toolNameError = useMemo(() => {
    const trimmed = toolName.trim()
    if (!trimmed) return null
    if (trimmed.length > MAX_TOOL_NAME_LENGTH) {
      return `Tool name must be ${MAX_TOOL_NAME_LENGTH} characters or fewer`
    }
    if (!TOOL_NAME_PATTERN.test(trimmed)) {
      return 'Use lowercase letters and numbers, separated by single underscores'
    }
    return null
  }, [toolName])

  const [serverToolsMap, setServerToolsMap] = useState<Record<string, WorkflowMcpTool | null>>({})

  const handleServerToolData = useCallback((serverId: string, tool: WorkflowMcpTool | null) => {
    setServerToolsMap((prev) => {
      if (prev[serverId]?.id === tool?.id) {
        return prev
      }
      return {
        ...prev,
        [serverId]: tool,
      }
    })
  }, [])

  const selectedServerIds = useMemo(() => {
    const ids: string[] = []
    for (const server of servers) {
      if (serverToolsMap[server.id]) {
        ids.push(server.id)
      }
    }
    return ids
  }, [servers, serverToolsMap])
  const [draftSelectedServerIds, setDraftSelectedServerIds] = useState<string[] | null>(null)
  const [savedValues, setSavedValues] = useState<{
    toolName: string
    toolDescription: string
    descriptions: Record<string, string>
  } | null>(null)

  useEffect(() => {
    // Seed once the deployed snapshot is ready — present, or its load settled without data. With the
    // deployed base the legacy migration classifies overrides against what the server serves; on a
    // failed fetch we still seed so existing tools stay editable instead of silently un-saveable.
    if (savedValues || (isLoadingDeployedState && !deployedState)) return

    for (const server of servers) {
      const existingTool = serverToolsMap[server.id]
      if (existingTool) {
        const initialToolName = existingTool.toolName
        const initialToolDescription = existingTool.toolDescription ?? ''
        const storedOverrides = existingTool.parameterDescriptionOverrides ?? {}
        // Tools created before the overrides column kept custom descriptions only in the stored
        // schema; derive them (dropping field-name and Start-block-default values) so opening and
        // saving the form never wipes descriptions that were never migrated to the column.
        const initialOverrides =
          Object.keys(storedOverrides).length > 0
            ? storedOverrides
            : extractDescriptionOverrides(
                existingTool.parameterSchema,
                generateToolInputSchema(inputFormat)
              )

        setToolName(initialToolName)
        setToolDescription(initialToolDescription)
        setParameterDescriptions(initialOverrides)
        setSavedValues({
          toolName: initialToolName,
          toolDescription: initialToolDescription,
          descriptions: initialOverrides,
        })
        break
      }
    }
  }, [servers, serverToolsMap, inputFormat, isLoadingDeployedState, deployedState, savedValues])

  const selectedServerIdsForForm = draftSelectedServerIds ?? selectedServerIds

  const hasToolConfigurationChanges = useMemo(() => {
    if (!savedValues) return false
    if (toolName !== savedValues.toolName) return true
    if (toolDescription.trim() !== savedValues.toolDescription.trim()) return true
    const savedOverrides = computeDescriptionOverrides(
      savedValues.descriptions,
      startBlockDescriptions
    )
    if (!haveSameOverrides(parameterDescriptionOverrides, savedOverrides)) {
      return true
    }
    return false
  }, [
    toolName,
    toolDescription,
    parameterDescriptionOverrides,
    savedValues,
    startBlockDescriptions,
  ])
  const hasServerSelectionChanges = useMemo(
    () => !haveSameServerSelection(selectedServerIdsForForm, selectedServerIds),
    [selectedServerIdsForForm, selectedServerIds]
  )
  const hasChanges =
    hasServerSelectionChanges ||
    (hasToolConfigurationChanges && selectedServerIdsForForm.length > 0)

  // Explain the greyed Save when the tool name is valid but no server is chosen (and none is saved
  // to remove) — the one disabled state with no inline guidance beside the field.
  const saveDisabledReason = useMemo(() => {
    if (!toolName.trim() || toolNameError) return null
    if (selectedServerIdsForForm.length === 0 && selectedServerIds.length === 0) {
      return 'Select a server to save this tool'
    }
    return null
  }, [toolName, toolNameError, selectedServerIdsForForm, selectedServerIds])

  useEffect(() => {
    onCanSaveChange?.(hasChanges && !!toolName.trim() && !toolNameError)
  }, [hasChanges, toolName, toolNameError, onCanSaveChange])

  useEffect(() => {
    onSaveDisabledReasonChange?.(saveDisabledReason)
  }, [saveDisabledReason, onSaveDisabledReasonChange])

  useEffect(() => {
    onActiveServerChange?.(selectedServerIdsForForm[0] ?? null)
  }, [selectedServerIdsForForm, onActiveServerChange])

  const handleSave = async () => {
    if (!toolName.trim() || toolNameError) return

    const currentIds = new Set(selectedServerIds)
    const nextIds = new Set(selectedServerIdsForForm)
    const toAdd = new Set(selectedServerIdsForForm.filter((id) => !currentIds.has(id)))
    const toRemove = selectedServerIds.filter((id) => !nextIds.has(id))
    const shouldUpdateExisting = hasToolConfigurationChanges

    if (toAdd.size === 0 && toRemove.length === 0 && !shouldUpdateExisting) return

    const trimmedDescription = toolDescription.trim()
    const toolDescriptionForSave =
      trimmedDescription && trimmedDescription !== (workflowDescriptionFallback ?? '')
        ? trimmedDescription
        : ''

    onSubmittingChange?.(true)
    setSaveErrors([])
    try {
      const errors: string[] = []
      const addedEntries: Record<string, WorkflowMcpTool> = {}
      const removedIds: string[] = []

      for (const serverId of toAdd) {
        setPendingServerChanges((prev) => new Set(prev).add(serverId))
        try {
          const addedTool = await addToolMutation.mutateAsync({
            workspaceId,
            serverId,
            workflowId,
            toolName: toolName.trim(),
            toolDescription: toolDescriptionForSave,
            parameterDescriptionOverrides,
          })
          addedEntries[serverId] = addedTool
          onAddedToServer?.()
          logger.info(`Added workflow ${workflowId} as tool to server ${serverId}`)
        } catch (error) {
          const serverName = servers.find((s) => s.id === serverId)?.name || serverId
          errors.push(`Failed to add to ${serverName}`)
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
        const existingTool = serverToolsMap[serverId]
        if (!existingTool) continue

        setPendingServerChanges((prev) => new Set(prev).add(serverId))
        try {
          await deleteToolMutation.mutateAsync({
            workspaceId,
            serverId,
            toolId: existingTool.id,
          })
          removedIds.push(serverId)
        } catch (error) {
          const serverName = servers.find((s) => s.id === serverId)?.name || serverId
          errors.push(`Failed to remove from ${serverName}`)
          logger.error(`Failed to remove tool from server ${serverId}:`, error)
        } finally {
          setPendingServerChanges((prev) => {
            const next = new Set(prev)
            next.delete(serverId)
            return next
          })
        }
      }

      if (shouldUpdateExisting) {
        for (const serverId of selectedServerIdsForForm) {
          if (toAdd.has(serverId)) continue
          const existingTool = serverToolsMap[serverId]
          if (!existingTool) continue

          try {
            await updateToolMutation.mutateAsync({
              workspaceId,
              serverId,
              toolId: existingTool.id,
              toolName: toolName.trim(),
              toolDescription: toolDescriptionForSave,
              parameterDescriptionOverrides,
            })
          } catch (error) {
            const serverName = servers.find((s) => s.id === serverId)?.name || serverId
            // The tool can be removed out-of-band (undeploying a workflow deletes its MCP tools), so
            // a stale-cache update may hit a missing tool — re-create it instead of failing the save.
            if (error instanceof ApiClientError && error.status === 404) {
              try {
                const recreated = await addToolMutation.mutateAsync({
                  workspaceId,
                  serverId,
                  workflowId,
                  toolName: toolName.trim(),
                  toolDescription: toolDescriptionForSave,
                  parameterDescriptionOverrides,
                })
                addedEntries[serverId] = recreated
              } catch (recreateError) {
                errors.push(`Failed to update on ${serverName}`)
                logger.error(`Failed to re-add tool on server ${serverId}:`, recreateError)
              }
            } else {
              errors.push(`Failed to update on ${serverName}`)
              logger.error(`Failed to update tool on server ${serverId}:`, error)
            }
          }
        }
      }

      setServerToolsMap((prev) => {
        const next = { ...prev, ...addedEntries }
        for (const id of removedIds) {
          delete next[id]
        }
        return next
      })
      if (errors.length > 0) {
        setSaveErrors(errors)
      } else {
        setDraftSelectedServerIds(null)
        setSavedValues({
          toolName,
          toolDescription,
          descriptions: { ...parameterDescriptions },
        })
        onCanSaveChange?.(false)
      }
      onSubmittingChange?.(false)
    } catch (error) {
      logger.error('Failed to save tool configuration:', error)
      onSubmittingChange?.(false)
    }
  }

  const serverOptions: ComboboxOption[] = useMemo(() => {
    return servers.map((server) => ({
      label: server.name,
      value: server.id,
    }))
  }, [servers])

  const handleServerSelectionChange = (newSelectedIds: string[]) => {
    setDraftSelectedServerIds(newSelectedIds)
  }

  const selectedServersLabel = useMemo(() => {
    const count = selectedServerIdsForForm.length
    if (count === 0) return 'Select servers...'
    if (count === 1) {
      const server = servers.find((s) => s.id === selectedServerIdsForForm[0])
      return server?.name || '1 server'
    }
    return `${count} servers selected`
  }, [selectedServerIdsForForm, servers])

  const isPending = pendingServerChanges.size > 0

  if (!isDeployed) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
        {t('deploy_your_workflow_first_to_add')}
      </div>
    )
  }

  if (isLoadingServers || (isLoadingDeployedState && !deployedState)) {
    return (
      <div className='-mx-1 space-y-4 px-1'>
        <div className='space-y-3'>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[70px]' />
            <Skeleton className='h-[34px] w-full rounded-sm' />
          </div>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[80px]' />
            <Skeleton className='h-[34px] w-full rounded-sm' />
          </div>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[50px]' />
            <Skeleton className='h-[34px] w-full rounded-sm' />
          </div>
        </div>
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <>
        <div className='flex h-full flex-col items-center justify-center gap-3'>
          <p className='text-[13px] text-[var(--text-muted)]'>
            {t('create_an_mcp_server_to_expose')}
          </p>
          <Button variant='tertiary' onClick={() => setShowCreateModal(true)}>
            {t('create_mcp_server')}
          </Button>
        </div>
        <CreateWorkflowMcpServerModal
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
          workspaceId={workspaceId}
        />
      </>
    )
  }

  return (
    <form
      id='mcp-deploy-form'
      className='-mx-1 space-y-3 px-1'
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
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
        <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
          {t('tool_name')}
        </Label>
        <ChipInput
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          placeholder={t('e_g_book_flight')}
          aria-invalid={!!toolNameError}
          error={Boolean(toolNameError)}
        />
        <p
          className={cn(
            'mt-[6.5px] text-xs',
            toolNameError ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {toolNameError ?? 'Use lowercase letters, numbers, and underscores only'}
        </p>
      </div>

      <div>
        <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
          {t('description')}
        </Label>
        <Textarea
          placeholder={
            workflowDescriptionFallback
              ? `Defaults to the workflow description: ${workflowDescriptionFallback}`
              : 'Describe what this tool does...'
          }
          className='min-h-[100px] resize-none'
          value={toolDescription}
          onChange={(e) => setToolDescription(e.target.value)}
        />
      </div>

      {inputFormat.length > 0 && (
        <div>
          <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
            {t('parameters')}{inputFormat.length})
          </Label>
          <p className='mb-[6.5px] pl-0.5 text-[var(--text-secondary)] text-xs'>
            {t('descriptions_default_to_your_start_block')}
          </p>
          <div className='flex flex-col gap-2'>
            {inputFormat.map((field) => (
              <div
                key={field.name}
                className='overflow-hidden rounded-sm border border-[var(--border-1)]'
              >
                <div className='flex items-center justify-between bg-[var(--surface-4)] px-2.5 py-[5px]'>
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <span className='block truncate font-medium text-[var(--text-tertiary)] text-sm'>
                      {field.name}
                    </span>
                    <Badge variant='type' size='sm'>
                      {field.type}
                    </Badge>
                  </div>
                </div>
                <div className='rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
                  <div className='flex flex-col gap-1.5'>
                    <Label className='text-small'>{t('description')}</Label>
                    <ChipInput
                      value={
                        parameterDescriptions[field.name] ??
                        startBlockDescriptions[field.name] ??
                        ''
                      }
                      onChange={(e) =>
                        setParameterDescriptions((prev) => ({
                          ...prev,
                          [field.name]: e.target.value,
                        }))
                      }
                      placeholder={startBlockDescriptions[field.name] || `Describe ${field.name}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
          {t('servers')}
        </Label>
        <ChipCombobox
          options={serverOptions}
          multiSelect
          multiSelectValues={selectedServerIdsForForm}
          onMultiSelectChange={handleServerSelectionChange}
          placeholder={t('select_servers')}
          searchable
          searchPlaceholder='Search servers...'
          disabled={!toolName.trim() || !!toolNameError || isPending}
          overlayContent={
            <span className='truncate text-[var(--text-primary)]'>{selectedServersLabel}</span>
          }
        />
        {!toolName.trim() ? (
          <p className='mt-[6.5px] text-[var(--text-secondary)] text-xs'>
            {t('enter_a_tool_name_to_select')}
          </p>
        ) : toolNameError ? (
          <p className='mt-[6.5px] text-[var(--text-secondary)] text-xs'>
            {t('fix_the_tool_name_to_select')}
          </p>
        ) : null}
      </div>

      {saveErrors.length > 0 && (
        <div className='mt-[6.5px] flex flex-col gap-0.5'>
          {saveErrors.map((error) => (
            <p key={error} className='text-[var(--text-error)] text-caption'>
              {error}
            </p>
          ))}
        </div>
      )}
    </form>
  )
}
