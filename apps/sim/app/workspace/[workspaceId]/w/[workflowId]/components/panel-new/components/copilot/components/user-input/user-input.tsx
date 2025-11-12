'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import { ArrowUp, AtSign, Image, Loader2 } from 'lucide-react'
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
  MentionMenu,
  ModelSelector,
  ModeSelector,
} from './components'
import { NEAR_TOP_THRESHOLD } from './constants'
import {
  useContextManagement,
  useFileAttachments,
  useMentionData,
  useMentionInsertHandlers,
  useMentionKeyboard,
  useMentionMenu,
  useMentionTokens,
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
  mode?: 'ask' | 'build'
  onModeChange?: (mode: 'ask' | 'build') => void
  value?: string
  onChange?: (value: string) => void
  panelWidth?: number
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
      mode = 'build',
      onModeChange,
      value: controlledValue,
      onChange: onControlledChange,
      panelWidth = 308,
      clearOnSubmit = true,
    },
    ref
  ) => {
    // Refs and external hooks
    const { data: session } = useSession()
    const params = useParams()
    const workspaceId = params.workspaceId as string

    // Store hooks
    const { workflowId, selectedModel, setSelectedModel } = useCopilotStore()

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

    // Preload mention data when query is active
    useEffect(() => {
      if (!mentionMenu.showMentionMenu || mentionMenu.openSubmenuFor) {
        return
      }

      const q = mentionMenu
        .getActiveMentionQueryAtPosition(mentionMenu.getCaretPos())
        ?.query.trim()
        .toLowerCase()

      if (q && q.length > 0) {
        // Prefetch all lists when there's any query for instant filtering
        void mentionData.ensurePastChatsLoaded()
        void mentionData.ensureWorkflowsLoaded()
        void mentionData.ensureWorkflowBlocksLoaded()
        void mentionData.ensureKnowledgeLoaded()
        void mentionData.ensureBlocksLoaded()
        void mentionData.ensureTemplatesLoaded()
        void mentionData.ensureLogsLoaded()

        // Reset to first item when query changes
        mentionMenu.setSubmenuActiveIndex(0)
        requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
      }
      // Only depend on values that trigger data loading, not the entire objects
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.showMentionMenu, mentionMenu.openSubmenuFor, message])

    // When switching into a submenu, select the first item and scroll to it
    useEffect(() => {
      if (mentionMenu.openSubmenuFor) {
        mentionMenu.setSubmenuActiveIndex(0)
        requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionMenu.openSubmenuFor])

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
        style={{ '--panel-max-width': `${panelWidth - 16}px` } as React.CSSProperties}
      >
        <div
          ref={setInputContainerRef}
          className={cn(
            'relative w-full rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[6px] transition-colors dark:bg-[var(--surface-9)]',
            fileAttachments.isDragging && 'ring-[1.75px] ring-[var(--brand-secondary)]'
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
              className='relative z-[2] m-0 box-border h-auto min-h-[48px] w-full resize-none overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent px-[2px] py-1 font-medium font-sans text-sm text-transparent leading-[1.25rem] caret-foreground outline-none [-ms-overflow-style:none] [scrollbar-width:none] [text-rendering:auto] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0 dark:placeholder:text-[var(--text-muted)] [&::-webkit-scrollbar]:hidden'
            />

            {/* Mention Menu Portal */}
            {mentionMenu.showMentionMenu &&
              createPortal(
                <MentionMenu
                  mentionMenu={mentionMenu}
                  mentionData={mentionData}
                  message={message}
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
                selectedModel={selectedModel}
                isNearTop={isNearTop}
                onModelSelect={(model: string) => setSelectedModel(model as any)}
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
                  onClick={handleAbort}
                  disabled={isAborting}
                  className={cn(
                    'h-[20px] w-[20px] rounded-full p-0 transition-colors',
                    !isAborting
                      ? 'bg-[#C0C0C0] hover:bg-[#D0D0D0] dark:bg-[#C0C0C0] dark:hover:bg-[#D0D0D0]'
                      : 'bg-[#C0C0C0] dark:bg-[#C0C0C0]'
                  )}
                  title='Stop generation'
                >
                  {isAborting ? (
                    <Loader2 className='block h-[13px] w-[13px] animate-spin text-black' />
                  ) : (
                    <svg
                      className='block h-[13px] w-[13px]'
                      viewBox='0 0 24 24'
                      fill='black'
                      xmlns='http://www.w3.org/2000/svg'
                    >
                      <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
                    </svg>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'h-[22px] w-[22px] rounded-full p-0 transition-colors',
                    canSubmit
                      ? 'bg-[#C0C0C0] hover:bg-[#D0D0D0] dark:bg-[#C0C0C0] dark:hover:bg-[#D0D0D0]'
                      : 'bg-[#C0C0C0] dark:bg-[#C0C0C0]'
                  )}
                >
                  {isLoading ? (
                    <Loader2 className='block h-3.5 w-3.5 animate-spin text-black' />
                  ) : (
                    <ArrowUp className='block h-3.5 w-3.5 text-black' strokeWidth={2.25} />
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
