import { type KeyboardEvent, useCallback } from 'react'
import { MENTION_OPTIONS } from '../constants'
import type { useMentionData } from './use-mention-data'
import type { useMentionMenu } from './use-mention-menu'

/**
 * Chat item for mention insertion
 */
interface ChatItem {
  id: string
  title: string | null
}

/**
 * Workflow item for mention insertion
 */
interface WorkflowItem {
  id: string
  name: string
}

/**
 * Knowledge base item for mention insertion
 */
interface KnowledgeItem {
  id: string
  name: string
}

/**
 * Block item for mention insertion
 */
interface BlockItem {
  id: string
  name: string
}

/**
 * Template item for mention insertion
 */
interface TemplateItem {
  id: string
  name: string
}

/**
 * Log item for mention insertion
 */
interface LogItem {
  id: string
  executionId?: string
  workflowName: string
}

interface UseMentionKeyboardProps {
  /** Mention menu hook instance */
  mentionMenu: ReturnType<typeof useMentionMenu>
  /** Mention data hook instance */
  mentionData: ReturnType<typeof useMentionData>
  /** Callback to insert specific mention types */
  insertHandlers: {
    insertPastChatMention: (chat: ChatItem) => void
    insertWorkflowMention: (wf: WorkflowItem) => void
    insertKnowledgeMention: (kb: KnowledgeItem) => void
    insertBlockMention: (blk: BlockItem) => void
    insertWorkflowBlockMention: (blk: BlockItem) => void
    insertTemplateMention: (tpl: TemplateItem) => void
    insertLogMention: (log: LogItem) => void
    insertDocsMention: () => void
  }
}

/**
 * Custom hook to handle keyboard navigation in the mention menu.
 * Manages Arrow Up/Down/Left/Right and Enter key navigation through menus and submenus.
 *
 * @param props - Configuration object
 * @returns Keyboard handler for mention menu
 */
export function useMentionKeyboard({
  mentionMenu,
  mentionData,
  insertHandlers,
}: UseMentionKeyboardProps) {
  const {
    showMentionMenu,
    openSubmenuFor,
    mentionActiveIndex,
    submenuActiveIndex,
    setMentionActiveIndex,
    setSubmenuActiveIndex,
    setOpenSubmenuFor,
    setSubmenuQueryStart,
    getCaretPos,
    getActiveMentionQueryAtPosition,
    getSubmenuQuery,
    resetActiveMentionQuery,
    scrollActiveItemIntoView,
  } = mentionMenu

  const {
    pastChats,
    workflows,
    knowledgeBases,
    blocksList,
    workflowBlocks,
    templatesList,
    logsList,
    ensurePastChatsLoaded,
    ensureWorkflowsLoaded,
    ensureKnowledgeLoaded,
    ensureBlocksLoaded,
    ensureWorkflowBlocksLoaded,
    ensureTemplatesLoaded,
    ensureLogsLoaded,
  } = mentionData

  const {
    insertPastChatMention,
    insertWorkflowMention,
    insertKnowledgeMention,
    insertBlockMention,
    insertWorkflowBlockMention,
    insertTemplateMention,
    insertLogMention,
    insertDocsMention,
  } = insertHandlers

  /**
   * Build aggregated list matching the portal's ordering
   */
  const buildAggregatedList = useCallback(
    (query: string) => {
      const q = query.toLowerCase()
      return [
        ...pastChats
          .filter((c) => (c.title || 'New Chat').toLowerCase().includes(q))
          .map((c) => ({ type: 'Chats' as const, value: c })),
        ...workflows
          .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(q))
          .map((w) => ({ type: 'Workflows' as const, value: w })),
        ...knowledgeBases
          .filter((k) => (k.name || 'Untitled').toLowerCase().includes(q))
          .map((k) => ({ type: 'Knowledge' as const, value: k })),
        ...blocksList
          .filter((b) => (b.name || b.id).toLowerCase().includes(q))
          .map((b) => ({ type: 'Blocks' as const, value: b })),
        ...workflowBlocks
          .filter((b) => (b.name || b.id).toLowerCase().includes(q))
          .map((b) => ({ type: 'Workflow Blocks' as const, value: b })),
        ...templatesList
          .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(q))
          .map((t) => ({ type: 'Templates' as const, value: t })),
        ...logsList
          .filter((l) => (l.workflowName || 'Untitled Workflow').toLowerCase().includes(q))
          .map((l) => ({ type: 'Logs' as const, value: l })),
      ]
    },
    [pastChats, workflows, knowledgeBases, blocksList, workflowBlocks, templatesList, logsList]
  )

  /**
   * Handles arrow up/down navigation in mention menu
   */
  const handleArrowNavigation = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || !(e.key === 'ArrowDown' || e.key === 'ArrowUp')) return false

      e.preventDefault()
      const caretPos = getCaretPos()
      const active = getActiveMentionQueryAtPosition(caretPos)
      const mainQ = (!openSubmenuFor ? active?.query || '' : '').toLowerCase()

      // When there's a query, we show aggregated filtered view (no folders)
      const showAggregatedView = mainQ.length > 0
      const aggregatedList = showAggregatedView ? buildAggregatedList(mainQ) : []

      // When showing aggregated filtered view, navigate through the aggregated list
      if (showAggregatedView && !openSubmenuFor) {
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, aggregatedList.length - 1)
          if (aggregatedList.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
        return true
      }

      // Handle submenu navigation
      if (openSubmenuFor === 'Chats') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = pastChats.filter((c) => (c.title || 'New Chat').toLowerCase().includes(q))
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else if (openSubmenuFor === 'Workflows') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = workflows.filter((w) =>
          (w.name || 'Untitled Workflow').toLowerCase().includes(q)
        )
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else if (openSubmenuFor === 'Knowledge') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = knowledgeBases.filter((k) =>
          (k.name || 'Untitled').toLowerCase().includes(q)
        )
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else if (openSubmenuFor === 'Blocks') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = blocksList.filter((b) => (b.name || b.id).toLowerCase().includes(q))
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else if (openSubmenuFor === 'Workflow Blocks') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = workflowBlocks.filter((b) => (b.name || b.id).toLowerCase().includes(q))
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else if (openSubmenuFor === 'Templates') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = templatesList.filter((t) =>
          (t.name || 'Untitled Template').toLowerCase().includes(q)
        )
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else if (openSubmenuFor === 'Logs') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = logsList.filter((l) =>
          [l.workflowName, l.trigger || ''].join(' ').toLowerCase().includes(q)
        )
        setSubmenuActiveIndex((prev) => {
          const last = Math.max(0, filtered.length - 1)
          if (filtered.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      } else {
        // Navigate through folder options when no query
        const filteredMain = MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(mainQ))
        setMentionActiveIndex((prev) => {
          const last = Math.max(0, filteredMain.length - 1)
          if (filteredMain.length === 0) return 0
          const next =
            e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
      }

      return true
    },
    [
      showMentionMenu,
      openSubmenuFor,
      mentionActiveIndex,
      submenuActiveIndex,
      buildAggregatedList,
      pastChats,
      workflows,
      knowledgeBases,
      blocksList,
      workflowBlocks,
      templatesList,
      logsList,
      getCaretPos,
      getActiveMentionQueryAtPosition,
      getSubmenuQuery,
      scrollActiveItemIntoView,
      setMentionActiveIndex,
      setSubmenuActiveIndex,
    ]
  )

  /**
   * Handles arrow right to enter submenus
   */
  const handleArrowRight = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || e.key !== 'ArrowRight') return false

      const caretPos = getCaretPos()
      const active = getActiveMentionQueryAtPosition(caretPos)
      const mainQ = (active?.query || '').toLowerCase()
      const showAggregatedView = mainQ.length > 0

      // Don't handle arrow right in aggregated view (user is filtering, not navigating folders)
      if (showAggregatedView) return false

      e.preventDefault()
      const filteredMain = MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(mainQ))
      const selected = filteredMain[mentionActiveIndex]

      if (selected === 'Chats') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Chats')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensurePastChatsLoaded()
      } else if (selected === 'Workflows') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Workflows')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureWorkflowsLoaded()
      } else if (selected === 'Knowledge') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Knowledge')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureKnowledgeLoaded()
      } else if (selected === 'Blocks') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Blocks')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureBlocksLoaded()
      } else if (selected === 'Workflow Blocks') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Workflow Blocks')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureWorkflowBlocksLoaded()
      } else if (selected === 'Docs') {
        resetActiveMentionQuery()
        insertDocsMention()
      } else if (selected === 'Templates') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Templates')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureTemplatesLoaded()
      } else if (selected === 'Logs') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Logs')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureLogsLoaded()
      }

      return true
    },
    [
      showMentionMenu,
      mentionActiveIndex,
      openSubmenuFor,
      getCaretPos,
      getActiveMentionQueryAtPosition,
      resetActiveMentionQuery,
      setOpenSubmenuFor,
      setSubmenuActiveIndex,
      setSubmenuQueryStart,
      ensurePastChatsLoaded,
      ensureWorkflowsLoaded,
      ensureKnowledgeLoaded,
      ensureBlocksLoaded,
      ensureWorkflowBlocksLoaded,
      ensureTemplatesLoaded,
      ensureLogsLoaded,
      insertDocsMention,
    ]
  )

  /**
   * Handles arrow left to exit submenus
   */
  const handleArrowLeft = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || e.key !== 'ArrowLeft') return false

      if (openSubmenuFor) {
        e.preventDefault()
        setOpenSubmenuFor(null)
        setSubmenuQueryStart(null)
        return true
      }

      return false
    },
    [showMentionMenu, openSubmenuFor, setOpenSubmenuFor, setSubmenuQueryStart]
  )

  /**
   * Handles Enter key to select mention
   */
  const handleEnterSelection = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || e.key !== 'Enter' || e.shiftKey) return false

      e.preventDefault()
      const caretPos = getCaretPos()
      const active = getActiveMentionQueryAtPosition(caretPos)
      const mainQ = (active?.query || '').toLowerCase()
      const showAggregatedView = mainQ.length > 0
      const filteredMain = MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(mainQ))
      const selected = filteredMain[mentionActiveIndex]

      // Handle selection in aggregated filtered view
      if (showAggregatedView && !openSubmenuFor) {
        const aggregated = buildAggregatedList(mainQ)
        const idx = Math.max(0, Math.min(submenuActiveIndex, aggregated.length - 1))
        const chosen = aggregated[idx]
        if (chosen) {
          if (chosen.type === 'Chats') insertPastChatMention(chosen.value as ChatItem)
          else if (chosen.type === 'Workflows') insertWorkflowMention(chosen.value as WorkflowItem)
          else if (chosen.type === 'Knowledge')
            insertKnowledgeMention(chosen.value as KnowledgeItem)
          else if (chosen.type === 'Workflow Blocks')
            insertWorkflowBlockMention(chosen.value as BlockItem)
          else if (chosen.type === 'Blocks') insertBlockMention(chosen.value as BlockItem)
          else if (chosen.type === 'Templates') insertTemplateMention(chosen.value as TemplateItem)
          else if (chosen.type === 'Logs') insertLogMention(chosen.value as LogItem)
        }
        return true
      }

      // Handle folder navigation when no query
      if (!openSubmenuFor && selected === 'Chats') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Chats')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensurePastChatsLoaded()
      } else if (openSubmenuFor === 'Chats') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = pastChats.filter((c) => (c.title || 'New Chat').toLowerCase().includes(q))
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertPastChatMention(chosen)
          setSubmenuQueryStart(null)
        }
      } else if (!openSubmenuFor && selected === 'Workflows') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Workflows')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureWorkflowsLoaded()
      } else if (openSubmenuFor === 'Workflows') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = workflows.filter((w) =>
          (w.name || 'Untitled Workflow').toLowerCase().includes(q)
        )
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertWorkflowMention(chosen)
          setSubmenuQueryStart(null)
        }
      } else if (!openSubmenuFor && selected === 'Knowledge') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Knowledge')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureKnowledgeLoaded()
      } else if (openSubmenuFor === 'Knowledge') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = knowledgeBases.filter((k) =>
          (k.name || 'Untitled').toLowerCase().includes(q)
        )
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertKnowledgeMention(chosen)
          setSubmenuQueryStart(null)
        }
      } else if (!openSubmenuFor && selected === 'Blocks') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Blocks')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureBlocksLoaded()
      } else if (openSubmenuFor === 'Blocks') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = blocksList.filter((b) => (b.name || b.id).toLowerCase().includes(q))
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertBlockMention(chosen)
          setSubmenuQueryStart(null)
        }
      } else if (!openSubmenuFor && selected === 'Workflow Blocks') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Workflow Blocks')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureWorkflowBlocksLoaded()
      } else if (openSubmenuFor === 'Workflow Blocks') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = workflowBlocks.filter((b) => (b.name || b.id).toLowerCase().includes(q))
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertWorkflowBlockMention(chosen)
          setSubmenuQueryStart(null)
        }
      } else if (!openSubmenuFor && selected === 'Docs') {
        resetActiveMentionQuery()
        insertDocsMention()
      } else if (!openSubmenuFor && selected === 'Templates') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Templates')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureTemplatesLoaded()
      } else if (!openSubmenuFor && selected === 'Logs') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Logs')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensureLogsLoaded()
      } else if (openSubmenuFor === 'Templates') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = templatesList.filter((t) =>
          (t.name || 'Untitled Template').toLowerCase().includes(q)
        )
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertTemplateMention(chosen)
          setSubmenuQueryStart(null)
        }
      } else if (openSubmenuFor === 'Logs') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = logsList.filter((l) =>
          [l.workflowName, l.trigger || ''].join(' ').toLowerCase().includes(q)
        )
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          insertLogMention(chosen)
          setSubmenuQueryStart(null)
        }
      }

      return true
    },
    [
      showMentionMenu,
      openSubmenuFor,
      mentionActiveIndex,
      submenuActiveIndex,
      buildAggregatedList,
      pastChats,
      workflows,
      knowledgeBases,
      blocksList,
      workflowBlocks,
      templatesList,
      logsList,
      getCaretPos,
      getActiveMentionQueryAtPosition,
      getSubmenuQuery,
      resetActiveMentionQuery,
      setOpenSubmenuFor,
      setSubmenuActiveIndex,
      setSubmenuQueryStart,
      ensurePastChatsLoaded,
      ensureWorkflowsLoaded,
      ensureKnowledgeLoaded,
      ensureBlocksLoaded,
      ensureWorkflowBlocksLoaded,
      ensureTemplatesLoaded,
      ensureLogsLoaded,
      insertPastChatMention,
      insertWorkflowMention,
      insertKnowledgeMention,
      insertBlockMention,
      insertWorkflowBlockMention,
      insertTemplateMention,
      insertLogMention,
      insertDocsMention,
    ]
  )

  return {
    handleArrowNavigation,
    handleArrowRight,
    handleArrowLeft,
    handleEnterSelection,
  }
}
