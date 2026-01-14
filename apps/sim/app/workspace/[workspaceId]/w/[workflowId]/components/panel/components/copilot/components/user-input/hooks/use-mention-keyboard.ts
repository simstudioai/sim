import { type KeyboardEvent, useCallback, useMemo } from 'react'
import type { MentionFolderNav } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components'
import {
  FOLDER_CONFIGS,
  FOLDER_ORDER,
  type MentionFolderId,
  ROOT_MENU_ITEM_COUNT,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import type {
  useMentionData,
  useMentionMenu,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import {
  getFolderData as getFolderDataUtil,
  getFolderEnsureLoaded as getFolderEnsureLoadedUtil,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'

interface UseMentionKeyboardProps {
  /** Mention menu hook instance */
  mentionMenu: ReturnType<typeof useMentionMenu>
  /** Mention data hook instance */
  mentionData: ReturnType<typeof useMentionData>
  /** Callback to insert specific mention types */
  insertHandlers: {
    insertPastChatMention: (chat: any) => void
    insertWorkflowMention: (wf: any) => void
    insertKnowledgeMention: (kb: any) => void
    insertBlockMention: (blk: any) => void
    insertWorkflowBlockMention: (blk: any) => void
    insertTemplateMention: (tpl: any) => void
    insertLogMention: (log: any) => void
    insertDocsMention: () => void
  }
  /** Folder navigation state exposed from MentionMenu via callback */
  mentionFolderNav: MentionFolderNav | null
}

/**
 * Custom hook to handle keyboard navigation in the mention menu.
 */
export function useMentionKeyboard({
  mentionMenu,
  mentionData,
  insertHandlers,
  mentionFolderNav,
}: UseMentionKeyboardProps) {
  const {
    showMentionMenu,
    mentionActiveIndex,
    submenuActiveIndex,
    setMentionActiveIndex,
    setSubmenuActiveIndex,
    setSubmenuQueryStart,
    getCaretPos,
    getActiveMentionQueryAtPosition,
    getSubmenuQuery,
    resetActiveMentionQuery,
    scrollActiveItemIntoView,
  } = mentionMenu

  const currentFolder = mentionFolderNav?.currentFolder ?? null
  const isInFolder = mentionFolderNav?.isInFolder ?? false

  /**
   * Map of folder IDs to insert handlers
   */
  const insertHandlerMap = useMemo(
    (): Record<MentionFolderId, (item: any) => void> => ({
      chats: insertHandlers.insertPastChatMention,
      workflows: insertHandlers.insertWorkflowMention,
      knowledge: insertHandlers.insertKnowledgeMention,
      blocks: insertHandlers.insertBlockMention,
      'workflow-blocks': insertHandlers.insertWorkflowBlockMention,
      templates: insertHandlers.insertTemplateMention,
      logs: insertHandlers.insertLogMention,
    }),
    [insertHandlers]
  )

  /**
   * Get data array for a folder from mentionData
   */
  const getFolderData = useCallback(
    (folderId: MentionFolderId) => getFolderDataUtil(mentionData, folderId),
    [mentionData]
  )

  /**
   * Filter items for a folder based on query using config's filterFn
   */
  const filterFolderItems = useCallback(
    (folderId: MentionFolderId, query: string): any[] => {
      const config = FOLDER_CONFIGS[folderId]
      const items = getFolderData(folderId)
      if (!query) return items
      const q = query.toLowerCase()
      return items.filter((item) => config.filterFn(item, q))
    },
    [getFolderData]
  )

  /**
   * Ensure data is loaded for a folder
   */
  const ensureFolderLoaded = useCallback(
    (folderId: MentionFolderId): void => {
      const ensureFn = getFolderEnsureLoadedUtil(mentionData, folderId)
      if (ensureFn) void ensureFn()
    },
    [mentionData]
  )

  /**
   * Build aggregated list matching the portal's ordering
   */
  const buildAggregatedList = useCallback(
    (query: string): Array<{ type: MentionFolderId | 'docs'; value: any }> => {
      const q = query.toLowerCase()
      const result: Array<{ type: MentionFolderId | 'docs'; value: any }> = []

      for (const folderId of FOLDER_ORDER) {
        const filtered = filterFolderItems(folderId, q)
        filtered.forEach((item) => {
          result.push({ type: folderId, value: item })
        })
      }

      if ('docs'.includes(q)) {
        result.push({ type: 'docs', value: null })
      }

      return result
    },
    [filterFolderItems]
  )

  /**
   * Generic navigation helper for navigating through items
   */
  const navigateItems = useCallback(
    (
      direction: 'up' | 'down',
      itemCount: number,
      setIndex: (fn: (prev: number) => number) => void
    ) => {
      setIndex((prev) => {
        const last = Math.max(0, itemCount - 1)
        if (itemCount === 0) return 0
        const next =
          direction === 'down' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1
        requestAnimationFrame(() => scrollActiveItemIntoView(next))
        return next
      })
    },
    [scrollActiveItemIntoView]
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
      const mainQ = (!isInFolder ? active?.query || '' : '').toLowerCase()
      const direction = e.key === 'ArrowDown' ? 'down' : 'up'

      const showAggregatedView = mainQ.length > 0
      if (showAggregatedView && !isInFolder) {
        const aggregatedList = buildAggregatedList(mainQ)
        navigateItems(direction, aggregatedList.length, setSubmenuActiveIndex)
        return true
      }

      if (currentFolder && FOLDER_CONFIGS[currentFolder as MentionFolderId]) {
        const q = getSubmenuQuery().toLowerCase()
        const filtered = filterFolderItems(currentFolder as MentionFolderId, q)
        navigateItems(direction, filtered.length, setSubmenuActiveIndex)
        return true
      }

      navigateItems(direction, ROOT_MENU_ITEM_COUNT, setMentionActiveIndex)
      return true
    },
    [
      showMentionMenu,
      isInFolder,
      currentFolder,
      buildAggregatedList,
      filterFolderItems,
      navigateItems,
      getCaretPos,
      getActiveMentionQueryAtPosition,
      getSubmenuQuery,
      setMentionActiveIndex,
      setSubmenuActiveIndex,
    ]
  )

  /**
   * Handles arrow right to enter submenus
   */
  const handleArrowRight = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || e.key !== 'ArrowRight' || !mentionFolderNav) return false

      const caretPos = getCaretPos()
      const active = getActiveMentionQueryAtPosition(caretPos)
      const mainQ = (active?.query || '').toLowerCase()

      if (mainQ.length > 0) return false

      e.preventDefault()

      const isDocsSelected = mentionActiveIndex === FOLDER_ORDER.length
      if (isDocsSelected) {
        resetActiveMentionQuery()
        insertHandlers.insertDocsMention()
        return true
      }

      const selectedFolderId = FOLDER_ORDER[mentionActiveIndex]
      if (selectedFolderId) {
        const config = FOLDER_CONFIGS[selectedFolderId]
        resetActiveMentionQuery()
        mentionFolderNav.openFolder(selectedFolderId, config.title)
        setSubmenuQueryStart(getCaretPos())
        ensureFolderLoaded(selectedFolderId)
      }

      return true
    },
    [
      showMentionMenu,
      mentionActiveIndex,
      mentionFolderNav,
      getCaretPos,
      getActiveMentionQueryAtPosition,
      resetActiveMentionQuery,
      setSubmenuQueryStart,
      ensureFolderLoaded,
      insertHandlers,
    ]
  )

  /**
   * Handles arrow left to exit submenus
   */
  const handleArrowLeft = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMentionMenu || e.key !== 'ArrowLeft') return false

      if (isInFolder && mentionFolderNav) {
        e.preventDefault()
        mentionFolderNav.closeFolder()
        setSubmenuQueryStart(null)
        return true
      }

      return false
    },
    [showMentionMenu, isInFolder, mentionFolderNav, setSubmenuQueryStart]
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
      const mainQ = (!isInFolder ? active?.query || '' : '').toLowerCase()
      const showAggregatedView = mainQ.length > 0

      if (showAggregatedView && !isInFolder) {
        const aggregated = buildAggregatedList(mainQ)
        const idx = Math.max(0, Math.min(submenuActiveIndex, aggregated.length - 1))
        const chosen = aggregated[idx]
        if (chosen) {
          if (chosen.type === 'docs') {
            insertHandlers.insertDocsMention()
          } else {
            const handler = insertHandlerMap[chosen.type]
            handler(chosen.value)
          }
        }
        return true
      }

      if (isInFolder && currentFolder && FOLDER_CONFIGS[currentFolder as MentionFolderId]) {
        const folderId = currentFolder as MentionFolderId
        const q = getSubmenuQuery().toLowerCase()
        const filtered = filterFolderItems(folderId, q)
        if (filtered.length > 0) {
          const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
          const handler = insertHandlerMap[folderId]
          handler(chosen)
          setSubmenuQueryStart(null)
        }
        return true
      }

      const isDocsSelected = mentionActiveIndex === FOLDER_ORDER.length
      if (isDocsSelected) {
        resetActiveMentionQuery()
        insertHandlers.insertDocsMention()
        return true
      }

      const selectedFolderId = FOLDER_ORDER[mentionActiveIndex]
      if (selectedFolderId && mentionFolderNav) {
        const config = FOLDER_CONFIGS[selectedFolderId]
        resetActiveMentionQuery()
        mentionFolderNav.openFolder(selectedFolderId, config.title)
        setSubmenuActiveIndex(0)
        setSubmenuQueryStart(getCaretPos())
        ensureFolderLoaded(selectedFolderId)
      }

      return true
    },
    [
      showMentionMenu,
      isInFolder,
      currentFolder,
      mentionActiveIndex,
      submenuActiveIndex,
      mentionFolderNav,
      buildAggregatedList,
      filterFolderItems,
      insertHandlerMap,
      getCaretPos,
      getActiveMentionQueryAtPosition,
      getSubmenuQuery,
      resetActiveMentionQuery,
      setSubmenuActiveIndex,
      setSubmenuQueryStart,
      ensureFolderLoaded,
      insertHandlers,
    ]
  )

  return {
    handleArrowNavigation,
    handleArrowRight,
    handleArrowLeft,
    handleEnterSelection,
  }
}
