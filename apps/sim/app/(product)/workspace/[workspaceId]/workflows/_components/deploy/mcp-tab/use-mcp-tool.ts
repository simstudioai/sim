'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiClientError,
  extractDescriptionOverrides,
  extractInputFormatFromBlocks,
  generateToolInputSchema,
  getMeaningfulWorkflowDescription,
  type InputFormatField,
  sanitizeToolName,
  useAddWorkflowMcpTool,
  useDeleteWorkflowMcpTool,
  useUpdateWorkflowMcpTool,
  useWorkflowMcpServers,
  type WorkflowMcpTool,
} from '@/platform/lib/data/workflow-deploy'
import { createLogger, type WorkflowState } from '@/platform/lib/data/workflows'

const logger = createLogger('McpToolDeploy')

/** The server's `sanitizeToolName` output: lowercase alphanumerics, single underscores between. */
const TOOL_NAME_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/
const MAX_TOOL_NAME_LENGTH = 64

type NormalizedField = InputFormatField & { name: string }

interface SavedValues {
  toolName: string
  toolDescription: string
  descriptions: Record<string, string>
}

function sameSelection(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((id) => set.has(id))
}

function sameOverrides(a: Record<string, string>, b: Record<string, string>) {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * The sparse set of edited descriptions that override the Start block's: a real value that differs
 * from both the field name and its Start-block description, as the server classifies them.
 */
function descriptionOverrides(
  descriptions: Record<string, string>,
  startDescriptions: Record<string, string>
) {
  const overrides: Record<string, string> = {}
  for (const [name, value] of Object.entries(descriptions)) {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name && trimmed !== (startDescriptions[name] ?? '').trim())
      overrides[name] = trimmed
  }
  return overrides
}

interface UseMcpToolOptions {
  workspaceId: string
  workflowId: string
  workflowName: string
  workflowDescription?: string | null
  /** The active deployment's snapshot: the tool is built from its Start block, never the draft. */
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
}

/**
 * The workflow as an MCP tool: its name, description and parameter descriptions, and the servers
 * that expose it. Saving adds it to newly chosen servers, removes it from cleared ones and updates
 * it on the rest, re-creating a tool an undeploy removed behind the cache's back.
 */
export function useMcpTool({
  workspaceId,
  workflowId,
  workflowName,
  workflowDescription,
  deployedState,
  isLoadingDeployedState,
}: UseMcpToolOptions) {
  const { data: servers = [], isLoading: isLoadingServers } = useWorkflowMcpServers(workspaceId)
  const addTool = useAddWorkflowMcpTool()
  const deleteTool = useDeleteWorkflowMcpTool()
  const updateTool = useUpdateWorkflowMcpTool()

  const inputFormat = useMemo((): NormalizedField[] => {
    const blocks = deployedState?.blocks
    if (!blocks) return []
    return (extractInputFormatFromBlocks(blocks as Record<string, unknown>) ??
      []) as NormalizedField[]
  }, [deployedState])

  const [toolName, setToolName] = useState(() => sanitizeToolName(workflowName))
  const [toolDescription, setToolDescription] = useState('')
  const [parameterDescriptions, setParameterDescriptions] = useState<Record<string, string>>({})
  const [pendingServers, setPendingServers] = useState<ReadonlySet<string>>(() => new Set())
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [serverTools, setServerTools] = useState<Record<string, WorkflowMcpTool | null>>({})
  const [draftServerIds, setDraftServerIds] = useState<string[] | null>(null)
  const [savedValues, setSavedValues] = useState<SavedValues | null>(null)

  const descriptionFallback = getMeaningfulWorkflowDescription(workflowDescription, workflowName)

  const startDescriptions = useMemo(() => {
    const map: Record<string, string> = {}
    for (const field of inputFormat) map[field.name] = field.description?.trim() ?? ''
    return map
  }, [inputFormat])

  const overrides = useMemo(
    () => descriptionOverrides(parameterDescriptions, startDescriptions),
    [parameterDescriptions, startDescriptions]
  )

  const toolNameError = useMemo(() => {
    const trimmed = toolName.trim()
    if (!trimmed) return null
    if (trimmed.length > MAX_TOOL_NAME_LENGTH)
      return `Tool name must be ${MAX_TOOL_NAME_LENGTH} characters or fewer`
    if (!TOOL_NAME_PATTERN.test(trimmed))
      return 'Use lowercase letters and numbers, separated by single underscores'
    return null
  }, [toolName])

  const onServerTool = useCallback((serverId: string, tool: WorkflowMcpTool | null) => {
    setServerTools((current) =>
      current[serverId]?.id === tool?.id && serverId in current
        ? current
        : { ...current, [serverId]: tool }
    )
  }, [])

  const savedServerIds = useMemo(
    () => servers.filter((server) => serverTools[server.id]).map((server) => server.id),
    [servers, serverTools]
  )
  const selectedServerIds = draftServerIds ?? savedServerIds

  // Seed once the deployed snapshot settles (present, or failed to load) from the first server
  // that already exposes this workflow. Tools from before the overrides column keep their custom
  // descriptions only in the stored schema; derive them so a save never wipes them.
  useEffect(() => {
    if (savedValues || (isLoadingDeployedState && !deployedState)) return
    for (const server of servers) {
      const existing = serverTools[server.id]
      if (!existing) continue
      const stored = existing.parameterDescriptionOverrides ?? {}
      const initialOverrides =
        Object.keys(stored).length > 0
          ? stored
          : extractDescriptionOverrides(
              existing.parameterSchema,
              generateToolInputSchema(inputFormat)
            )
      setToolName(existing.toolName)
      setToolDescription(existing.toolDescription ?? '')
      setParameterDescriptions(initialOverrides)
      setSavedValues({
        toolName: existing.toolName,
        toolDescription: existing.toolDescription ?? '',
        descriptions: initialOverrides,
      })
      break
    }
  }, [servers, serverTools, inputFormat, isLoadingDeployedState, deployedState, savedValues])

  const hasToolChanges = useMemo(() => {
    if (!savedValues) return false
    if (toolName !== savedValues.toolName) return true
    if (toolDescription.trim() !== savedValues.toolDescription.trim()) return true
    return !sameOverrides(
      overrides,
      descriptionOverrides(savedValues.descriptions, startDescriptions)
    )
  }, [toolName, toolDescription, overrides, savedValues, startDescriptions])
  const hasServerChanges = !sameSelection(selectedServerIds, savedServerIds)
  const hasChanges = hasServerChanges || (hasToolChanges && selectedServerIds.length > 0)
  const canSave = hasChanges && Boolean(toolName.trim()) && !toolNameError
  const saveDisabledReason =
    toolName.trim() &&
    !toolNameError &&
    selectedServerIds.length === 0 &&
    savedServerIds.length === 0
      ? 'Select a server to save this tool'
      : null

  const markPending = (serverId: string, pending: boolean) =>
    setPendingServers((current) => {
      const next = new Set(current)
      if (pending) next.add(serverId)
      else next.delete(serverId)
      return next
    })

  const serverName = (serverId: string) =>
    servers.find((server) => server.id === serverId)?.name || serverId

  const save = async () => {
    if (!toolName.trim() || toolNameError) return
    const current = new Set(savedServerIds)
    const next = new Set(selectedServerIds)
    const toAdd = new Set(selectedServerIds.filter((id) => !current.has(id)))
    const toRemove = savedServerIds.filter((id) => !next.has(id))
    if (toAdd.size === 0 && toRemove.length === 0 && !hasToolChanges) return

    const trimmed = toolDescription.trim()
    const descriptionToSave = trimmed && trimmed !== (descriptionFallback ?? '') ? trimmed : ''
    const payload = {
      workspaceId,
      workflowId,
      toolName: toolName.trim(),
      toolDescription: descriptionToSave,
      parameterDescriptionOverrides: overrides,
    }

    setSubmitting(true)
    setSaveErrors([])
    const errors: string[] = []
    const added: Record<string, WorkflowMcpTool> = {}
    const removed: string[] = []
    try {
      for (const serverId of toAdd) {
        markPending(serverId, true)
        try {
          added[serverId] = await addTool.mutateAsync({ ...payload, serverId })
          logger.info('Added workflow as an MCP tool', { workflowId, serverId })
        } catch (error) {
          errors.push(`Failed to add to ${serverName(serverId)}`)
          logger.error('Failed to add MCP tool', { serverId, error })
        } finally {
          markPending(serverId, false)
        }
      }
      for (const serverId of toRemove) {
        const existing = serverTools[serverId]
        if (!existing) continue
        markPending(serverId, true)
        try {
          await deleteTool.mutateAsync({ workspaceId, serverId, toolId: existing.id })
          removed.push(serverId)
        } catch (error) {
          errors.push(`Failed to remove from ${serverName(serverId)}`)
          logger.error('Failed to remove MCP tool', { serverId, error })
        } finally {
          markPending(serverId, false)
        }
      }
      if (hasToolChanges) {
        for (const serverId of selectedServerIds) {
          if (toAdd.has(serverId)) continue
          const existing = serverTools[serverId]
          if (!existing) continue
          try {
            await updateTool.mutateAsync({ ...payload, serverId, toolId: existing.id })
          } catch (error) {
            // Undeploying removes a workflow's tools, so a stale cache may update a missing one.
            if (error instanceof ApiClientError && error.status === 404) {
              try {
                added[serverId] = await addTool.mutateAsync({ ...payload, serverId })
              } catch (recreateError) {
                errors.push(`Failed to update on ${serverName(serverId)}`)
                logger.error('Failed to re-add MCP tool', { serverId, error: recreateError })
              }
            } else {
              errors.push(`Failed to update on ${serverName(serverId)}`)
              logger.error('Failed to update MCP tool', { serverId, error })
            }
          }
        }
      }
      setServerTools((tools) => {
        const nextTools = { ...tools, ...added }
        for (const id of removed) delete nextTools[id]
        return nextTools
      })
      if (errors.length > 0) setSaveErrors(errors)
      else {
        setDraftServerIds(null)
        setSavedValues({ toolName, toolDescription, descriptions: { ...parameterDescriptions } })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return {
    servers,
    isLoadingServers,
    inputFormat,
    startDescriptions,
    toolName,
    setToolName,
    toolNameError,
    toolDescription,
    setToolDescription,
    descriptionFallback,
    parameterDescriptions,
    setParameterDescription: (name: string, value: string) =>
      setParameterDescriptions((current) => ({ ...current, [name]: value })),
    selectedServerIds,
    setSelectedServerIds: setDraftServerIds,
    activeServerId: selectedServerIds[0] ?? null,
    onServerTool,
    isPending: pendingServers.size > 0,
    saveErrors,
    submitting,
    canSave,
    saveDisabledReason,
    save,
  }
}

export type McpToolForm = ReturnType<typeof useMcpTool>
