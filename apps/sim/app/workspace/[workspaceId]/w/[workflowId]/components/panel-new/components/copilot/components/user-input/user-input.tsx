'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import { ArrowUp, AtSign, Image, Loader2, Square } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Badge, Button } from '@/components/emcn'
import { Textarea } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { ChatContext } from '@/stores/panel-new/copilot/types'
import {
  AttachedFilesDisplay,
  ContextPills,
  MentionMenuPortal,
  ModelSelector,
  ModeSelector,
} from './components'
import {
  MENTION_MENU_MARGINS,
  MENTION_MENU_MAX_HEIGHT,
  MENTION_MENU_WIDTHS,
  MENTION_OPTIONS,
  NEAR_TOP_THRESHOLD,
} from './constants'
import {
  useContextManagement,
  useFileAttachments,
  useMentionData,
  useMentionInsertHandlers,
  useMentionKeyboard,
  useMentionMenu,
  useMentionTokens,
  useModelSelection,
  useTextareaAutoResize,
} from './hooks'
import type { MessageFileAttachment } from './hooks/use-file-attachments'

const logger = createLogger('CopilotUserInput')

interface UserInputProps {
  onSubmit: (
    message: string,
    fileAttachments?: MessageFileAttachment[],
    contexts?: ChatContext[]
  ) => void
  onAbort?: () => void
  disabled?: boolean
  isLoading?: boolean
  isAborting?: boolean
  placeholder?: string
  className?: string
  mode?: 'ask' | 'agent'
  onModeChange?: (mode: 'ask' | 'agent') => void
  value?: string
  onChange?: (value: string) => void
  panelWidth?: number
  hideContextUsage?: boolean
  clearOnSubmit?: boolean
}

interface UserInputRef {
  focus: () => void
}

/**
 * User input component for the copilot chat interface.
 * Supports file attachments, @mentions, mode selection, model selection, and rich text editing.
 * Integrates with the copilot store and provides keyboard shortcuts for enhanced UX.
 *
 * @param props - Component props
 * @returns Rendered user input component
 */
const UserInput = forwardRef<UserInputRef, UserInputProps>(
  (
    {
      onSubmit,
      onAbort,
      disabled = false,
      isLoading = false,
      isAborting = false,
      placeholder,
      className,
      mode = 'agent',
      onModeChange,
      value: controlledValue,
      onChange: onControlledChange,
      panelWidth = 308,
      hideContextUsage = false,
      clearOnSubmit = true,
    },
    ref
  ) => {
    // Refs and external hooks
    const { data: session } = useSession()
    const params = useParams()
    const workspaceId = params.workspaceId as string

    // Store hooks
    const { workflowId, contextUsage, createNewChat } = useCopilotStore()

    // Internal state
    const [internalMessage, setInternalMessage] = useState('')
    const [isNearTop, setIsNearTop] = useState(false)
    const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null)
    const [inputContainerRef, setInputContainerRef] = useState<HTMLDivElement | null>(null)

    // Controlled vs uncontrolled message state
    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

    // Effective placeholder
    const effectivePlaceholder =
      placeholder || (mode === 'ask' ? 'Ask about your workflow' : 'Plan, search, build anything')

    // Custom hooks - order matters for ref sharing
    // Context management (manages selectedContexts state)
    const contextManagement = useContextManagement({ message })

    // Mention menu
    const mentionMenu = useMentionMenu({
      message,
      selectedContexts: contextManagement.selectedContexts,
      onContextSelect: contextManagement.addContext,
      onMessageChange: setMessage,
    })

    // Mention token utilities
    const mentionTokensWithContext = useMentionTokens({
      message,
      selectedContexts: contextManagement.selectedContexts,
      mentionMenu,
      setMessage,
      setSelectedContexts: contextManagement.setSelectedContexts,
    })

    const { overlayRef } = useTextareaAutoResize({
      message,
      panelWidth,
      selectedContexts: contextManagement.selectedContexts,
      textareaRef: mentionMenu.textareaRef,
      containerRef: inputContainerRef,
    })

    const mentionData = useMentionData({
      workflowId: workflowId || null,
      workspaceId,
    })

    const fileAttachments = useFileAttachments({
      userId: session?.user?.id,
      disabled,
      isLoading,
    })

    const modelSelection = useModelSelection()

    // Insert mention handlers
    const insertHandlers = useMentionInsertHandlers({
      mentionMenu,
      workflowId: workflowId || null,
      selectedContexts: contextManagement.selectedContexts,
      onContextAdd: contextManagement.addContext,
    })

    // Keyboard navigation hook
    const mentionKeyboard = useMentionKeyboard({
      mentionMenu,
      mentionData,
      insertHandlers,
    })

    // Expose focus method to parent
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const textarea = mentionMenu.textareaRef.current
          if (textarea) {
            textarea.focus()
            const length = textarea.value.length
            textarea.setSelectionRange(length, length)
            textarea.scrollTop = textarea.scrollHeight
          }
        },
      }),
      [mentionMenu.textareaRef]
    )

    // Note: textarea auto-resize is handled by the useTextareaAutoResize hook

    // Load workflows on mount if we have a workflowId
    useEffect(() => {
      if (workflowId) {
        void mentionData.ensureWorkflowsLoaded()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workflowId])

    // Detect if input is near top of screen
    useEffect(() => {
      const checkPosition = () => {
        if (containerRef) {
          const rect = containerRef.getBoundingClientRect()
          setIsNearTop(rect.top < NEAR_TOP_THRESHOLD)
        }
      }

      checkPosition()

      const scrollContainer = containerRef?.closest('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', checkPosition, { passive: true })
      }

      window.addEventListener('scroll', checkPosition, true)
      window.addEventListener('resize', checkPosition)

      return () => {
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', checkPosition)
        }
        window.removeEventListener('scroll', checkPosition, true)
        window.removeEventListener('resize', checkPosition)
      }
    }, [containerRef])

    // Also check position when mention menu opens
    useEffect(() => {
      if (mentionMenu.showMentionMenu && containerRef) {
        const rect = containerRef.getBoundingClientRect()
        setIsNearTop(rect.top < NEAR_TOP_THRESHOLD)
      }
    }, [mentionMenu.showMentionMenu, containerRef])

    // Manage aggregated mode and preload mention data when query is active
    useEffect(() => {
      if (!mentionMenu.showMentionMenu || mentionMenu.openSubmenuFor) {
        mentionMenu.setAggregatedActive(false)
        mentionMenu.setInAggregated(false)
        return
      }

      const q = mentionMenu
        .getActiveMentionQueryAtPosition(mentionMenu.getCaretPos())
        ?.query.trim()
        .toLowerCase()

      if (q && q.length > 0) {
        const filteredMain = MENTION_OPTIONS.filter((o) => o.toLowerCase().includes(q))
        const needAggregate = filteredMain.length === 0
        mentionMenu.setAggregatedActive(needAggregate)

        // Prefetch all lists when there's any query
        void mentionData.ensurePastChatsLoaded()
        void mentionData.ensureWorkflowsLoaded()
        void mentionData.ensureWorkflowBlocksLoaded()
        void mentionData.ensureKnowledgeLoaded()
        void mentionData.ensureBlocksLoaded()
        void mentionData.ensureTemplatesLoaded()
        void mentionData.ensureLogsLoaded()

        if (needAggregate) {
          mentionMenu.setSubmenuActiveIndex(0)
          requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
        }
      }
      // Only depend on values that trigger data loading, not the entire objects
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.showMentionMenu, mentionMenu.openSubmenuFor, message])

    // When switching into a submenu, select the first item and scroll to it
    useEffect(() => {
      if (mentionMenu.openSubmenuFor) {
        mentionMenu.setInAggregated(false)
        mentionMenu.setSubmenuActiveIndex(0)
        requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.openSubmenuFor])

    // Position the mention menu portal dynamically
    useEffect(() => {
      if (!mentionMenu.showMentionMenu) {
        mentionMenu.setMentionPortalStyle(null)
        return
      }

      const updatePosition = () => {
        if (!containerRef || !mentionMenu.textareaRef.current) {
          return
        }

        const rect = containerRef.getBoundingClientRect()
        const margin = MENTION_MENU_MARGINS.VIEWPORT
        const textarea = mentionMenu.textareaRef.current
        const caretPos = mentionMenu.getCaretPos()

        // Create a mirror div to calculate caret position
        const div = document.createElement('div')
        const style = window.getComputedStyle(textarea)

        div.style.position = 'absolute'
        div.style.visibility = 'hidden'
        div.style.whiteSpace = 'pre-wrap'
        div.style.wordWrap = 'break-word'
        div.style.font = style.font
        div.style.padding = style.padding
        div.style.border = style.border
        div.style.width = style.width
        div.style.lineHeight = style.lineHeight

        const textBeforeCaret = message.substring(0, caretPos)
        div.textContent = textBeforeCaret

        const span = document.createElement('span')
        span.textContent = '|'
        div.appendChild(span)

        document.body.appendChild(div)
        const spanRect = span.getBoundingClientRect()
        const divRect = div.getBoundingClientRect()
        document.body.removeChild(div)

        const caretLeftOffset = spanRect.left - divRect.left

        const spaceAbove = rect.top - margin
        const spaceBelow = window.innerHeight - rect.bottom - margin

        const maxMenuHeight = MENTION_MENU_MAX_HEIGHT
        const showBelow = rect.top < NEAR_TOP_THRESHOLD || spaceBelow > spaceAbove
        const maxHeight = Math.min(
          Math.max(showBelow ? spaceBelow : spaceAbove, 120),
          maxMenuHeight
        )

        const menuWidth =
          mentionMenu.openSubmenuFor === 'Blocks'
            ? MENTION_MENU_WIDTHS.BLOCKS
            : mentionMenu.openSubmenuFor === 'Templates' ||
                mentionMenu.openSubmenuFor === 'Logs' ||
                mentionMenu.aggregatedActive
              ? MENTION_MENU_WIDTHS.EXPANDED
              : MENTION_MENU_WIDTHS.DEFAULT

        const idealLeft = rect.left + caretLeftOffset
        const maxLeft = window.innerWidth - menuWidth - margin
        const finalLeft = Math.min(idealLeft, maxLeft)

        mentionMenu.setMentionPortalStyle({
          top: showBelow
            ? rect.bottom + MENTION_MENU_MARGINS.PORTAL_OFFSET
            : rect.top - MENTION_MENU_MARGINS.PORTAL_OFFSET,
          left: Math.max(rect.left, finalLeft),
          width: menuWidth,
          maxHeight: maxHeight,
          showBelow,
        })

        setIsNearTop(showBelow)
      }

      // Initial position
      updatePosition()

      // Listen to events
      window.addEventListener('resize', updatePosition)
      const scrollContainer = containerRef?.closest('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', updatePosition, { passive: true })
      }

      // Continuous updates for smooth tracking
      let rafId: number
      const loop = () => {
        updatePosition()
        rafId = requestAnimationFrame(loop)
      }
      rafId = requestAnimationFrame(loop)

      return () => {
        window.removeEventListener('resize', updatePosition)
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', updatePosition)
        }
        cancelAnimationFrame(rafId)
      }
      // Only depend on values that should trigger repositioning, not the entire mentionMenu object
    }, [
      mentionMenu.showMentionMenu,
      mentionMenu.openSubmenuFor,
      mentionMenu.aggregatedActive,
      message,
      containerRef,
    ])

    // Handlers
    const handleSubmit = useCallback(async () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) return

      const failedUploads = fileAttachments.attachedFiles.filter((f) => !f.uploading && !f.key)
      if (failedUploads.length > 0) {
        logger.error(`Some files failed to upload: ${failedUploads.map((f) => f.name).join(', ')}`)
      }

      const fileAttachmentsForApi = fileAttachments.attachedFiles
        .filter((f) => !f.uploading && f.key)
        .map((f) => ({
          id: f.id,
          key: f.key!,
          filename: f.name,
          media_type: f.type,
          size: f.size,
        }))

      onSubmit(trimmedMessage, fileAttachmentsForApi, contextManagement.selectedContexts as any)

      if (clearOnSubmit) {
        fileAttachments.attachedFiles.forEach((f) => {
          if (f.previewUrl) {
            URL.revokeObjectURL(f.previewUrl)
          }
        })

        setMessage('')
        fileAttachments.clearAttachedFiles()
        contextManagement.clearContexts()
        mentionMenu.setOpenSubmenuFor(null)
      }
      mentionMenu.setShowMentionMenu(false)
    }, [
      message,
      disabled,
      isLoading,
      fileAttachments,
      onSubmit,
      contextManagement,
      clearOnSubmit,
      setMessage,
      mentionMenu,
    ])

    const handleAbort = useCallback(() => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }, [onAbort, isLoading])

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Escape key handling
        if (e.key === 'Escape' && mentionMenu.showMentionMenu) {
          e.preventDefault()
          if (mentionMenu.openSubmenuFor) {
            mentionMenu.setOpenSubmenuFor(null)
            mentionMenu.setSubmenuQueryStart(null)
          } else {
            mentionMenu.closeMentionMenu()
          }
          return
        }

        // Arrow navigation in mention menu
        if (mentionKeyboard.handleArrowNavigation(e)) return
        if (mentionKeyboard.handleArrowRight(e)) return
        if (mentionKeyboard.handleArrowLeft(e)) return

        // Enter key handling
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (!mentionMenu.showMentionMenu) {
            handleSubmit()
          } else {
            mentionKeyboard.handleEnterSelection(e)
          }
          return
        }

        // Handle mention token behavior (backspace, delete, arrow keys) when menu is closed
        if (!mentionMenu.showMentionMenu) {
          const textarea = mentionMenu.textareaRef.current
          const selStart = textarea?.selectionStart ?? 0
          const selEnd = textarea?.selectionEnd ?? selStart
          const selectionLength = Math.abs(selEnd - selStart)

          if (e.key === 'Backspace' || e.key === 'Delete') {
            if (selectionLength > 0) {
              // Multi-character selection: Clean up contexts for any overlapping mentions
              // but let the default behavior handle the actual text deletion
              mentionTokensWithContext.removeContextsInSelection(selStart, selEnd)
            } else {
              // Single character delete - check if cursor is inside/at a mention token
              const ranges = mentionTokensWithContext.computeMentionRanges()
              const target =
                e.key === 'Backspace'
                  ? ranges.find((r) => selStart > r.start && selStart <= r.end)
                  : ranges.find((r) => selStart >= r.start && selStart < r.end)

              if (target) {
                e.preventDefault()
                mentionTokensWithContext.deleteRange(target)
                return
              }
            }
          }

          if (selectionLength === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            if (textarea) {
              if (e.key === 'ArrowLeft') {
                const nextPos = Math.max(0, selStart - 1)
                const r = mentionTokensWithContext.findRangeContaining(nextPos)
                if (r) {
                  e.preventDefault()
                  const target = r.start
                  setTimeout(() => textarea.setSelectionRange(target, target), 0)
                  return
                }
              } else if (e.key === 'ArrowRight') {
                const nextPos = Math.min(message.length, selStart + 1)
                const r = mentionTokensWithContext.findRangeContaining(nextPos)
                if (r) {
                  e.preventDefault()
                  const target = r.end
                  setTimeout(() => textarea.setSelectionRange(target, target), 0)
                  return
                }
              }
            }
          }

          // Prevent typing inside token
          if (e.key.length === 1 || e.key === 'Space') {
            const blocked =
              selectionLength === 0 && !!mentionTokensWithContext.findRangeContaining(selStart)
            if (blocked) {
              e.preventDefault()
              const r = mentionTokensWithContext.findRangeContaining(selStart)
              if (r && textarea) {
                setTimeout(() => {
                  textarea.setSelectionRange(r.end, r.end)
                }, 0)
              }
              return
            }
          }
        }
      },
      [mentionMenu, mentionKeyboard, handleSubmit, message.length, mentionTokensWithContext]
    )

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        setMessage(newValue)

        const caret = e.target.selectionStart ?? newValue.length
        const active = mentionMenu.getActiveMentionQueryAtPosition(caret, newValue)

        if (active) {
          mentionMenu.setShowMentionMenu(true)
          mentionMenu.setInAggregated(false)
          if (mentionMenu.openSubmenuFor) {
            mentionMenu.setSubmenuActiveIndex(0)
          } else {
            mentionMenu.setMentionActiveIndex(0)
            mentionMenu.setSubmenuActiveIndex(0)
          }
        } else {
          mentionMenu.setShowMentionMenu(false)
          mentionMenu.setOpenSubmenuFor(null)
          mentionMenu.setSubmenuQueryStart(null)
        }
      },
      [setMessage, mentionMenu]
    )

    const handleSelectAdjust = useCallback(() => {
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return
      const pos = textarea.selectionStart ?? 0
      const r = mentionTokensWithContext.findRangeContaining(pos)
      if (r) {
        const snapPos = pos - r.start < r.end - pos ? r.start : r.end
        setTimeout(() => {
          textarea.setSelectionRange(snapPos, snapPos)
        }, 0)
      }
    }, [mentionMenu.textareaRef, mentionTokensWithContext])

    const handleOpenMentionMenuWithAt = useCallback(() => {
      if (disabled || isLoading) return
      const textarea = mentionMenu.textareaRef.current
      if (!textarea) return
      textarea.focus()
      const pos = textarea.selectionStart ?? message.length
      const needsSpaceBefore = pos > 0 && !/\s/.test(message.charAt(pos - 1))

      const insertText = needsSpaceBefore ? ' @' : '@'
      const start = textarea.selectionStart ?? message.length
      const end = textarea.selectionEnd ?? message.length
      const before = message.slice(0, start)
      const after = message.slice(end)
      const next = `${before}${insertText}${after}`
      setMessage(next)

      setTimeout(() => {
        const newPos = before.length + insertText.length
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      }, 0)

      mentionMenu.setShowMentionMenu(true)
      mentionMenu.setOpenSubmenuFor(null)
      mentionMenu.setMentionActiveIndex(0)
      mentionMenu.setSubmenuActiveIndex(0)
    }, [disabled, isLoading, mentionMenu, message, setMessage])

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    // Render overlay content with highlighted mentions
    const renderOverlayContent = useCallback(() => {
      const contexts = contextManagement.selectedContexts

      // Handle empty message
      if (!message) {
        return <span>{'\u00A0'}</span>
      }

      // If no contexts, render the message directly with proper newline handling
      if (contexts.length === 0) {
        // Add a zero-width space at the end if message ends with newline
        // This ensures the newline is rendered and height is calculated correctly
        const displayText = message.endsWith('\n') ? `${message}\u200B` : message
        return <span>{displayText}</span>
      }

      const elements: React.ReactNode[] = []
      const labels = contexts.map((c) => c.label).filter(Boolean)

      // Build ranges for all mentions to highlight them including spaces
      const ranges = mentionTokensWithContext.computeMentionRanges()

      if (ranges.length === 0) {
        const displayText = message.endsWith('\n') ? `${message}\u200B` : message
        return <span>{displayText}</span>
      }

      let lastIndex = 0
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i]

        // Add text before mention
        if (range.start > lastIndex) {
          const before = message.slice(lastIndex, range.start)
          elements.push(<span key={`text-${i}-${lastIndex}-${range.start}`}>{before}</span>)
        }

        // Add highlighted mention (including spaces)
        // Use index + start + end to ensure unique keys even with duplicate contexts
        const mentionText = message.slice(range.start, range.end)
        elements.push(
          <span
            key={`mention-${i}-${range.start}-${range.end}`}
            className='rounded-[6px] bg-[rgba(142,76,251,0.65)]'
          >
            {mentionText}
          </span>
        )
        lastIndex = range.end
      }

      const tail = message.slice(lastIndex)
      if (tail) {
        // Add a zero-width space at the end if tail ends with newline
        const displayTail = tail.endsWith('\n') ? `${tail}\u200B` : tail
        elements.push(<span key={`tail-${lastIndex}`}>{displayTail}</span>)
      }

      // Ensure there's always something to render for height calculation
      return elements.length > 0 ? elements : <span>{'\u00A0'}</span>
    }, [message, contextManagement.selectedContexts, mentionTokensWithContext])

    return (
      <div
        ref={setContainerRef}
        data-user-input
        className={cn('relative w-full flex-none [max-width:var(--panel-max-width)]', className)}
        style={{ '--panel-max-width': `${panelWidth - 17}px` } as React.CSSProperties}
      >
        <div
          ref={setInputContainerRef}
          className={cn(
            'relative rounded-[4px] border border-[#3D3D3D] bg-[#282828] px-[6px] py-[6px] transition-colors dark:bg-[#353535]',
            fileAttachments.isDragging &&
              'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
          )}
          onDragEnter={fileAttachments.handleDragEnter}
          onDragLeave={fileAttachments.handleDragLeave}
          onDragOver={fileAttachments.handleDragOver}
          onDrop={fileAttachments.handleDrop}
        >
          {/* Top Row: @ Button + Context Pills + Context Usage Pill */}
          <div className='mb-[6px] flex flex-wrap items-center gap-[6px]'>
            <Badge
              variant='outline'
              onClick={handleOpenMentionMenuWithAt}
              title='Insert @'
              className={cn(
                'cursor-pointer rounded-[6px] p-[4.5px]',
                (disabled || isLoading) && 'cursor-not-allowed'
              )}
            >
              <AtSign className='h-3 w-3' strokeWidth={1.75} />
            </Badge>

            {/* Selected Context Pills */}
            <ContextPills
              contexts={contextManagement.selectedContexts}
              onRemoveContext={contextManagement.removeContext}
            />

            {/* Context Usage Pill - pushes to the right */}
            {/* {!hideContextUsage && contextUsage && contextUsage.percentage > 0 && (
              <div className='ml-auto'>
                <ContextUsagePill
                  percentage={contextUsage.percentage}
                  onCreateNewChat={createNewChat}
                />
              </div>
            )} */}
          </div>

          {/* Attached Files Display */}
          <AttachedFilesDisplay
            files={fileAttachments.attachedFiles}
            onFileClick={fileAttachments.handleFileClick}
            onFileRemove={fileAttachments.removeFile}
            formatFileSize={fileAttachments.formatFileSize}
            getFileIconType={fileAttachments.getFileIconType}
          />

          {/* Textarea Field with overlay */}
          <div className='relative mb-[6px]'>
            {/* Highlight overlay - must have identical flow as textarea */}
            <div
              ref={overlayRef}
              className='pointer-events-none absolute top-0 left-0 z-[1] m-0 box-border h-auto max-h-[120px] min-h-[48px] w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-[2px] py-1 font-medium font-sans text-[#0D0D0D] text-sm leading-[1.25rem] outline-none [-ms-overflow-style:none] [scrollbar-width:none] [text-rendering:optimizeLegibility] dark:text-gray-100 [&::-webkit-scrollbar]:hidden'
              aria-hidden='true'
            >
              {renderOverlayContent()}
            </div>

            <Textarea
              ref={mentionMenu.textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCut={mentionTokensWithContext.handleCut}
              onSelect={handleSelectAdjust}
              onMouseUp={handleSelectAdjust}
              onScroll={(e) => {
                const overlay = overlayRef.current
                if (overlay) {
                  overlay.scrollTop = e.currentTarget.scrollTop
                  overlay.scrollLeft = e.currentTarget.scrollLeft
                }
              }}
              placeholder={fileAttachments.isDragging ? 'Drop files here...' : effectivePlaceholder}
              disabled={disabled}
              rows={2}
              className='relative z-[2] m-0 box-border h-auto min-h-[48px] w-full resize-none overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent px-[2px] py-1 font-medium font-sans text-sm text-transparent leading-[1.25rem] caret-foreground outline-none [-ms-overflow-style:none] [scrollbar-width:none] [text-rendering:auto] focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden'
            />

            {/* Mention Menu Portal */}
            {mentionMenu.showMentionMenu &&
              mentionMenu.mentionPortalStyle &&
              createPortal(
                <MentionMenuPortal
                  mentionMenu={mentionMenu}
                  mentionData={mentionData}
                  selectedContexts={contextManagement.selectedContexts}
                  onContextSelect={contextManagement.addContext}
                  onMessageChange={setMessage}
                  message={message}
                  workflowId={workflowId}
                  insertHandlers={insertHandlers}
                />,
                document.body
              )}
          </div>

          {/* Bottom Row: Mode Selector + Model Selector + Attach Button + Send Button */}
          <div className='flex items-center justify-between gap-2'>
            {/* Left side: Mode Selector + Model Selector */}
            <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
              <ModeSelector
                mode={mode}
                onModeChange={onModeChange}
                isNearTop={isNearTop}
                disabled={disabled}
              />

              <ModelSelector
                selectedModel={modelSelection.selectedModel}
                agentPrefetch={modelSelection.agentPrefetch}
                enabledModels={modelSelection.enabledModels}
                panelWidth={panelWidth}
                isNearTop={isNearTop}
                onModelSelect={(model: string) => modelSelection.setSelectedModel(model as any)}
                onAgentPrefetchChange={modelSelection.setAgentPrefetch}
                onFirstOpen={modelSelection.fetchEnabledModelsOnce}
              />
            </div>

            {/* Right side: Attach Button + Send Button */}
            <div className='flex flex-shrink-0 items-center gap-[10px]'>
              <Badge
                onClick={fileAttachments.handleFileSelect}
                title='Attach file'
                className={cn(
                  'cursor-pointer rounded-[6px] bg-transparent p-[0px] dark:bg-transparent',
                  (disabled || isLoading) && 'cursor-not-allowed opacity-50'
                )}
              >
                <Image className='!h-3.5 !w-3.5 scale-x-110' />
              </Badge>

              {showAbortButton ? (
                <Button
                  variant='primary'
                  onClick={handleAbort}
                  disabled={isAborting}
                  className={cn(
                    'h-[22px] w-[22px] rounded-full p-0',
                    !isAborting &&
                      'ring-2 ring-[#8E4CFB]/60 ring-offset-[#282828] ring-offset-[1.25px] dark:ring-offset-[#353535]'
                  )}
                  title='Stop generation'
                >
                  {isAborting ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <Square className='h-3.5 w-3.5' fill='currentColor' />
                  )}
                </Button>
              ) : (
                <Button
                  variant='primary'
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'h-[22px] w-[22px] rounded-full p-0',
                    canSubmit &&
                      'ring-2 ring-[#8E4CFB]/60 ring-offset-[#282828] ring-offset-[1.25px] dark:ring-offset-[#353535]'
                  )}
                >
                  {isLoading ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <ArrowUp className='h-3.5 w-3.5' />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileAttachments.fileInputRef}
            type='file'
            onChange={fileAttachments.handleFileChange}
            className='hidden'
            accept='image/*'
            multiple
            disabled={disabled || isLoading}
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { UserInputRef }
