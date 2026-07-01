'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import { requestJson } from '@/lib/api/client/request'
import { listCopilotChatsContract } from '@/lib/api/contracts/copilot'
import { listKnowledgeBasesContract } from '@/lib/api/contracts/knowledge/base'
import { listLogsContract } from '@/lib/api/contracts/logs'
import { type IntegrationDescriptor, listIntegrations } from '@/blocks/integration-matcher'
import { useWorkflows } from '@/hooks/queries/workflows'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('useMentionData')

/**
 * Represents a past chat for mention suggestions
 */
export interface PastChat {
  id: string
  title: string | null
  workflowId: string | null
  updatedAt?: string
}

/**
 * Represents a workflow for mention suggestions
 */
export interface WorkflowItem {
  id: string
  name: string
  color?: string
}

/**
 * Represents a knowledge base for mention suggestions
 */
export interface KnowledgeItem {
  id: string
  name: string
}

/**
 * Represents a block for mention suggestions
 */
export interface BlockItem {
  id: string
  name: string
  iconComponent?: any
  bgColor?: string
}

/**
 * Represents a workflow block for mention suggestions
 */
export interface WorkflowBlockItem {
  id: string
  name: string
  type: string
  iconComponent?: any
  bgColor?: string
}

/**
 * Represents a log/execution for mention suggestions
 */
export interface LogItem {
  id: string
  executionId?: string
  level: string
  trigger: string | null
  createdAt: string
  workflowName: string
}

interface UseMentionDataProps {
  workflowId: string | null
  workspaceId: string
}

/**
 * Return type for useMentionData hook
 */
export interface MentionDataReturn {
  // Data arrays
  pastChats: PastChat[]
  workflows: WorkflowItem[]
  knowledgeBases: KnowledgeItem[]
  blocksList: BlockItem[]
  workflowBlocks: WorkflowBlockItem[]
  logsList: LogItem[]
  integrations: readonly IntegrationDescriptor[]

  // Loading states
  isLoadingPastChats: boolean
  isLoadingWorkflows: boolean
  isLoadingKnowledge: boolean
  isLoadingBlocks: boolean
  isLoadingWorkflowBlocks: boolean
  isLoadingLogs: boolean
  isLoadingIntegrations: boolean

  // Ensure loaded functions
  ensurePastChatsLoaded: () => Promise<void>
  ensureKnowledgeLoaded: () => Promise<void>
  ensureBlocksLoaded: () => Promise<void>
  ensureLogsLoaded: () => Promise<void>
}

/**
 * Custom hook to fetch and manage data for mention suggestions
 * Loads data from APIs for chats, workflows, knowledge bases, blocks, and logs
 *
 * @param props - Configuration including workflow and workspace IDs
 * @returns Mention data state and loading operations
 */
export function useMentionData(props: UseMentionDataProps): MentionDataReturn {
  const { workflowId, workspaceId } = props

  const { config, isBlockAllowed } = usePermissionConfig()

  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeItem[]>([])
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false)

  const [blocksList, setBlocksList] = useState<BlockItem[]>([])
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false)

  useEffect(() => {
    setBlocksList([])
  }, [config.allowedIntegrations])

  const [logsList, setLogsList] = useState<LogItem[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  const [workflowBlocks, setWorkflowBlocks] = useState<WorkflowBlockItem[]>([])
  const [isLoadingWorkflowBlocks, setIsLoadingWorkflowBlocks] = useState(false)

  // Integrations are derived synchronously from the block registry via the
  // shared auto-mention matcher singleton — no fetch, no loading state. The
  // accessor returns a stable cached reference so no memoization is needed.
  const integrations = listIntegrations()

  const blockKeys = useWorkflowStore(
    useShallow(useCallback((state) => Object.keys(state.blocks), []))
  )

  const { data: registryWorkflowList = [] } = useWorkflows(workspaceId)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isLoadingWorkflows = hydrationPhase === 'idle' || hydrationPhase === 'state-loading'

  const workflows: WorkflowItem[] = registryWorkflowList
    .filter((w) => w.workspaceId === workspaceId)
    .sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })
    .map((w) => ({
      id: w.id,
      name: w.name || 'Untitled Workflow',
    }))

  /**
   * Resets past chats when workflow changes.
   * Adjusted during render via a prev-ref comparison so the stale list is never
   * committed between renders.
   */
  const prevWorkflowIdRef = useRef(workflowId)
  if (prevWorkflowIdRef.current !== workflowId) {
    prevWorkflowIdRef.current = workflowId
    setPastChats([])
    setIsLoadingPastChats(false)
  }

  /**
   * Syncs workflow blocks from store
   * Only re-runs when blocks are added/removed (not on position updates)
   */
  useEffect(() => {
    const syncWorkflowBlocks = async () => {
      if (!workflowId || blockKeys.length === 0) {
        setWorkflowBlocks([])
        return
      }

      try {
        // Fetch current blocks from store
        const workflowStoreBlocks = useWorkflowStore.getState().blocks

        const { registry: blockRegistry } = await import('@/blocks/registry')
        const mapped = Object.values(workflowStoreBlocks).map((b: any) => {
          const reg = (blockRegistry as any)[b.type]
          return {
            id: b.id,
            name: b.name || b.id,
            type: b.type,
            iconComponent: reg?.icon,
            bgColor: reg?.bgColor || '#6B7280',
          }
        })
        setWorkflowBlocks(mapped)
        logger.debug('Synced workflow blocks for mention menu', {
          count: mapped.length,
        })
      } catch (error) {
        logger.debug('Failed to sync workflow blocks:', error)
      }
    }

    syncWorkflowBlocks()
  }, [blockKeys, workflowId])

  /**
   * Ensures past chats are loaded
   */
  const ensurePastChatsLoaded = useCallback(async () => {
    if (isLoadingPastChats || pastChats.length > 0) return
    try {
      setIsLoadingPastChats(true)
      const data = await requestJson(listCopilotChatsContract, {})
      const items = data.chats

      const currentWorkflowChats = items.filter((c) => c.workflowId === workflowId)

      setPastChats(
        currentWorkflowChats.map((c) => ({
          id: c.id,
          title: c.title ?? null,
          workflowId: c.workflowId ?? null,
          updatedAt: c.updatedAt ?? undefined,
        }))
      )
    } catch {
    } finally {
      setIsLoadingPastChats(false)
    }
  }, [isLoadingPastChats, pastChats.length, workflowId])

  /**
   * Ensures knowledge bases are loaded
   */
  const ensureKnowledgeLoaded = useCallback(async () => {
    if (isLoadingKnowledge || knowledgeBases.length > 0) return
    try {
      setIsLoadingKnowledge(true)
      const result = await requestJson(listKnowledgeBasesContract, {
        query: { workspaceId },
      })
      const items = result.data
      const sorted = [...items].sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return tb - ta
      })
      setKnowledgeBases(sorted.map((k) => ({ id: k.id, name: k.name || 'Untitled' })))
    } catch {
    } finally {
      setIsLoadingKnowledge(false)
    }
  }, [isLoadingKnowledge, knowledgeBases.length, workspaceId])

  /**
   * Ensures blocks are loaded
   */
  const ensureBlocksLoaded = useCallback(async () => {
    if (isLoadingBlocks || blocksList.length > 0) return
    try {
      setIsLoadingBlocks(true)
      const { getAllBlocks } = await import('@/blocks')
      const all = getAllBlocks()
      const regularBlocks = all
        .flatMap((b: any) =>
          b.type !== 'starter' &&
          !b.hideFromToolbar &&
          b.category === 'blocks' &&
          isBlockAllowed(b.type)
            ? [
                {
                  id: b.type,
                  name: b.name || b.type,
                  iconComponent: b.icon,
                  bgColor: b.bgColor,
                },
              ]
            : []
        )
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      const toolBlocks = all
        .flatMap((b: any) =>
          b.type !== 'starter' &&
          !b.hideFromToolbar &&
          b.category === 'tools' &&
          isBlockAllowed(b.type)
            ? [
                {
                  id: b.type,
                  name: b.name || b.type,
                  iconComponent: b.icon,
                  bgColor: b.bgColor,
                },
              ]
            : []
        )
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      setBlocksList([...regularBlocks, ...toolBlocks])
    } catch {
    } finally {
      setIsLoadingBlocks(false)
    }
  }, [isLoadingBlocks, blocksList.length, isBlockAllowed])

  /**
   * Ensures logs are loaded
   */
  const ensureLogsLoaded = useCallback(async () => {
    if (isLoadingLogs || logsList.length > 0) return
    try {
      setIsLoadingLogs(true)
      const data = await requestJson(listLogsContract, {
        query: { workspaceId, limit: 50 },
      })
      const items = data.data
      const mapped = items.map((l) => ({
        id: l.id,
        executionId: l.executionId || l.id,
        level: l.level,
        trigger: l.trigger || null,
        createdAt: l.createdAt,
        workflowName: l.workflow?.name ?? 'Untitled Workflow',
      }))
      setLogsList(mapped)
    } catch {
    } finally {
      setIsLoadingLogs(false)
    }
  }, [isLoadingLogs, logsList.length, workspaceId])

  return {
    // State
    pastChats,
    isLoadingPastChats,
    workflows,
    isLoadingWorkflows,
    knowledgeBases,
    isLoadingKnowledge,
    blocksList,
    isLoadingBlocks,
    logsList,
    isLoadingLogs,
    workflowBlocks,
    isLoadingWorkflowBlocks,
    integrations,
    isLoadingIntegrations: false,

    // Operations
    ensurePastChatsLoaded,
    ensureKnowledgeLoaded,
    ensureBlocksLoaded,
    ensureLogsLoaded,
  }
}
