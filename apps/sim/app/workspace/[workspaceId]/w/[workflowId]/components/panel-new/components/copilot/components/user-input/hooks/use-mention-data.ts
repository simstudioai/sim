'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
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
 * Custom hook to fetch and manage data for mention suggestions
 * Loads data from APIs for chats, workflows, knowledge bases, blocks, templates, and logs
 *
 * @param props - Configuration including workflow and workspace IDs
 * @returns Mention data state and loading operations
 */
export function useMentionData(props: UseMentionDataProps) {
  const { workflowId, workspaceId } = props

  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeItem[]>([])
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false)

  const [blocksList, setBlocksList] = useState<BlockItem[]>([])
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false)

  const [templatesList, setTemplatesList] = useState<TemplateItem[]>([])
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)

  const [logsList, setLogsList] = useState<LogItem[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  const [workflowBlocks, setWorkflowBlocks] = useState<WorkflowBlockItem[]>([])
  const [isLoadingWorkflowBlocks, setIsLoadingWorkflowBlocks] = useState(false)

  const workflowStoreBlocks = useWorkflowStore((state) => state.blocks)

  // Use workflow registry as source of truth for workflows
  const registryWorkflows = useWorkflowRegistry((state) => state.workflows)
  const isLoadingWorkflows = useWorkflowRegistry((state) => state.isLoading)

  // Convert registry workflows to mention format, filtered by workspace and sorted
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
   */
  useEffect(() => {
    const syncWorkflowBlocks = async () => {
      if (!workflowId || !workflowStoreBlocks || Object.keys(workflowStoreBlocks).length === 0) {
        setWorkflowBlocks([])
        return
      }

      try {
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
  }, [workflowStoreBlocks, workflowId])

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
   * Ensures workflows are loaded (now using registry store)
   */
  const ensureWorkflowsLoaded = useCallback(() => {
    // Workflows are now automatically loaded from the registry store
    // No manual fetching needed
  }, [])

  /**
   * Ensures knowledge bases are loaded
   */
  const ensureKnowledgeLoaded = useCallback(async () => {
    if (isLoadingKnowledge || knowledgeBases.length > 0) return
    try {
      setIsLoadingKnowledge(true)
      const resp = await fetch(`/api/knowledge?workspaceId=${workspaceId}`)
      if (!resp.ok) throw new Error(`Failed to load knowledge bases: ${resp.status}`)
      const data = await resp.json()
      const items = Array.isArray(data?.data) ? data.data : []
      const sorted = [...items].sort((a: any, b: any) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return tb - ta
      })
      setKnowledgeBases(sorted.map((k: any) => ({ id: k.id, name: k.name || 'Untitled' })))
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
        .filter((b: any) => b.type !== 'starter' && !b.hideFromToolbar && b.category === 'blocks')
        .map((b: any) => ({
          id: b.type,
          name: b.name || b.type,
          iconComponent: b.icon,
          bgColor: b.bgColor,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      const toolBlocks = all
        .filter((b: any) => b.type !== 'starter' && !b.hideFromToolbar && b.category === 'tools')
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
  }, [isLoadingBlocks, blocksList.length])

  /**
   * Ensures templates are loaded
   */
  const ensureTemplatesLoaded = useCallback(async () => {
    if (isLoadingTemplates || templatesList.length > 0) return
    try {
      setIsLoadingTemplates(true)
      const resp = await fetch('/api/templates?limit=50&offset=0')
      if (!resp.ok) throw new Error(`Failed to load templates: ${resp.status}`)
      const data = await resp.json()
      const items = Array.isArray(data?.data) ? data.data : []
      const mapped = items
        .map((t: any) => ({ id: t.id, name: t.name || 'Untitled Template', stars: t.stars || 0 }))
        .sort((a: any, b: any) => b.stars - a.stars)
      setTemplatesList(mapped)
    } catch {
    } finally {
      setIsLoadingTemplates(false)
    }
  }, [isLoadingTemplates, templatesList.length])

  /**
   * Ensures logs are loaded
   */
  const ensureLogsLoaded = useCallback(async () => {
    if (isLoadingLogs || logsList.length > 0) return
    try {
      setIsLoadingLogs(true)
      const resp = await fetch(`/api/logs?workspaceId=${workspaceId}&limit=50&details=full`)
      if (!resp.ok) throw new Error(`Failed to load logs: ${resp.status}`)
      const data = await resp.json()
      const items = Array.isArray(data?.data) ? data.data : []
      const mapped = items.map((l: any) => ({
        id: l.id,
        executionId: l.executionId || l.id,
        level: l.level,
        trigger: l.trigger || null,
        createdAt: l.createdAt,
        workflowName:
          (l.workflow && (l.workflow.name || l.workflow.title)) ||
          l.workflowName ||
          'Untitled Workflow',
      }))
      setLogsList(mapped)
    } catch {
    } finally {
      setIsLoadingLogs(false)
    }
  }, [isLoadingLogs, logsList.length, workspaceId])

  /**
   * Ensures workflow blocks are loaded (synced from store)
   */
  const ensureWorkflowBlocksLoaded = useCallback(async () => {
    if (!workflowId) return
    logger.debug('ensureWorkflowBlocksLoaded called', {
      workflowId,
      storeBlocksCount: Object.keys(workflowStoreBlocks || {}).length,
      workflowBlocksCount: workflowBlocks.length,
    })
  }, [workflowId, workflowStoreBlocks, workflowBlocks.length])

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
    templatesList,
    isLoadingTemplates,
    logsList,
    isLoadingLogs,
    workflowBlocks,
    isLoadingWorkflowBlocks,

    // Operations
    ensurePastChatsLoaded,
    ensureWorkflowsLoaded,
    ensureKnowledgeLoaded,
    ensureBlocksLoaded,
    ensureTemplatesLoaded,
    ensureLogsLoaded,
    ensureWorkflowBlocksLoaded,
  }
}
