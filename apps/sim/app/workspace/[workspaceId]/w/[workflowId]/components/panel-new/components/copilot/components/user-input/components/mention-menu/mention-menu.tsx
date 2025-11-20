'use client'

import { useMemo } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverBackButton,
  PopoverContent,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
} from '@/components/emcn'
import type { useMentionData } from '../../hooks/use-mention-data'
import type { useMentionMenu } from '../../hooks/use-mention-menu'
import { formatTimestamp } from '../../utils'

/**
 * Common text styling for loading and empty states
 */
const STATE_TEXT_CLASSES = 'px-[8px] py-[8px] text-[#868686] text-[12px] dark:text-[#868686]'

/**
 * Loading state component for mention folders
 */
const LoadingState = () => <div className={STATE_TEXT_CLASSES}>Loading...</div>

/**
 * Empty state component for mention folders
 */
const EmptyState = ({ message }: { message: string }) => (
  <div className={STATE_TEXT_CLASSES}>{message}</div>
)

/**
 * Aggregated item type for filtered results
 */
interface AggregatedItem {
  id: string
  label: string
  category:
    | 'chats'
    | 'workflows'
    | 'knowledge'
    | 'blocks'
    | 'workflow-blocks'
    | 'templates'
    | 'logs'
    | 'docs'
  data: any
  icon?: React.ReactNode
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
}

/**
 * MentionMenu component for mention menu dropdown.
 * Handles rendering of mention options, submenus, and aggregated search results.
 * Manages keyboard navigation and selection of mentions.
 *
 * @param props - Component props
 * @returns Rendered mention menu
 */
export function MentionMenu({
  mentionMenu,
  mentionData,
  message,
  insertHandlers,
}: MentionMenuProps) {
  const {
    mentionMenuRef,
    menuListRef,
    getActiveMentionQueryAtPosition,
    getCaretPos,
    submenuActiveIndex,
    mentionActiveIndex,
    openSubmenuFor,
  } = mentionMenu

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
   * Get the current query string after @
   */
  const currentQuery = useMemo(() => {
    const caretPos = getCaretPos()
    const active = getActiveMentionQueryAtPosition(caretPos, message)
    return active?.query.trim().toLowerCase() || ''
  }, [message, getCaretPos, getActiveMentionQueryAtPosition])

  /**
   * Collect and filter all available items based on query
   */
  const filteredAggregatedItems = useMemo(() => {
    if (!currentQuery) return []

    const items: AggregatedItem[] = []

    // Chats
    mentionData.pastChats.forEach((chat) => {
      const label = chat.title || 'New Chat'
      if (label.toLowerCase().includes(currentQuery)) {
        items.push({
          id: `chat-${chat.id}`,
          label,
          category: 'chats',
          data: chat,
        })
      }
    })

    // Workflows
    mentionData.workflows.forEach((wf) => {
      const label = wf.name || 'Untitled Workflow'
      if (label.toLowerCase().includes(currentQuery)) {
        items.push({
          id: `workflow-${wf.id}`,
          label,
          category: 'workflows',
          data: wf,
          icon: (
            <div
              className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
              style={{ backgroundColor: wf.color || '#3972F6' }}
            />
          ),
        })
      }
    })

    // Knowledge bases
    mentionData.knowledgeBases.forEach((kb) => {
      const label = kb.name || 'Untitled'
      if (label.toLowerCase().includes(currentQuery)) {
        items.push({
          id: `knowledge-${kb.id}`,
          label,
          category: 'knowledge',
          data: kb,
        })
      }
    })

    // Blocks
    mentionData.blocksList.forEach((blk) => {
      const label = blk.name || blk.id
      if (label.toLowerCase().includes(currentQuery)) {
        const Icon = blk.iconComponent
        items.push({
          id: `block-${blk.id}`,
          label,
          category: 'blocks',
          data: blk,
          icon: (
            <div
              className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
              style={{ backgroundColor: blk.bgColor || '#6B7280' }}
            >
              {Icon && <Icon className='!h-[10px] !w-[10px] text-white' />}
            </div>
          ),
        })
      }
    })

    // Workflow blocks
    mentionData.workflowBlocks.forEach((blk) => {
      const label = blk.name || blk.id
      if (label.toLowerCase().includes(currentQuery)) {
        const Icon = blk.iconComponent
        items.push({
          id: `workflow-block-${blk.id}`,
          label,
          category: 'workflow-blocks',
          data: blk,
          icon: (
            <div
              className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
              style={{ backgroundColor: blk.bgColor || '#6B7280' }}
            >
              {Icon && <Icon className='!h-[10px] !w-[10px] text-white' />}
            </div>
          ),
        })
      }
    })

    // Templates
    mentionData.templatesList.forEach((tpl) => {
      const label = tpl.name
      if (label.toLowerCase().includes(currentQuery)) {
        items.push({
          id: `template-${tpl.id}`,
          label,
          category: 'templates',
          data: tpl,
        })
      }
    })

    // Logs
    mentionData.logsList.forEach((log) => {
      const label = log.workflowName
      if (label.toLowerCase().includes(currentQuery)) {
        items.push({
          id: `log-${log.id}`,
          label,
          category: 'logs',
          data: log,
        })
      }
    })

    // Docs
    if ('docs'.includes(currentQuery)) {
      items.push({
        id: 'docs',
        label: 'Docs',
        category: 'docs',
        data: null,
      })
    }

    return items
  }, [currentQuery, mentionData])

  /**
   * Handle click on aggregated item
   */
  const handleAggregatedItemClick = (item: AggregatedItem) => {
    switch (item.category) {
      case 'chats':
        insertPastChatMention(item.data)
        break
      case 'workflows':
        insertWorkflowMention(item.data)
        break
      case 'knowledge':
        insertKnowledgeMention(item.data)
        break
      case 'blocks':
        insertBlockMention(item.data)
        break
      case 'workflow-blocks':
        insertWorkflowBlockMention(item.data)
        break
      case 'templates':
        insertTemplateMention(item.data)
        break
      case 'logs':
        insertLogMention(item.data)
        break
      case 'docs':
        insertDocsMention()
        break
    }
  }

  // Open state derived directly from mention menu
  const open = !!mentionMenu.showMentionMenu

  // Show filtered aggregated view when there's a query
  const showAggregatedView = currentQuery.length > 0

  // Folder order for keyboard navigation - matches render order
  const FOLDER_ORDER = [
    'Chats', // 0
    'Workflows', // 1
    'Knowledge', // 2
    'Blocks', // 3
    'Workflow Blocks', // 4
    'Templates', // 5
    'Logs', // 6
    'Docs', // 7
  ] as const

  // Get active folder based on navigation when not in submenu and no query
  const isInFolderNavigationMode = !openSubmenuFor && !showAggregatedView

  // Compute caret viewport position via mirror technique for precise anchoring
  const textareaEl = mentionMenu.textareaRef.current
  if (!textareaEl) return null

  const getCaretViewport = (textarea: HTMLTextAreaElement, caretPosition: number, text: string) => {
    const textareaRect = textarea.getBoundingClientRect()
    const style = window.getComputedStyle(textarea)

    const mirrorDiv = document.createElement('div')
    mirrorDiv.style.position = 'absolute'
    mirrorDiv.style.visibility = 'hidden'
    mirrorDiv.style.whiteSpace = 'pre-wrap'
    mirrorDiv.style.wordWrap = 'break-word'
    mirrorDiv.style.font = style.font
    mirrorDiv.style.padding = style.padding
    mirrorDiv.style.border = style.border
    mirrorDiv.style.width = style.width
    mirrorDiv.style.lineHeight = style.lineHeight
    mirrorDiv.style.boxSizing = style.boxSizing
    mirrorDiv.style.letterSpacing = style.letterSpacing
    mirrorDiv.style.textTransform = style.textTransform
    mirrorDiv.style.textIndent = style.textIndent
    mirrorDiv.style.textAlign = style.textAlign

    mirrorDiv.textContent = text.substring(0, caretPosition)

    const caretMarker = document.createElement('span')
    caretMarker.style.display = 'inline-block'
    caretMarker.style.width = '0px'
    caretMarker.style.padding = '0'
    caretMarker.style.border = '0'
    mirrorDiv.appendChild(caretMarker)

    document.body.appendChild(mirrorDiv)
    const markerRect = caretMarker.getBoundingClientRect()
    const mirrorRect = mirrorDiv.getBoundingClientRect()
    document.body.removeChild(mirrorDiv)

    const leftOffset = markerRect.left - mirrorRect.left - textarea.scrollLeft
    const topOffset = markerRect.top - mirrorRect.top - textarea.scrollTop

    return {
      left: textareaRect.left + leftOffset,
      top: textareaRect.top + topOffset,
    }
  }

  const caretPos = getCaretPos()
  const caretViewport = getCaretViewport(textareaEl, caretPos, message)

  // Decide preferred side based on available space
  const margin = 8
  const spaceAbove = caretViewport.top - margin
  const spaceBelow = window.innerHeight - caretViewport.top - margin
  const side: 'top' | 'bottom' = spaceBelow >= spaceAbove ? 'bottom' : 'top'

  return (
    <Popover
      open={open}
      onOpenChange={() => {
        /* controlled by mentionMenu */
      }}
    >
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
        style={{
          width: `224px`,
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverBackButton />
        <PopoverScrollArea ref={menuListRef} className='space-y-[2px]'>
          {openSubmenuFor ? (
            // Submenu view - showing contents of a specific folder
            <>
              {openSubmenuFor === 'Chats' && (
                <>
                  {mentionData.isLoadingPastChats ? (
                    <LoadingState />
                  ) : mentionData.pastChats.length === 0 ? (
                    <EmptyState message='No past chats' />
                  ) : (
                    mentionData.pastChats.map((chat, index) => (
                      <PopoverItem
                        key={chat.id}
                        onClick={() => insertPastChatMention(chat)}
                        data-idx={index}
                        active={index === submenuActiveIndex}
                      >
                        <span className='truncate'>{chat.title || 'New Chat'}</span>
                      </PopoverItem>
                    ))
                  )}
                </>
              )}
              {openSubmenuFor === 'Workflows' && (
                <>
                  {mentionData.isLoadingWorkflows ? (
                    <LoadingState />
                  ) : mentionData.workflows.length === 0 ? (
                    <EmptyState message='No workflows' />
                  ) : (
                    mentionData.workflows.map((wf, index) => (
                      <PopoverItem
                        key={wf.id}
                        onClick={() => insertWorkflowMention(wf)}
                        data-idx={index}
                        active={index === submenuActiveIndex}
                      >
                        <div
                          className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                          style={{ backgroundColor: wf.color || '#3972F6' }}
                        />
                        <span className='truncate'>{wf.name || 'Untitled Workflow'}</span>
                      </PopoverItem>
                    ))
                  )}
                </>
              )}
              {openSubmenuFor === 'Knowledge' && (
                <>
                  {mentionData.isLoadingKnowledge ? (
                    <LoadingState />
                  ) : mentionData.knowledgeBases.length === 0 ? (
                    <EmptyState message='No knowledge bases' />
                  ) : (
                    mentionData.knowledgeBases.map((kb, index) => (
                      <PopoverItem
                        key={kb.id}
                        onClick={() => insertKnowledgeMention(kb)}
                        data-idx={index}
                        active={index === submenuActiveIndex}
                      >
                        <span className='truncate'>{kb.name || 'Untitled'}</span>
                      </PopoverItem>
                    ))
                  )}
                </>
              )}
              {openSubmenuFor === 'Blocks' && (
                <>
                  {mentionData.isLoadingBlocks ? (
                    <LoadingState />
                  ) : mentionData.blocksList.length === 0 ? (
                    <EmptyState message='No blocks found' />
                  ) : (
                    mentionData.blocksList.map((blk, index) => {
                      const Icon = blk.iconComponent
                      return (
                        <PopoverItem
                          key={blk.id}
                          onClick={() => insertBlockMention(blk)}
                          data-idx={index}
                          active={index === submenuActiveIndex}
                        >
                          <div
                            className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                            style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                          >
                            {Icon && <Icon className='!h-[10px] !w-[10px] text-white' />}
                          </div>
                          <span className='truncate'>{blk.name || blk.id}</span>
                        </PopoverItem>
                      )
                    })
                  )}
                </>
              )}
              {openSubmenuFor === 'Workflow Blocks' && (
                <>
                  {mentionData.isLoadingWorkflowBlocks ? (
                    <LoadingState />
                  ) : mentionData.workflowBlocks.length === 0 ? (
                    <EmptyState message='No blocks in this workflow' />
                  ) : (
                    mentionData.workflowBlocks.map((blk, index) => {
                      const Icon = blk.iconComponent
                      return (
                        <PopoverItem
                          key={blk.id}
                          onClick={() => insertWorkflowBlockMention(blk)}
                          data-idx={index}
                          active={index === submenuActiveIndex}
                        >
                          <div
                            className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                            style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                          >
                            {Icon && <Icon className='!h-[10px] !w-[10px] text-white' />}
                          </div>
                          <span className='truncate'>{blk.name || blk.id}</span>
                        </PopoverItem>
                      )
                    })
                  )}
                </>
              )}
              {openSubmenuFor === 'Templates' && (
                <>
                  {mentionData.isLoadingTemplates ? (
                    <LoadingState />
                  ) : mentionData.templatesList.length === 0 ? (
                    <EmptyState message='No templates found' />
                  ) : (
                    mentionData.templatesList.map((tpl, index) => (
                      <PopoverItem
                        key={tpl.id}
                        onClick={() => insertTemplateMention(tpl)}
                        data-idx={index}
                        active={index === submenuActiveIndex}
                      >
                        <span className='flex-1 truncate'>{tpl.name}</span>
                        <span className='text-[#868686] text-[10px] dark:text-[#868686]'>
                          {tpl.stars}
                        </span>
                      </PopoverItem>
                    ))
                  )}
                </>
              )}
              {openSubmenuFor === 'Logs' && (
                <>
                  {mentionData.isLoadingLogs ? (
                    <LoadingState />
                  ) : mentionData.logsList.length === 0 ? (
                    <EmptyState message='No executions found' />
                  ) : (
                    mentionData.logsList.map((log, index) => (
                      <PopoverItem
                        key={log.id}
                        onClick={() => insertLogMention(log)}
                        data-idx={index}
                        active={index === submenuActiveIndex}
                      >
                        <span className='min-w-0 flex-1 truncate'>{log.workflowName}</span>
                        <span className='text-[#AEAEAE] text-[10px] dark:text-[#AEAEAE]'>·</span>
                        <span className='whitespace-nowrap text-[10px]'>
                          {formatTimestamp(log.createdAt)}
                        </span>
                        <span className='text-[#AEAEAE] text-[10px] dark:text-[#AEAEAE]'>·</span>
                        <span className='text-[10px] capitalize'>
                          {(log.trigger || 'manual').toLowerCase()}
                        </span>
                      </PopoverItem>
                    ))
                  )}
                </>
              )}
            </>
          ) : showAggregatedView ? (
            // Aggregated filtered view
            <>
              {filteredAggregatedItems.length === 0 ? (
                <EmptyState message='No results found' />
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
                        <span className='text-[10px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                          ·
                        </span>
                        <span className='whitespace-nowrap text-[10px]'>
                          {formatTimestamp(item.data.createdAt)}
                        </span>
                      </>
                    )}
                  </PopoverItem>
                ))
              )}
            </>
          ) : (
            // Folder navigation view
            <>
              <PopoverFolder
                id='chats'
                title='Chats'
                onOpen={() => mentionData.ensurePastChatsLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 0}
                data-idx={0}
              >
                {mentionData.isLoadingPastChats ? (
                  <LoadingState />
                ) : mentionData.pastChats.length === 0 ? (
                  <EmptyState message='No past chats' />
                ) : (
                  mentionData.pastChats.map((chat) => (
                    <PopoverItem key={chat.id} onClick={() => insertPastChatMention(chat)}>
                      <span className='truncate'>{chat.title || 'New Chat'}</span>
                    </PopoverItem>
                  ))
                )}
              </PopoverFolder>

              <PopoverFolder
                id='workflows'
                title='All workflows'
                onOpen={() => mentionData.ensureWorkflowsLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 1}
                data-idx={1}
              >
                {mentionData.isLoadingWorkflows ? (
                  <LoadingState />
                ) : mentionData.workflows.length === 0 ? (
                  <EmptyState message='No workflows' />
                ) : (
                  mentionData.workflows.map((wf) => (
                    <PopoverItem key={wf.id} onClick={() => insertWorkflowMention(wf)}>
                      <div
                        className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                        style={{ backgroundColor: wf.color || '#3972F6' }}
                      />
                      <span className='truncate'>{wf.name || 'Untitled Workflow'}</span>
                    </PopoverItem>
                  ))
                )}
              </PopoverFolder>

              <PopoverFolder
                id='knowledge'
                title='Knowledge Bases'
                onOpen={() => mentionData.ensureKnowledgeLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 2}
                data-idx={2}
              >
                {mentionData.isLoadingKnowledge ? (
                  <LoadingState />
                ) : mentionData.knowledgeBases.length === 0 ? (
                  <EmptyState message='No knowledge bases' />
                ) : (
                  mentionData.knowledgeBases.map((kb) => (
                    <PopoverItem key={kb.id} onClick={() => insertKnowledgeMention(kb)}>
                      <span className='truncate'>{kb.name || 'Untitled'}</span>
                    </PopoverItem>
                  ))
                )}
              </PopoverFolder>

              <PopoverFolder
                id='blocks'
                title='Blocks'
                onOpen={() => mentionData.ensureBlocksLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 3}
                data-idx={3}
              >
                {mentionData.isLoadingBlocks ? (
                  <LoadingState />
                ) : mentionData.blocksList.length === 0 ? (
                  <EmptyState message='No blocks found' />
                ) : (
                  mentionData.blocksList.map((blk) => {
                    const Icon = blk.iconComponent
                    return (
                      <PopoverItem key={blk.id} onClick={() => insertBlockMention(blk)}>
                        <div
                          className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                          style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                        >
                          {Icon && <Icon className='!h-[10px] !w-[10px] text-white' />}
                        </div>
                        <span className='truncate'>{blk.name || blk.id}</span>
                      </PopoverItem>
                    )
                  })
                )}
              </PopoverFolder>

              <PopoverFolder
                id='workflow-blocks'
                title='Workflow Blocks'
                onOpen={() => mentionData.ensureWorkflowBlocksLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 4}
                data-idx={4}
              >
                {mentionData.isLoadingWorkflowBlocks ? (
                  <LoadingState />
                ) : mentionData.workflowBlocks.length === 0 ? (
                  <EmptyState message='No blocks in this workflow' />
                ) : (
                  mentionData.workflowBlocks.map((blk) => {
                    const Icon = blk.iconComponent
                    return (
                      <PopoverItem key={blk.id} onClick={() => insertWorkflowBlockMention(blk)}>
                        <div
                          className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                          style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                        >
                          {Icon && <Icon className='!h-[10px] !w-[10px] text-white' />}
                        </div>
                        <span className='truncate'>{blk.name || blk.id}</span>
                      </PopoverItem>
                    )
                  })
                )}
              </PopoverFolder>

              <PopoverFolder
                id='templates'
                title='Templates'
                onOpen={() => mentionData.ensureTemplatesLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 5}
                data-idx={5}
              >
                {mentionData.isLoadingTemplates ? (
                  <LoadingState />
                ) : mentionData.templatesList.length === 0 ? (
                  <EmptyState message='No templates found' />
                ) : (
                  mentionData.templatesList.map((tpl) => (
                    <PopoverItem key={tpl.id} onClick={() => insertTemplateMention(tpl)}>
                      <span className='flex-1 truncate'>{tpl.name}</span>
                      <span className='text-[#868686] text-[10px] dark:text-[#868686]'>
                        {tpl.stars}
                      </span>
                    </PopoverItem>
                  ))
                )}
              </PopoverFolder>

              <PopoverFolder
                id='logs'
                title='Logs'
                onOpen={() => mentionData.ensureLogsLoaded()}
                active={isInFolderNavigationMode && mentionActiveIndex === 6}
                data-idx={6}
              >
                {mentionData.isLoadingLogs ? (
                  <LoadingState />
                ) : mentionData.logsList.length === 0 ? (
                  <EmptyState message='No executions found' />
                ) : (
                  mentionData.logsList.map((log) => (
                    <PopoverItem key={log.id} onClick={() => insertLogMention(log)}>
                      <span className='min-w-0 flex-1 truncate'>{log.workflowName}</span>
                      <span className='text-[10px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                        ·
                      </span>
                      <span className='whitespace-nowrap text-[10px]'>
                        {formatTimestamp(log.createdAt)}
                      </span>
                      <span className='text-[10px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                        ·
                      </span>
                      <span className='text-[10px] capitalize'>
                        {(log.trigger || 'manual').toLowerCase()}
                      </span>
                    </PopoverItem>
                  ))
                )}
              </PopoverFolder>

              <PopoverItem
                rootOnly
                onClick={() => insertDocsMention()}
                active={isInFolderNavigationMode && mentionActiveIndex === 7}
                data-idx={7}
              >
                <span>Docs</span>
              </PopoverItem>
            </>
          )}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
