import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown, Plus } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverItem, PopoverTrigger } from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { cn } from '@/lib/utils'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'

const MIN_TEXTAREA_HEIGHT_PX = 80

/**
 * Interface for individual message in the messages array
 */
interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Props for the MessagesInput component
 */
interface MessagesInputProps {
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Configuration object for the sub-block */
  config: SubBlockConfig
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: Message[] | null
  /** Whether the input is disabled */
  disabled?: boolean
}

/**
 * MessagesInput component for managing LLM message history
 *
 * @remarks
 * - Manages an array of messages with role and content
 * - Each message can be edited, removed, or reordered
 * - Stores data in LLM-compatible format: [{ role, content }]
 */
export function MessagesInput({
  blockId,
  subBlockId,
  config,
  isPreview = false,
  previewValue,
  disabled = false,
}: MessagesInputProps) {
  const [messages, setMessages] = useSubBlockValue<Message[]>(blockId, subBlockId, false)
  const [localMessages, setLocalMessages] = useState<Message[]>([{ role: 'user', content: '' }])
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const [openPopoverIndex, setOpenPopoverIndex] = useState<number | null>(null)
  const subBlockInput = useSubBlockInput({
    blockId,
    subBlockId,
    config,
    isPreview,
    disabled,
  })

  /**
   * Initialize local state from stored or preview value
   */
  useEffect(() => {
    if (isPreview && previewValue && Array.isArray(previewValue)) {
      setLocalMessages(previewValue)
    } else if (messages && Array.isArray(messages) && messages.length > 0) {
      setLocalMessages(messages)
    }
  }, [isPreview, previewValue, messages])

  /**
   * Gets the current messages array
   */
  const currentMessages = useMemo<Message[]>(() => {
    if (isPreview && previewValue && Array.isArray(previewValue)) {
      return previewValue
    }
    return localMessages
  }, [isPreview, previewValue, localMessages])

  const overlayRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const userResizedRef = useRef<Record<string, boolean>>({})
  const isResizingRef = useRef(false)
  const resizeStateRef = useRef<{
    fieldId: string
    startY: number
    startHeight: number
  } | null>(null)

  /**
   * Updates a specific message's content
   */
  const updateMessageContent = useCallback(
    (index: number, content: string) => {
      if (isPreview || disabled) return

      const updatedMessages = [...localMessages]
      updatedMessages[index] = {
        ...updatedMessages[index],
        content,
      }
      setLocalMessages(updatedMessages)
      setMessages(updatedMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

  /**
   * Updates a specific message's role
   */
  const updateMessageRole = useCallback(
    (index: number, role: 'system' | 'user' | 'assistant') => {
      if (isPreview || disabled) return

      const updatedMessages = [...localMessages]
      updatedMessages[index] = {
        ...updatedMessages[index],
        role,
      }
      setLocalMessages(updatedMessages)
      setMessages(updatedMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

  /**
   * Adds a message after the specified index
   */
  const addMessageAfter = useCallback(
    (index: number) => {
      if (isPreview || disabled) return

      const newMessages = [...localMessages]
      newMessages.splice(index + 1, 0, { role: 'user' as const, content: '' })
      setLocalMessages(newMessages)
      setMessages(newMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

  /**
   * Deletes a message at the specified index
   */
  const deleteMessage = useCallback(
    (index: number) => {
      if (isPreview || disabled) return

      const newMessages = [...localMessages]
      newMessages.splice(index, 1)
      setLocalMessages(newMessages)
      setMessages(newMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

  /**
   * Capitalizes the first letter of the role
   */
  const formatRole = (role: string): string => {
    return role.charAt(0).toUpperCase() + role.slice(1)
  }

  /**
   * Handles header click to focus the textarea
   */
  const handleHeaderClick = useCallback((index: number, e: React.MouseEvent) => {
    // Don't focus if clicking on interactive elements
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[data-radix-popper-content-wrapper]')) {
      return
    }

    const fieldId = `message-${index}`
    textareaRefs.current[fieldId]?.focus()
  }, [])

  const autoResizeTextarea = useCallback((fieldId: string) => {
    const textarea = textareaRefs.current[fieldId]
    if (!textarea) return
    const overlay = overlayRefs.current[fieldId]

    // If user has manually resized, respect their chosen height and only sync overlay.
    if (userResizedRef.current[fieldId]) {
      const currentHeight =
        textarea.offsetHeight || Number.parseFloat(textarea.style.height) || MIN_TEXTAREA_HEIGHT_PX
      const clampedHeight = Math.max(MIN_TEXTAREA_HEIGHT_PX, currentHeight)
      textarea.style.height = `${clampedHeight}px`
      if (overlay) {
        overlay.style.height = `${clampedHeight}px`
      }
      return
    }

    // Auto-resize to fit content only when user hasn't manually resized.
    textarea.style.height = 'auto'
    const naturalHeight = textarea.scrollHeight || MIN_TEXTAREA_HEIGHT_PX
    const nextHeight = Math.max(MIN_TEXTAREA_HEIGHT_PX, naturalHeight)
    textarea.style.height = `${nextHeight}px`

    if (overlay) {
      overlay.style.height = `${nextHeight}px`
    }
  }, [])

  const handleResizeStart = useCallback((fieldId: string, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const textarea = textareaRefs.current[fieldId]
    if (!textarea) return

    const startHeight = textarea.offsetHeight || textarea.scrollHeight || MIN_TEXTAREA_HEIGHT_PX

    isResizingRef.current = true
    resizeStateRef.current = {
      fieldId,
      startY: e.clientY,
      startHeight,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current || !resizeStateRef.current) return

      const { fieldId: activeFieldId, startY, startHeight } = resizeStateRef.current
      const deltaY = moveEvent.clientY - startY
      const nextHeight = Math.max(MIN_TEXTAREA_HEIGHT_PX, startHeight + deltaY)

      const activeTextarea = textareaRefs.current[activeFieldId]
      if (activeTextarea) {
        activeTextarea.style.height = `${nextHeight}px`
      }

      const overlay = overlayRefs.current[activeFieldId]
      if (overlay) {
        overlay.style.height = `${nextHeight}px`
      }
    }

    const handleMouseUp = () => {
      if (resizeStateRef.current) {
        const { fieldId: activeFieldId } = resizeStateRef.current
        userResizedRef.current[activeFieldId] = true
      }

      isResizingRef.current = false
      resizeStateRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  useEffect(() => {
    currentMessages.forEach((_, index) => {
      const fieldId = `message-${index}`
      autoResizeTextarea(fieldId)
    })
  }, [currentMessages, autoResizeTextarea])

  return (
    <div className='flex w-full flex-col gap-3'>
      {currentMessages.map((message, index) => (
        <div
          key={`message-${index}`}
          className={cn(
            'relative flex w-full flex-col rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] transition-colors dark:bg-[var(--surface-9)]',
            disabled && 'opacity-50'
          )}
        >
          {(() => {
            const fieldId = `message-${index}`
            const fieldState = subBlockInput.fieldHelpers.getFieldState(fieldId)
            const fieldHandlers = subBlockInput.fieldHelpers.createFieldHandlers(
              fieldId,
              message.content,
              (newValue: string) => {
                updateMessageContent(index, newValue)
              }
            )

            const handleEnvSelect = subBlockInput.fieldHelpers.createEnvVarSelectHandler(
              fieldId,
              message.content,
              (newValue: string) => {
                updateMessageContent(index, newValue)
              }
            )

            const handleTagSelect = subBlockInput.fieldHelpers.createTagSelectHandler(
              fieldId,
              message.content,
              (newValue: string) => {
                updateMessageContent(index, newValue)
              }
            )

            const textareaRefObject = {
              current: textareaRefs.current[fieldId] ?? null,
            } as React.RefObject<HTMLTextAreaElement>

            return (
              <>
                {/* Header with role label and add button */}
                <div
                  className='flex cursor-pointer items-center justify-between px-[8px] pt-[6px]'
                  onClick={(e) => handleHeaderClick(index, e)}
                >
                  <Popover
                    open={openPopoverIndex === index}
                    onOpenChange={(open) => setOpenPopoverIndex(open ? index : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type='button'
                        disabled={isPreview || disabled}
                        className={cn(
                          '-ml-1.5 -my-1 rounded px-1.5 py-1 font-medium text-[13px] text-[var(--text-primary)] leading-none transition-colors hover:bg-[var(--surface-8)] hover:text-[var(--text-secondary)]',
                          (isPreview || disabled) &&
                            'cursor-default hover:bg-transparent hover:text-[var(--text-primary)]'
                        )}
                        onClick={(e) => e.stopPropagation()}
                        aria-label='Select message role'
                      >
                        {formatRole(message.role)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent minWidth={140} align='start'>
                      <div className='flex flex-col gap-[2px]'>
                        {(['system', 'user', 'assistant'] as const).map((role) => (
                          <PopoverItem
                            key={role}
                            active={message.role === role}
                            onClick={() => {
                              updateMessageRole(index, role)
                              setOpenPopoverIndex(null)
                            }}
                          >
                            <span>{formatRole(role)}</span>
                          </PopoverItem>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  {!isPreview && !disabled && (
                    <div className='flex items-center'>
                      {currentMessages.length > 1 && (
                        <Button
                          variant='ghost'
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation()
                            deleteMessage(index)
                          }}
                          disabled={disabled}
                          className='-my-1 -mr-1 h-6 w-6 p-0'
                          aria-label='Delete message'
                        >
                          <Trash className='h-3 w-3' />
                        </Button>
                      )}
                      <Button
                        variant='ghost'
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation()
                          addMessageAfter(index)
                        }}
                        disabled={disabled}
                        className='-mr-1.5 -my-1 h-6 w-6 p-0'
                        aria-label='Add message below'
                      >
                        <Plus className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Content Input with overlay for variable highlighting */}
                <div className='relative w-full'>
                  <textarea
                    ref={(el) => {
                      textareaRefs.current[fieldId] = el
                    }}
                    className='allow-scroll box-border min-h-[80px] w-full resize-none whitespace-pre-wrap break-words border-none bg-transparent px-[8px] py-[8px] font-[inherit] font-medium text-sm text-transparent leading-[inherit] caret-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed'
                    rows={3}
                    placeholder='Enter message content...'
                    value={message.content}
                    onChange={(e) => {
                      fieldHandlers.onChange(e)
                      autoResizeTextarea(fieldId)
                    }}
                    onKeyDown={fieldHandlers.onKeyDown}
                    onDrop={fieldHandlers.onDrop}
                    onDragOver={fieldHandlers.onDragOver}
                    onScroll={(e) => {
                      const overlay = overlayRefs.current[fieldId]
                      if (overlay) {
                        overlay.scrollTop = e.currentTarget.scrollTop
                        overlay.scrollLeft = e.currentTarget.scrollLeft
                      }
                    }}
                    disabled={isPreview || disabled}
                  />
                  <div
                    ref={(el) => {
                      overlayRefs.current[fieldId] = el
                    }}
                    className='pointer-events-none absolute top-0 left-0 box-border w-full overflow-auto whitespace-pre-wrap break-words border-none bg-transparent px-[8px] py-[8px] font-[inherit] font-medium text-[var(--text-primary)] text-sm leading-[inherit]'
                  >
                    {formatDisplayText(message.content, {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                    })}
                  </div>

                  {/* Env var dropdown for this message */}
                  <EnvVarDropdown
                    visible={fieldState.showEnvVars && !isPreview && !disabled}
                    onSelect={handleEnvSelect}
                    searchTerm={fieldState.searchTerm}
                    inputValue={message.content}
                    cursorPosition={fieldState.cursorPosition}
                    onClose={() => subBlockInput.fieldHelpers.hideFieldDropdowns(fieldId)}
                    workspaceId={subBlockInput.workspaceId}
                    maxHeight='192px'
                    inputRef={textareaRefObject}
                  />

                  {/* Tag dropdown for this message */}
                  <TagDropdown
                    visible={fieldState.showTags && !isPreview && !disabled}
                    onSelect={handleTagSelect}
                    blockId={blockId}
                    activeSourceBlockId={fieldState.activeSourceBlockId}
                    inputValue={message.content}
                    cursorPosition={fieldState.cursorPosition}
                    onClose={() => subBlockInput.fieldHelpers.hideFieldDropdowns(fieldId)}
                    inputRef={textareaRefObject}
                  />

                  {!isPreview && !disabled && (
                    <div
                      className='absolute right-1 bottom-1 flex h-4 w-4 cursor-ns-resize items-center justify-center rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)]'
                      onMouseDown={(e) => handleResizeStart(fieldId, e)}
                      onDragStart={(e) => {
                        e.preventDefault()
                      }}
                    >
                      <ChevronsUpDown className='h-3 w-3 text-[var(--text-muted)]' />
                    </div>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      ))}
    </div>
  )
}
