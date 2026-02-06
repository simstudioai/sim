'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import { useKnowledgeBasesQuery } from '@/hooks/queries/knowledge'
import { useRecentLogs } from '@/hooks/queries/logs'
import { useTemplates } from '@/hooks/queries/templates'
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
 * Represents a template for mention suggestions
 */
export interface TemplateItem {
  id: string
  name: string
  stars: number
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
  templatesList: TemplateItem[]
  logsList: LogItem[]

  // Loading states
  isLoadingPastChats: boolean
  isLoadingWorkflows: boolean
  isLoadingKnowledge: boolean
  isLoadingBlocks: boolean
  isLoadingWorkflowBlocks: boolean
  isLoadingTemplates: boolean
  isLoadingLogs: boolean

  // Ensure loaded functions
  ensurePastChatsLoaded: () => Promise<void>
  ensureKnowledgeLoaded: () => void
  ensureBlocksLoaded: () => Promise<void>
  ensureTemplatesLoaded: () => void
  ensureLogsLoaded: () => void
}

/**
 * Custom hook to fetch and manage data for mention suggestions
 * Loads data from APIs for chats, workflows, knowledge bases, blocks, templates, and logs
 *
 * @param props - Configuration including workflow and workspace IDs
 * @returns Mention data state and loading operations
 */
export function useMentionData(props: UseMentionDataProps): MentionDataReturn {
  const { workflowId, workspaceId } = props

  const { config, isBlockAllowed } = usePermissionConfig()

  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)

  const [shouldLoadKnowledge, setShouldLoadKnowledge] = useState(false)
  const { data: knowledgeData = [], isLoading: isLoadingKnowledge } = useKnowledgeBasesQuery(
    workspaceId,
    { enabled: shouldLoadKnowledge }
  )

  const knowledgeBases = useMemo<KnowledgeItem[]>(() => {
    const sorted = [...knowledgeData].sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime()
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime()
      return tb - ta
    })
    return sorted.map((k) => ({ id: k.id, name: k.name || 'Untitled' }))
  }, [knowledgeData])

  const [blocksList, setBlocksList] = useState<BlockItem[]>([])
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false)

  useEffect(() => {
    setBlocksList([])
  }, [config.allowedIntegrations])

  const [shouldLoadTemplates, setShouldLoadTemplates] = useState(false)
  const { data: templatesData, isLoading: isLoadingTemplates } = useTemplates(
    { limit: 50, offset: 0 },
    { enabled: shouldLoadTemplates }
  )

  const templatesList = useMemo<TemplateItem[]>(() => {
    const items = templatesData?.data ?? []
    return items
      .map((t) => ({ id: t.id, name: t.name || 'Untitled Template', stars: t.stars || 0 }))
      .sort((a, b) => b.stars - a.stars)
  }, [templatesData])

  const [shouldLoadLogs, setShouldLoadLogs] = useState(false)
  const { data: logsData = [], isLoading: isLoadingLogs } = useRecentLogs(workspaceId, 50, {
    enabled: shouldLoadLogs,
  })

  const logsList = useMemo<LogItem[]>(
    () =>
      logsData.map((l) => ({
        id: l.id,
        executionId: l.executionId || l.id,
        level: l.level,
        trigger: l.trigger || null,
        createdAt: l.createdAt,
        workflowName:
          (l.workflow && (l.workflow.name || l.workflow.title)) ||
          l.workflowName ||
          'Untitled Workflow',
      })),
    [logsData]
  )

  const [workflowBlocks, setWorkflowBlocks] = useState<WorkflowBlockItem[]>([])
  const [isLoadingWorkflowBlocks, setIsLoadingWorkflowBlocks] = useState(false)

  const blockKeys = useWorkflowStore(
    useShallow(useCallback((state) => Object.keys(state.blocks), []))
  )

  const registryWorkflows = useWorkflowRegistry(useShallow((state) => state.workflows))
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isLoadingWorkflows =
    hydrationPhase === 'idle' ||
    hydrationPhase === 'metadata-loading' ||
    hydrationPhase === 'state-loading'

  const workflows: WorkflowItem[] = Object.values(registryWorkflows)
    .filter((w) => w.workspaceId === workspaceId)
    .sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })
    .map((w) => ({
      id: w.id,
      name: w.name || 'Untitled Workflow',
      color: w.color,
    }))

  /**
   * Resets past chats when workflow changes
   */
  useEffect(() => {
    setPastChats([])
    setIsLoadingPastChats(false)
  }, [workflowId])

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
      const resp = await fetch('/api/copilot/chats')
      if (!resp.ok) throw new Error(`Failed to load chats: ${resp.status}`)
      const data = await resp.json()
      const items = Array.isArray(data?.chats) ? data.chats : []

      const currentWorkflowChats = items.filter((c: any) => c.workflowId === workflowId)

      setPastChats(
        currentWorkflowChats.map((c: any) => ({
          id: c.id,
          title: c.title ?? null,
          workflowId: c.workflowId ?? null,
          updatedAt: c.updatedAt,
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
  const ensureKnowledgeLoaded = useCallback(() => {
    if (!shouldLoadKnowledge) {
      setShouldLoadKnowledge(true)
    }
  }, [shouldLoadKnowledge])

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
        .filter(
          (b: any) =>
            b.type !== 'starter' &&
            !b.hideFromToolbar &&
            b.category === 'blocks' &&
            isBlockAllowed(b.type)
        )
        .map((b: any) => ({
          id: b.type,
          name: b.name || b.type,
          iconComponent: b.icon,
          bgColor: b.bgColor,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      const toolBlocks = all
        .filter(
          (b: any) =>
            b.type !== 'starter' &&
            !b.hideFromToolbar &&
            b.category === 'tools' &&
            isBlockAllowed(b.type)
        )
        .map((b: any) => ({
          id: b.type,
          name: b.name || b.type,
          iconComponent: b.icon,
          bgColor: b.bgColor,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      setBlocksList([...regularBlocks, ...toolBlocks])
    } catch {
    } finally {
      setIsLoadingBlocks(false)
    }
  }, [isLoadingBlocks, blocksList.length, isBlockAllowed])

  /**
   * Ensures templates are loaded
   */
  const ensureTemplatesLoaded = useCallback(() => {
    if (!shouldLoadTemplates) {
      setShouldLoadTemplates(true)
    }
  }, [shouldLoadTemplates])

  /**
   * Ensures logs are loaded
   */
  const ensureLogsLoaded = useCallback(() => {
    if (!shouldLoadLogs) {
      setShouldLoadLogs(true)
    }
  }, [shouldLoadLogs])

  return {
    pastChats,
    isLoadingPastChats,
    workflows,
    isLoadingWorkflows,
    knowledgeBases,
    isLoadingKnowledge,
    blocksList,
    isLoadingBlocks,
    templatesList,
    isLoadingTemplates,
    logsList,
    isLoadingLogs,
    workflowBlocks,
    isLoadingWorkflowBlocks,
    ensurePastChatsLoaded,
    ensureKnowledgeLoaded,
    ensureBlocksLoaded,
    ensureTemplatesLoaded,
    ensureLogsLoaded,
  }
}
