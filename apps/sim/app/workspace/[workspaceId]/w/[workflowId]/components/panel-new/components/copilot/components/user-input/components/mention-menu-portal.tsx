'use client'

import {
  Blocks,
  BookOpen,
  Bot,
  Box,
  Check,
  ChevronRight,
  LibraryBig,
  Shapes,
  SquareChevronRight,
  Workflow,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatContext } from '@/stores/panel-new/copilot/types'
import { MENTION_OPTIONS } from '../constants'
import type { useMentionData } from '../hooks/use-mention-data'
import type { useMentionMenu } from '../hooks/use-mention-menu'

interface MentionMenuPortalProps {
  mentionMenu: ReturnType<typeof useMentionMenu>
  mentionData: ReturnType<typeof useMentionData>
  selectedContexts: ChatContext[]
  onContextSelect: (context: ChatContext) => void
  onMessageChange: (message: string) => void
  message: string
  workflowId?: string | null
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
 * Formats timestamp to MM-DD HH:MM format
 */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${min}`
  } catch {
    return iso
  }
}

/**
 * Portal component for mention menu dropdown.
 * Handles rendering of mention options, submenus, and aggregated search results.
 * Manages keyboard navigation and selection of mentions.
 *
 * @param props - Component props
 * @returns Rendered mention menu portal
 */
export function MentionMenuPortal({
  mentionMenu,
  mentionData,
  selectedContexts,
  onContextSelect,
  onMessageChange,
  message,
  workflowId,
  insertHandlers,
}: MentionMenuPortalProps) {
  const {
    mentionMenuRef,
    mentionPortalRef,
    menuListRef,
    mentionPortalStyle,
    openSubmenuFor,
    mentionActiveIndex,
    submenuActiveIndex,
    inAggregated,
    setSubmenuActiveIndex,
    setMentionActiveIndex,
    setInAggregated,
    setOpenSubmenuFor,
    setSubmenuQueryStart,
    getCaretPos,
    getActiveMentionQueryAtPosition,
    getSubmenuQuery,
    resetActiveMentionQuery,
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

  if (!mentionPortalStyle) return null

  return (
    <div
      ref={mentionPortalRef}
      style={{
        position: 'fixed',
        top: mentionPortalStyle.top,
        left: mentionPortalStyle.left,
        width: mentionPortalStyle.width,
        maxHeight: mentionPortalStyle.maxHeight,
        zIndex: 9999999,
        pointerEvents: 'auto',
        isolation: 'isolate',
        transform: mentionPortalStyle.showBelow ? 'none' : 'translateY(-100%)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={mentionMenuRef}
        className='flex flex-col overflow-hidden rounded-[8px] border bg-popover p-1 text-foreground shadow-md'
        style={{
          maxHeight: mentionPortalStyle.maxHeight,
          height: '100%',
          position: 'relative',
          zIndex: 9999999,
        }}
      >
        {openSubmenuFor ? (
          /* Submenu View */
          <>
            <div className='px-2 py-1.5 text-muted-foreground text-xs'>
              {openSubmenuFor === 'Chats'
                ? 'Chats'
                : openSubmenuFor === 'Workflows'
                  ? 'All workflows'
                  : openSubmenuFor === 'Knowledge'
                    ? 'Knowledge Bases'
                    : openSubmenuFor === 'Blocks'
                      ? 'Blocks'
                      : openSubmenuFor === 'Workflow Blocks'
                        ? 'Workflow Blocks'
                        : openSubmenuFor === 'Templates'
                          ? 'Templates'
                          : 'Logs'}
            </div>
            <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
              {openSubmenuFor === 'Chats' && (
                <>
                  {mentionData.isLoadingPastChats ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.pastChats.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>No past chats</div>
                  ) : (
                    mentionData.pastChats
                      .filter((c) =>
                        (c.title || 'Untitled Chat')
                          .toLowerCase()
                          .includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((chat, idx) => (
                        <div
                          key={chat.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertPastChatMention(chat)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                            <Bot className='h-3.5 w-3.5 text-muted-foreground' strokeWidth={1.5} />
                          </div>
                          <span className='truncate'>{chat.title || 'Untitled Chat'}</span>
                        </div>
                      ))
                  )}
                </>
              )}

              {openSubmenuFor === 'Workflows' && (
                <>
                  {mentionData.isLoadingWorkflows ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.workflows.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>No workflows</div>
                  ) : (
                    mentionData.workflows
                      .filter((w) =>
                        (w.name || 'Untitled Workflow')
                          .toLowerCase()
                          .includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((wf, idx) => (
                        <div
                          key={wf.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertWorkflowMention(wf)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          <div
                            className='h-3.5 w-3.5 flex-shrink-0 rounded'
                            style={{ backgroundColor: wf.color || '#3972F6' }}
                          />
                          <span className='truncate'>{wf.name || 'Untitled Workflow'}</span>
                        </div>
                      ))
                  )}
                </>
              )}

              {openSubmenuFor === 'Knowledge' && (
                <>
                  {mentionData.isLoadingKnowledge ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.knowledgeBases.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>
                      No knowledge bases
                    </div>
                  ) : (
                    mentionData.knowledgeBases
                      .filter((k) =>
                        (k.name || 'Untitled')
                          .toLowerCase()
                          .includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((kb, idx) => (
                        <div
                          key={kb.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertKnowledgeMention(kb)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                          <span className='truncate'>{kb.name || 'Untitled'}</span>
                        </div>
                      ))
                  )}
                </>
              )}

              {openSubmenuFor === 'Blocks' && (
                <>
                  {mentionData.isLoadingBlocks ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.blocksList.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>No blocks found</div>
                  ) : (
                    mentionData.blocksList
                      .filter((b) =>
                        (b.name || b.id).toLowerCase().includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((blk, idx) => (
                        <div
                          key={blk.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertBlockMention(blk)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          <div
                            className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                            style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                          >
                            {blk.iconComponent && (
                              <blk.iconComponent className='!h-3 !w-3 text-white' />
                            )}
                          </div>
                          <span className='truncate'>{blk.name || blk.id}</span>
                        </div>
                      ))
                  )}
                </>
              )}

              {openSubmenuFor === 'Workflow Blocks' && (
                <>
                  {mentionData.isLoadingWorkflowBlocks ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.workflowBlocks.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>
                      No blocks in this workflow
                    </div>
                  ) : (
                    mentionData.workflowBlocks
                      .filter((b) =>
                        (b.name || b.id).toLowerCase().includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((blk, idx) => (
                        <div
                          key={blk.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertWorkflowBlockMention(blk)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          <div
                            className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                            style={{ backgroundColor: blk.bgColor || '#6B7280' }}
                          >
                            {blk.iconComponent && (
                              <blk.iconComponent className='!h-3 !w-3 text-white' />
                            )}
                          </div>
                          <span className='truncate'>{blk.name || blk.id}</span>
                        </div>
                      ))
                  )}
                </>
              )}

              {openSubmenuFor === 'Templates' && (
                <>
                  {mentionData.isLoadingTemplates ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.templatesList.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>
                      No templates found
                    </div>
                  ) : (
                    mentionData.templatesList
                      .filter((t) =>
                        (t.name || 'Untitled Template')
                          .toLowerCase()
                          .includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((tpl, idx) => (
                        <div
                          key={tpl.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertTemplateMention(tpl)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          <div className='flex h-4 w-4 items-center justify-center'>★</div>
                          <span className='truncate'>{tpl.name}</span>
                          <span className='ml-auto text-muted-foreground text-xs'>{tpl.stars}</span>
                        </div>
                      ))
                  )}
                </>
              )}

              {openSubmenuFor === 'Logs' && (
                <>
                  {mentionData.isLoadingLogs ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                  ) : mentionData.logsList.length === 0 ? (
                    <div className='px-2 py-2 text-muted-foreground text-sm'>
                      No executions found
                    </div>
                  ) : (
                    mentionData.logsList
                      .filter((l) =>
                        [l.workflowName, l.trigger || '']
                          .join(' ')
                          .toLowerCase()
                          .includes(getSubmenuQuery().toLowerCase())
                      )
                      .map((log, idx) => (
                        <div
                          key={log.id}
                          data-idx={idx}
                          className={cn(
                            'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            insertLogMention(log)
                            setSubmenuQueryStart(null)
                          }}
                        >
                          {log.level === 'error' ? (
                            <X className='h-4 w-4 text-red-500' />
                          ) : (
                            <Check className='h-4 w-4 text-green-500' />
                          )}
                          <span className='min-w-0 truncate'>{log.workflowName}</span>
                          <span className='text-muted-foreground'>·</span>
                          <span className='whitespace-nowrap'>
                            {formatTimestamp(log.createdAt)}
                          </span>
                          <span className='text-muted-foreground'>·</span>
                          <span className='capitalize'>
                            {(log.trigger || 'manual').toLowerCase()}
                          </span>
                        </div>
                      ))
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          /* Main Menu View */
          <>
            {(() => {
              const q = (getActiveMentionQueryAtPosition(getCaretPos())?.query || '').toLowerCase()
              const filtered = MENTION_OPTIONS.filter((label) => label.toLowerCase().includes(q))

              if (q.length > 0 && filtered.length === 0) {
                // Aggregated search view
                const aggregated = [
                  ...mentionData.workflowBlocks
                    .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                    .map((b) => ({ type: 'Workflow Blocks', id: b.id, value: b })),
                  ...mentionData.workflows
                    .filter((w) => (w.name || 'Untitled Workflow').toLowerCase().includes(q))
                    .map((w) => ({ type: 'Workflows', id: w.id, value: w })),
                  ...mentionData.blocksList
                    .filter((b) => (b.name || b.id).toLowerCase().includes(q))
                    .map((b) => ({ type: 'Blocks', id: b.id, value: b })),
                  ...mentionData.knowledgeBases
                    .filter((k) => (k.name || 'Untitled').toLowerCase().includes(q))
                    .map((k) => ({ type: 'Knowledge', id: k.id, value: k })),
                  ...mentionData.templatesList
                    .filter((t) => (t.name || 'Untitled Template').toLowerCase().includes(q))
                    .map((t) => ({ type: 'Templates', id: t.id, value: t })),
                  ...mentionData.pastChats
                    .filter((c) => (c.title || 'Untitled Chat').toLowerCase().includes(q))
                    .map((c) => ({ type: 'Chats', id: c.id, value: c })),
                  ...mentionData.logsList
                    .filter((l) =>
                      (l.workflowName || 'Untitled Workflow').toLowerCase().includes(q)
                    )
                    .map((l) => ({ type: 'Logs', id: l.id, value: l })),
                ]

                return (
                  <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
                    {aggregated.length === 0 ? (
                      <div className='px-2 py-2 text-muted-foreground text-sm'>No matches</div>
                    ) : (
                      aggregated.map((item, idx) => (
                        <div
                          key={`${item.type}-${item.id}`}
                          data-idx={idx}
                          className={cn(
                            'flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                            submenuActiveIndex === idx && 'bg-muted'
                          )}
                          role='menuitem'
                          aria-selected={submenuActiveIndex === idx}
                          onMouseEnter={() => setSubmenuActiveIndex(idx)}
                          onClick={() => {
                            if (item.type === 'Chats') insertPastChatMention(item.value as any)
                            else if (item.type === 'Workflows')
                              insertWorkflowMention(item.value as any)
                            else if (item.type === 'Knowledge')
                              insertKnowledgeMention(item.value as any)
                            else if (item.type === 'Workflow Blocks')
                              insertWorkflowBlockMention(item.value as any)
                            else if (item.type === 'Blocks') insertBlockMention(item.value as any)
                            else if (item.type === 'Templates')
                              insertTemplateMention(item.value as any)
                            else if (item.type === 'Logs') insertLogMention(item.value as any)
                          }}
                        >
                          {/* Render appropriate icon and content based on type */}
                          {item.type === 'Chats' && (
                            <>
                              <Bot
                                className='h-3.5 w-3.5 text-muted-foreground'
                                strokeWidth={1.5}
                              />
                              <span className='truncate'>
                                {(item.value as any).title || 'Untitled Chat'}
                              </span>
                            </>
                          )}
                          {item.type === 'Workflows' && (
                            <>
                              <div
                                className='h-3.5 w-3.5 flex-shrink-0 rounded'
                                style={{ backgroundColor: (item.value as any).color || '#3972F6' }}
                              />
                              <span className='truncate'>
                                {(item.value as any).name || 'Untitled Workflow'}
                              </span>
                            </>
                          )}
                          {item.type === 'Knowledge' && (
                            <>
                              <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                              <span className='truncate'>
                                {(item.value as any).name || 'Untitled'}
                              </span>
                            </>
                          )}
                          {(item.type === 'Blocks' || item.type === 'Workflow Blocks') && (
                            <>
                              <div
                                className='relative flex h-4 w-4 items-center justify-center rounded-[3px]'
                                style={{
                                  backgroundColor: (item.value as any).bgColor || '#6B7280',
                                }}
                              >
                                {(() => {
                                  const Icon = (item.value as any).iconComponent
                                  return Icon ? <Icon className='!h-3 !w-3 text-white' /> : null
                                })()}
                              </div>
                              <span className='truncate'>
                                {(item.value as any).name || (item.value as any).id}
                              </span>
                            </>
                          )}
                          {item.type === 'Templates' && (
                            <>
                              <div className='flex h-4 w-4 items-center justify-center'>★</div>
                              <span className='truncate'>
                                {(item.value as any).name || 'Untitled Template'}
                              </span>
                              {typeof (item.value as any).stars === 'number' && (
                                <span className='ml-auto text-muted-foreground text-xs'>
                                  {(item.value as any).stars}
                                </span>
                              )}
                            </>
                          )}
                          {item.type === 'Logs' && (
                            <>
                              {(item.value as any).level === 'error' ? (
                                <X className='h-3.5 w-3.5 text-red-500' />
                              ) : (
                                <Check className='h-3.5 w-3.5 text-green-500' />
                              )}
                              <span className='min-w-0 truncate'>
                                {(item.value as any).workflowName}
                              </span>
                              <span className='text-muted-foreground'>·</span>
                              <span className='whitespace-nowrap'>
                                {formatTimestamp((item.value as any).createdAt)}
                              </span>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )
              }

              // Filtered top-level options view
              return (
                <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
                  {filtered.map((label, idx) => (
                    <div
                      key={label}
                      data-idx={idx}
                      className={cn(
                        'flex cursor-default items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                        !inAggregated && mentionActiveIndex === idx && 'bg-muted'
                      )}
                      role='menuitem'
                      aria-selected={!inAggregated && mentionActiveIndex === idx}
                      onMouseEnter={() => {
                        setInAggregated(false)
                        setMentionActiveIndex(idx)
                      }}
                      onClick={() => {
                        if (label === 'Chats') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Chats')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensurePastChatsLoaded()
                        } else if (label === 'Workflows') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Workflows')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensureWorkflowsLoaded()
                        } else if (label === 'Knowledge') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Knowledge')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensureKnowledgeLoaded()
                        } else if (label === 'Blocks') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Blocks')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensureBlocksLoaded()
                        } else if (label === 'Workflow Blocks') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Workflow Blocks')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensureWorkflowBlocksLoaded()
                        } else if (label === 'Docs') {
                          insertDocsMention()
                        } else if (label === 'Templates') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Templates')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensureTemplatesLoaded()
                        } else if (label === 'Logs') {
                          resetActiveMentionQuery()
                          setOpenSubmenuFor('Logs')
                          setSubmenuActiveIndex(0)
                          setSubmenuQueryStart(getCaretPos())
                          mentionData.ensureLogsLoaded()
                        }
                      }}
                    >
                      <div className='flex items-center gap-2'>
                        {label === 'Chats' ? (
                          <Bot className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Workflows' ? (
                          <Workflow className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Blocks' ? (
                          <Blocks className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Workflow Blocks' ? (
                          <Box className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Knowledge' ? (
                          <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Docs' ? (
                          <BookOpen className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Templates' ? (
                          <Shapes className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : label === 'Logs' ? (
                          <SquareChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : (
                          <div className='h-3.5 w-3.5' />
                        )}
                        <span>{label === 'Workflows' ? 'All workflows' : label}</span>
                      </div>
                      {label !== 'Docs' && (
                        <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
