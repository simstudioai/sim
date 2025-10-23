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
    inAggregated,
    setMentionActiveIndex,
    setSubmenuActiveIndex,
    setInAggregated,
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
   * Handles arrow up/down navigation in mention menu
   */
  const handleArrowNavigation = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || !(e.key === 'ArrowDown' || e.key === 'ArrowUp')) return false

      e.preventDefault()
      const caretPos = getCaretPos()
      const active = getActiveMentionQueryAtPosition(caretPos)
      const mainQ = (!openSubmenuFor ? active?.query || '' : '').toLowerCase()
      const filteredMain = !openSubmenuFor
        ? MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(mainQ))
        : []

      const aggregatedList = !openSubmenuFor
        ? [
            ...workflowBlocks
              .filter((b) => (b.name || b.id).toLowerCase().includes(mainQ))
              .map((b) => ({ type: 'Workflow Blocks' as const, value: b })),
            ...workflows
              .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(mainQ))
              .map((w) => ({ type: 'Workflows' as const, value: w })),
            ...blocksList
              .filter((b) => (b.name || b.id).toLowerCase().includes(mainQ))
              .map((b) => ({ type: 'Blocks' as const, value: b })),
            ...knowledgeBases
              .filter((k) => (k.name || 'Untitled').toLowerCase().includes(mainQ))
              .map((k) => ({ type: 'Knowledge' as const, value: k })),
            ...templatesList
              .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(mainQ))
              .map((t) => ({ type: 'Templates' as const, value: t })),
            ...pastChats
              .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(mainQ))
              .map((c) => ({ type: 'Chats' as const, value: c })),
            ...logsList
              .filter((l) => (l.workflowName || 'Untitled Workflow').toLowerCase().includes(mainQ))
              .map((l) => ({ type: 'Logs' as const, value: l })),
          ]
        : []

      // Handle submenu navigation
      if (openSubmenuFor === 'Chats') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = pastChats.filter((c) =>
          (c.title || 'Untitled Chat').toLowerCase().includes(q)
        )
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
        // Navigate through main options and aggregated matches
        const isAggregate = mainQ.length > 0 && filteredMain.length === 0

        if (isAggregate || inAggregated) {
          const aggregated = aggregatedList
          setInAggregated(true)
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, aggregated.length - 1)
            if (aggregated.length === 0) return 0
            const next =
              e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        } else if (!inAggregated) {
          const lastMain = Math.max(0, filteredMain.length - 1)
          if (filteredMain.length === 0) {
            if (aggregatedList.length > 0) {
              setInAggregated(true)
              setSubmenuActiveIndex(0)
              requestAnimationFrame(() => scrollActiveItemIntoView(0))
            }
          } else if (e.key === 'ArrowDown' && mentionActiveIndex >= lastMain) {
            if (aggregatedList.length > 0) {
              setInAggregated(true)
              setSubmenuActiveIndex(0)
              requestAnimationFrame(() => scrollActiveItemIntoView(0))
            } else {
              setMentionActiveIndex(0)
              requestAnimationFrame(() => scrollActiveItemIntoView(0))
            }
          } else if (e.key === 'ArrowUp' && mentionActiveIndex <= 0 && aggregatedList.length > 0) {
            setInAggregated(true)
            setSubmenuActiveIndex(Math.max(0, aggregatedList.length - 1))
            requestAnimationFrame(() =>
              scrollActiveItemIntoView(Math.max(0, aggregatedList.length - 1))
            )
          } else {
            setMentionActiveIndex((prev) => {
              const last = lastMain
              if (filteredMain.length === 0) return 0
              const next =
                e.key === 'ArrowDown' ? (prev >= last ? last : prev + 1) : prev <= 0 ? 0 : prev - 1
              requestAnimationFrame(() => scrollActiveItemIntoView(next))
              return next
            })
          }
        } else {
          // Inside aggregated list
          setSubmenuActiveIndex((prev) => {
            const last = Math.max(0, aggregatedList.length - 1)
            if (aggregatedList.length === 0) return 0
            if (e.key === 'ArrowDown') {
              if (prev >= last) {
                setInAggregated(false)
                requestAnimationFrame(() => scrollActiveItemIntoView(0))
                return prev
              }
              const next = prev + 1
              requestAnimationFrame(() => scrollActiveItemIntoView(next))
              return next
            }
            if (prev <= 0) {
              setInAggregated(false)
              setMentionActiveIndex(Math.max(0, filteredMain.length - 1))
              requestAnimationFrame(() =>
                scrollActiveItemIntoView(Math.max(0, filteredMain.length - 1))
              )
              return prev
            }
            const next = prev - 1
            requestAnimationFrame(() => scrollActiveItemIntoView(next))
            return next
          })
        }
      }

      return true
    },
    [
      showMentionMenu,
      openSubmenuFor,
      mentionActiveIndex,
      submenuActiveIndex,
      inAggregated,
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
      setInAggregated,
    ]
  )

  /**
   * Handles arrow right to enter submenus
   */
  const handleArrowRight = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || e.key !== 'ArrowRight') return false

      e.preventDefault()
      if (inAggregated) return true

      const caretPos = getCaretPos()
      const active = getActiveMentionQueryAtPosition(caretPos)
      const mainQ = (active?.query || '').toLowerCase()
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
      inAggregated,
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
      if (inAggregated) {
        e.preventDefault()
        setInAggregated(false)
        return true
      }

      return false
    },
    [
      showMentionMenu,
      openSubmenuFor,
      inAggregated,
      setOpenSubmenuFor,
      setSubmenuQueryStart,
      setInAggregated,
    ]
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
      const filteredMain = MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(mainQ))
      const isAggregate = !openSubmenuFor && mainQ.length > 0 && filteredMain.length === 0
      const selected = filteredMain[mentionActiveIndex]

      if (inAggregated || isAggregate) {
        const aggregated = [
          ...workflowBlocks
            .filter((b) => (b.name || b.id).toLowerCase().includes(mainQ))
            .map((b) => ({ type: 'Workflow Blocks', value: b })),
          ...workflows
            .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(mainQ))
            .map((w) => ({ type: 'Workflows', value: w })),
          ...blocksList
            .filter((b) => (b.name || b.id).toLowerCase().includes(mainQ))
            .map((b) => ({ type: 'Blocks', value: b })),
          ...knowledgeBases
            .filter((k) => (k.name || 'Untitled').toLowerCase().includes(mainQ))
            .map((k) => ({ type: 'Knowledge', value: k })),
          ...templatesList
            .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(mainQ))
            .map((t) => ({ type: 'Templates', value: t })),
          ...pastChats
            .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(mainQ))
            .map((c) => ({ type: 'Chats', value: c })),
          ...logsList
            .filter((l) => (l.workflowName || 'Untitled Workflow').toLowerCase().includes(mainQ))
            .map((l) => ({ type: 'Logs', value: l })),
        ]
        const idx = Math.max(0, Math.min(submenuActiveIndex, aggregated.length - 1))
        const chosen = aggregated[idx]
        if (chosen) {
          if (chosen.type === 'Chats') insertPastChatMention(chosen.value)
          else if (chosen.type === 'Workflows') insertWorkflowMention(chosen.value)
          else if (chosen.type === 'Knowledge') insertKnowledgeMention(chosen.value)
          else if (chosen.type === 'Workflow Blocks') insertWorkflowBlockMention(chosen.value)
          else if (chosen.type === 'Blocks') insertBlockMention(chosen.value)
          else if (chosen.type === 'Templates') insertTemplateMention(chosen.value)
          else if (chosen.type === 'Logs') insertLogMention(chosen.value)
        }
      } else if (!openSubmenuFor && selected === 'Chats') {
        resetActiveMentionQuery()
        setOpenSubmenuFor('Chats')
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        void ensurePastChatsLoaded()
      } else if (openSubmenuFor === 'Chats') {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = pastChats.filter((c) =>
          (c.title || 'Untitled Chat').toLowerCase().includes(q)
        )
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
      inAggregated,
      mentionActiveIndex,
      submenuActiveIndex,
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
