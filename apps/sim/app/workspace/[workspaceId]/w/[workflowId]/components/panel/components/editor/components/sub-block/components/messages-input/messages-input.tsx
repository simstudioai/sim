import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { isEqual } from 'lodash'
import { ChevronDown, ChevronsUpDown, ChevronUp, Plus } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverItem, PopoverTrigger } from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { cn } from '@/lib/core/utils/cn'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'

const MIN_TEXTAREA_HEIGHT_PX = 80
const MAX_TEXTAREA_HEIGHT_PX = 320

/** Pattern to match complete message objects in JSON */
const COMPLETE_MESSAGE_PATTERN =
  /"role"\s*:\s*"(system|user|assistant)"[^}]*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g

/** Pattern to match incomplete content at end of buffer */
const INCOMPLETE_CONTENT_PATTERN = /"content"\s*:\s*"((?:[^"\\]|\\.)*)$/

/** Pattern to match role before content */
const ROLE_BEFORE_CONTENT_PATTERN = /"role"\s*:\s*"(system|user|assistant)"[^{]*$/

/**
 * Unescapes JSON string content
 */
const unescapeContent = (str: string): string =>
  str.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')

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
  /** Ref to expose wand control handlers to parent */
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
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
  wandControlRef,
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
   * Gets the current messages as JSON string for wand context
   */
  const getMessagesJson = useCallback((): string => {
    if (localMessages.length === 0) return ''
    // Filter out empty messages for cleaner context
    const nonEmptyMessages = localMessages.filter((m) => m.content.trim() !== '')
    if (nonEmptyMessages.length === 0) return ''
    return JSON.stringify(nonEmptyMessages, null, 2)
  }, [localMessages])

  /**
   * Streaming buffer for accumulating JSON content
   */
  const streamBufferRef = useRef<string>('')

  /**
   * Parses and validates messages from JSON content
   */
  const parseMessages = useCallback((content: string): Message[] | null => {
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        const validMessages: Message[] = parsed
          .filter(
            (m): m is { role: string; content: string } =>
              typeof m === 'object' &&
              m !== null &&
              typeof m.role === 'string' &&
              typeof m.content === 'string'
          )
          .map((m) => ({
            role: (['system', 'user', 'assistant'].includes(m.role)
              ? m.role
              : 'user') as Message['role'],
            content: m.content,
          }))
        return validMessages.length > 0 ? validMessages : null
      }
    } catch {
      // Parsing failed
    }
    return null
  }, [])

  /**
   * Extracts messages from streaming JSON buffer
   * Uses simple pattern matching for efficiency
   */
  const extractStreamingMessages = useCallback(
    (buffer: string): Message[] => {
      // Try complete JSON parse first
      const complete = parseMessages(buffer)
      if (complete) return complete

      const result: Message[] = []

      // Reset regex lastIndex for global pattern
      COMPLETE_MESSAGE_PATTERN.lastIndex = 0
      let match
      while ((match = COMPLETE_MESSAGE_PATTERN.exec(buffer)) !== null) {
        result.push({ role: match[1] as Message['role'], content: unescapeContent(match[2]) })
      }

      // Check for incomplete message at end (content still streaming)
      const lastContentIdx = buffer.lastIndexOf('"content"')
      if (lastContentIdx !== -1) {
        const tail = buffer.slice(lastContentIdx)
        const incomplete = tail.match(INCOMPLETE_CONTENT_PATTERN)
        if (incomplete) {
          const head = buffer.slice(0, lastContentIdx)
          const roleMatch = head.match(ROLE_BEFORE_CONTENT_PATTERN)
          if (roleMatch) {
            const content = unescapeContent(incomplete[1])
            // Only add if not duplicate of last complete message
            if (result.length === 0 || result[result.length - 1].content !== content) {
              result.push({ role: roleMatch[1] as Message['role'], content })
            }
          }
        }
      }

      return result
    },
    [parseMessages]
  )

  /**
   * Wand hook for AI-assisted content generation
   */
  const wandHook = useWand({
    wandConfig: config.wandConfig,
    currentValue: getMessagesJson(),
    onStreamStart: () => {
      streamBufferRef.current = ''
      setLocalMessages([{ role: 'system', content: '' }])
    },
    onStreamChunk: (chunk) => {
      streamBufferRef.current += chunk
      const extracted = extractStreamingMessages(streamBufferRef.current)
      if (extracted.length > 0) {
        setLocalMessages(extracted)
      }
    },
    onGeneratedContent: (content) => {
      const validMessages = parseMessages(content)
      if (validMessages) {
        setLocalMessages(validMessages)
        setMessages(validMessages)
      } else {
        // Fallback: treat as raw system prompt
        const trimmed = content.trim()
        if (trimmed) {
          const fallback: Message[] = [{ role: 'system', content: trimmed }]
          setLocalMessages(fallback)
          setMessages(fallback)
        }
      }
    },
  })

  /**
   * Expose wand control handlers to parent via ref
   */
  useImperativeHandle(
    wandControlRef,
    () => ({
      onWandTrigger: (prompt: string) => {
        wandHook.generateStream({ prompt })
      },
      isWandActive: wandHook.isPromptVisible,
      isWandStreaming: wandHook.isStreaming,
    }),
    [wandHook]
  )

  const localMessagesRef = useRef(localMessages)
  localMessagesRef.current = localMessages

  useEffect(() => {
    if (isPreview && previewValue && Array.isArray(previewValue)) {
      if (!isEqual(localMessagesRef.current, previewValue)) {
        setLocalMessages(previewValue)
      }
    } else if (messages && Array.isArray(messages) && messages.length > 0) {
      if (!isEqual(localMessagesRef.current, messages)) {
        setLocalMessages(messages)
      }
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
   * Moves a message up in the list
   */
  const moveMessageUp = useCallback(
    (index: number) => {
      if (isPreview || disabled || index === 0) return

      const newMessages = [...localMessages]
      const temp = newMessages[index]
      newMessages[index] = newMessages[index - 1]
      newMessages[index - 1] = temp
      setLocalMessages(newMessages)
      setMessages(newMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

  /**
   * Moves a message down in the list
   */
  const moveMessageDown = useCallback(
    (index: number) => {
      if (isPreview || disabled || index === localMessages.length - 1) return

      const newMessages = [...localMessages]
      const temp = newMessages[index]
      newMessages[index] = newMessages[index + 1]
      newMessages[index + 1] = temp
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

  const syncOverlay = useCallback((fieldId: string) => {
    const textarea = textareaRefs.current[fieldId]
    const overlay = overlayRefs.current[fieldId]
    if (!textarea || !overlay) return

    overlay.style.width = `${textarea.clientWidth}px`
    overlay.scrollTop = textarea.scrollTop
    overlay.scrollLeft = textarea.scrollLeft
  }, [])

  const autoResizeTextarea = useCallback(
    (fieldId: string) => {
      const textarea = textareaRefs.current[fieldId]
      const overlay = overlayRefs.current[fieldId]
      if (!textarea) return

      if (!textarea.value.trim()) {
        userResizedRef.current[fieldId] = false
      }

      if (userResizedRef.current[fieldId]) {
        if (overlay) {
          overlay.style.height = `${textarea.offsetHeight}px`
        }
        syncOverlay(fieldId)
        return
      }

      textarea.style.height = 'auto'
      const scrollHeight = textarea.scrollHeight
      const height = Math.min(
        MAX_TEXTAREA_HEIGHT_PX,
        Math.max(MIN_TEXTAREA_HEIGHT_PX, scrollHeight)
      )

      textarea.style.height = `${height}px`
      if (overlay) {
        overlay.style.height = `${height}px`
      }

      syncOverlay(fieldId)
    },
    [syncOverlay]
  )

  const handleResizeStart = useCallback(
    (fieldId: string, e: React.MouseEvent<HTMLDivElement>) => {
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
        const overlay = overlayRefs.current[activeFieldId]

        if (activeTextarea) {
          activeTextarea.style.height = `${nextHeight}px`
        }

        if (overlay) {
          overlay.style.height = `${nextHeight}px`
          if (activeTextarea) {
            overlay.scrollTop = activeTextarea.scrollTop
            overlay.scrollLeft = activeTextarea.scrollLeft
          }
        }
      }

      const handleMouseUp = () => {
        if (resizeStateRef.current) {
          const { fieldId: activeFieldId } = resizeStateRef.current
          userResizedRef.current[activeFieldId] = true
          syncOverlay(activeFieldId)
        }

        isResizingRef.current = false
        resizeStateRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [syncOverlay]
  )

  useLayoutEffect(() => {
    currentMessages.forEach((_, index) => {
      autoResizeTextarea(`message-${index}`)
    })
  }, [currentMessages, autoResizeTextarea])

  useEffect(() => {
    const observers: ResizeObserver[] = []

    for (let i = 0; i < currentMessages.length; i++) {
      const fieldId = `message-${i}`
      const textarea = textareaRefs.current[fieldId]
      const overlay = overlayRefs.current[fieldId]

      if (textarea && overlay) {
        const observer = new ResizeObserver(() => {
          overlay.style.width = `${textarea.clientWidth}px`
        })
        observer.observe(textarea)
        observers.push(observer)
      }
    }

    return () => {
      observers.forEach((observer) => observer.disconnect())
    }
  }, [currentMessages.length])

  return (
    <div className='flex w-full flex-col gap-[10px]'>
      {currentMessages.map((message, index) => (
        <div
          key={`message-${index}`}
          className={cn(
            'relative flex w-full flex-col rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] transition-colors dark:bg-[var(--surface-5)]',
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
                          'group -ml-1.5 -my-1 flex items-center gap-1 rounded px-1.5 py-1 font-medium text-[13px] text-[var(--text-primary)] leading-none transition-colors hover:bg-[var(--surface-5)] hover:text-[var(--text-secondary)]',
                          (isPreview || disabled) &&
                            'cursor-default hover:bg-transparent hover:text-[var(--text-primary)]'
                        )}
                        onClick={(e) => e.stopPropagation()}
                        aria-label='Select message role'
                      >
                        {formatRole(message.role)}
                        {!isPreview && !disabled && (
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 flex-shrink-0 transition-transform duration-100',
                              openPopoverIndex === index && 'rotate-180'
                            )}
                          />
                        )}
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
                        <>
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
                          <Button
                            variant='ghost'
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              moveMessageUp(index)
                            }}
                            disabled={disabled || index === 0}
                            className='-my-1 -mr-1 h-6 w-6 p-0'
                            aria-label='Move message up'
                          >
                            <ChevronUp className='h-3 w-3' />
                          </Button>
                          <Button
                            variant='ghost'
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              moveMessageDown(index)
                            }}
                            disabled={disabled || index === currentMessages.length - 1}
                            className='-my-1 -mr-1 h-6 w-6 p-0'
                            aria-label='Move message down'
                          >
                            <ChevronDown className='h-3 w-3' />
                          </Button>
                        </>
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
                <div className='relative w-full overflow-hidden'>
                  <textarea
                    ref={(el) => {
                      textareaRefs.current[fieldId] = el
                    }}
                    className='relative z-[2] m-0 box-border h-auto min-h-[80px] w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-none bg-transparent px-[8px] py-[8px] font-medium font-sans text-sm text-transparent leading-[1.5] caret-[var(--text-primary)] outline-none [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed [&::-webkit-scrollbar]:hidden'
                    placeholder='Enter message content...'
                    value={message.content}
                    onChange={fieldHandlers.onChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab' && !isPreview && !disabled) {
                        e.preventDefault()
                        const direction = e.shiftKey ? -1 : 1
                        const nextIndex = index + direction

                        if (nextIndex >= 0 && nextIndex < currentMessages.length) {
                          const nextFieldId = `message-${nextIndex}`
                          const nextTextarea = textareaRefs.current[nextFieldId]
                          if (nextTextarea) {
                            nextTextarea.focus()
                            nextTextarea.selectionStart = nextTextarea.value.length
                            nextTextarea.selectionEnd = nextTextarea.value.length
                          }
                        }
                        return
                      }

                      fieldHandlers.onKeyDown(e)
                    }}
                    onDrop={fieldHandlers.onDrop}
                    onDragOver={fieldHandlers.onDragOver}
                    onFocus={fieldHandlers.onFocus}
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
                    className='pointer-events-none absolute top-0 left-0 z-[1] m-0 box-border w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-none bg-transparent px-[8px] py-[8px] font-medium font-sans text-[var(--text-primary)] text-sm leading-[1.5] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                  >
                    {formatDisplayText(message.content, {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                    })}
                    {message.content.endsWith('\n') && '\u200B'}
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
                      className='absolute right-1 bottom-1 z-[3] flex h-4 w-4 cursor-ns-resize items-center justify-center rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] dark:bg-[var(--surface-5)]'
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
