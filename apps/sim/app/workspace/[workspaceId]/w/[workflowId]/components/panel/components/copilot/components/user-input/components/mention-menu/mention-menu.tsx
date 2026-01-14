'use client'

import { useCallback, useEffect, useMemo } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverBackButton,
  PopoverContent,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
  usePopoverContext,
} from '@/components/emcn'
import { formatCompactTimestamp } from '@/lib/core/utils/formatting'
import {
  FOLDER_CONFIGS,
  FOLDER_ORDER,
  MENU_STATE_TEXT_CLASSES,
  type MentionCategory,
  type MentionFolderId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import {
  useCaretViewport,
  type useMentionData,
  type useMentionMenu,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import {
  getFolderData as getFolderDataUtil,
  getFolderEnsureLoaded as getFolderEnsureLoadedUtil,
  getFolderLoading as getFolderLoadingUtil,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { FolderContent, FolderPreviewContent, renderItemIcon } from './folder-content'

interface AggregatedItem {
  id: string
  label: string
  category: MentionCategory
  data: any
  icon?: React.ReactNode
}

export interface MentionFolderNav {
  isInFolder: boolean
  currentFolder: string | null
  openFolder: (id: string, title: string) => void
  closeFolder: () => void
}

interface MentionMenuProps {
  mentionMenu: ReturnType<typeof useMentionMenu>
  mentionData: ReturnType<typeof useMentionData>
  message: string
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
  onFolderNavChange?: (nav: MentionFolderNav) => void
}

type InsertHandlerMap = Record<MentionFolderId, (item: any) => void>

function MentionMenuContent({
  mentionMenu,
  mentionData,
  message,
  insertHandlers,
  onFolderNavChange,
}: MentionMenuProps) {
  const { currentFolder, openFolder, closeFolder } = usePopoverContext()

  const {
    menuListRef,
    getActiveMentionQueryAtPosition,
    getCaretPos,
    submenuActiveIndex,
    mentionActiveIndex,
    setSubmenuActiveIndex,
  } = mentionMenu

  const currentQuery = useMemo(() => {
    const caretPos = getCaretPos()
    const active = getActiveMentionQueryAtPosition(caretPos, message)
    return active?.query.trim().toLowerCase() || ''
  }, [message, getCaretPos, getActiveMentionQueryAtPosition])

  const isInFolder = currentFolder !== null
  const showAggregatedView = currentQuery.length > 0
  const isInFolderNavigationMode = !isInFolder && !showAggregatedView

  useEffect(() => {
    setSubmenuActiveIndex(0)
  }, [isInFolder, setSubmenuActiveIndex])

  useEffect(() => {
    if (onFolderNavChange) {
      onFolderNavChange({
        isInFolder,
        currentFolder,
        openFolder,
        closeFolder,
      })
    }
  }, [onFolderNavChange, isInFolder, currentFolder, openFolder, closeFolder])

  const insertHandlerMap = useMemo(
    (): InsertHandlerMap => ({
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

  const getFolderData = useCallback(
    (folderId: MentionFolderId) => getFolderDataUtil(mentionData, folderId),
    [mentionData]
  )

  const getFolderLoading = useCallback(
    (folderId: MentionFolderId) => getFolderLoadingUtil(mentionData, folderId),
    [mentionData]
  )

  const getEnsureLoaded = useCallback(
    (folderId: MentionFolderId) => getFolderEnsureLoadedUtil(mentionData, folderId),
    [mentionData]
  )

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

  const getFilteredFolderItems = useCallback(
    (folderId: MentionFolderId): any[] => {
      return isInFolder ? filterFolderItems(folderId, currentQuery) : getFolderData(folderId)
    },
    [isInFolder, currentQuery, filterFolderItems, getFolderData]
  )

  const filteredAggregatedItems = useMemo(() => {
    if (!currentQuery) return []

    const items: AggregatedItem[] = []
    const q = currentQuery.toLowerCase()

    for (const folderId of FOLDER_ORDER) {
      const config = FOLDER_CONFIGS[folderId]
      const folderData = getFolderData(folderId)

      folderData.forEach((item) => {
        if (config.filterFn(item, q)) {
          items.push({
            id: `${folderId}-${config.getId(item)}`,
            label: config.getLabel(item),
            category: folderId as MentionCategory,
            data: item,
            icon: renderItemIcon(folderId, item),
          })
        }
      })
    }

    if ('docs'.includes(q)) {
      items.push({
        id: 'docs',
        label: 'Docs',
        category: 'docs',
        data: null,
      })
    }

    return items
  }, [currentQuery, getFolderData])

  const handleAggregatedItemClick = useCallback(
    (item: AggregatedItem) => {
      if (item.category === 'docs') {
        insertHandlers.insertDocsMention()
        return
      }
      const handler = insertHandlerMap[item.category as MentionFolderId]
      if (handler) {
        handler(item.data)
      }
    },
    [insertHandlerMap, insertHandlers]
  )

  return (
    <PopoverScrollArea ref={menuListRef} className='space-y-[2px]'>
      {isInFolder ? (
        <FolderContent
          folderId={currentFolder as MentionFolderId}
          items={getFilteredFolderItems(currentFolder as MentionFolderId)}
          isLoading={getFolderLoading(currentFolder as MentionFolderId)}
          currentQuery={currentQuery}
          activeIndex={submenuActiveIndex}
          onItemClick={insertHandlerMap[currentFolder as MentionFolderId]}
        />
      ) : showAggregatedView ? (
        <>
          {filteredAggregatedItems.length === 0 ? (
            <div className={MENU_STATE_TEXT_CLASSES}>No results found</div>
          ) : (
            filteredAggregatedItems.map((item, index) => (
              <PopoverItem
                key={item.id}
                onClick={() => handleAggregatedItemClick(item)}
                data-idx={index}
                active={index === submenuActiveIndex}
              >
                {item.icon}
                <span className='flex-1 truncate'>{item.label}</span>
                {item.category === 'logs' && (
                  <>
                    <span className='text-[10px] text-[var(--text-tertiary)]'>·</span>
                    <span className='whitespace-nowrap text-[10px]'>
                      {formatCompactTimestamp(item.data.createdAt)}
                    </span>
                  </>
                )}
              </PopoverItem>
            ))
          )}
        </>
      ) : (
        <>
          {FOLDER_ORDER.map((folderId, folderIndex) => {
            const config = FOLDER_CONFIGS[folderId]
            const ensureLoaded = getEnsureLoaded(folderId)

            return (
              <PopoverFolder
                key={folderId}
                id={folderId}
                title={config.title}
                onOpen={() => ensureLoaded?.()}
                active={isInFolderNavigationMode && mentionActiveIndex === folderIndex}
                data-idx={folderIndex}
              >
                <FolderPreviewContent
                  folderId={folderId}
                  items={getFolderData(folderId)}
                  isLoading={getFolderLoading(folderId)}
                  onItemClick={insertHandlerMap[folderId]}
                />
              </PopoverFolder>
            )
          })}

          <PopoverItem
            rootOnly
            onClick={() => insertHandlers.insertDocsMention()}
            active={isInFolderNavigationMode && mentionActiveIndex === FOLDER_ORDER.length}
            data-idx={FOLDER_ORDER.length}
          >
            <span>Docs</span>
          </PopoverItem>
        </>
      )}
    </PopoverScrollArea>
  )
}

export function MentionMenu({
  mentionMenu,
  mentionData,
  message,
  insertHandlers,
  onFolderNavChange,
}: MentionMenuProps) {
  const { mentionMenuRef, textareaRef, getCaretPos } = mentionMenu

  const caretPos = getCaretPos()
  const { caretViewport, side } = useCaretViewport({ textareaRef, message, caretPos })

  if (!caretViewport) return null

  return (
    <Popover open={true} onOpenChange={() => {}}>
      <PopoverAnchor asChild>
        <div
          style={{
            position: 'fixed',
            top: `${caretViewport.top}px`,
            left: `${caretViewport.left}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        ref={mentionMenuRef}
        side={side}
        align='start'
        collisionPadding={6}
        maxHeight={360}
        className='pointer-events-auto'
        style={{ width: '224px' }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
      >
        <PopoverBackButton />
        <MentionMenuContent
          mentionMenu={mentionMenu}
          mentionData={mentionData}
          message={message}
          insertHandlers={insertHandlers}
          onFolderNavChange={onFolderNavChange}
        />
      </PopoverContent>
    </Popover>
  )
}
