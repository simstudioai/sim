import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  Chip,
  ChipSelect,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ChevronDown, ChevronUp, Duplicate, MoreHorizontal, Plus, Trash } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { isEqual } from 'es-toolkit'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { ReferenceTextarea } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/reference-text-control'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'

const MIN_TEXTAREA_HEIGHT_PX = 64
const MAX_TEXTAREA_HEIGHT_PX = 192
const MESSAGE_ROLE_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
] as const

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
  const activeSearchTarget = useActiveSearchTarget()
  const [messages, setMessages] = useSubBlockValue<Message[]>(blockId, subBlockId, false)
  const [localMessages, setLocalMessages] = useState<Message[]>([{ role: 'user', content: '' }])
  const messageIdsRef = useRef<string[]>([generateShortId()])
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
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

  const wandHook = useWand({
    wandConfig: config.wandConfig,
    currentValue: getMessagesJson(),
    onStreamStart: () => {
      streamBufferRef.current = ''
      messageIdsRef.current = [generateShortId()]
      setLocalMessages([{ role: 'system', content: '' }])
    },
    onStreamChunk: (chunk) => {
      streamBufferRef.current += chunk
      const extracted = extractStreamingMessages(streamBufferRef.current)
      if (extracted.length > 0) {
        while (messageIdsRef.current.length < extracted.length) {
          messageIdsRef.current.push(generateShortId())
        }
        messageIdsRef.current = messageIdsRef.current.slice(0, extracted.length)
        setLocalMessages(extracted)
      }
    },
    onGeneratedContent: (content) => {
      const validMessages = parseMessages(content)
      if (validMessages) {
        messageIdsRef.current = validMessages.map(() => generateShortId())
        setLocalMessages(validMessages)
        setMessages(validMessages)
      } else {
        // Fallback: treat as raw system prompt
        const trimmed = content.trim()
        if (trimmed) {
          const fallback: Message[] = [{ role: 'system', content: trimmed }]
          messageIdsRef.current = [generateShortId()]
          setLocalMessages(fallback)
          setMessages(fallback)
        }
      }
    },
  })

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
        messageIdsRef.current = previewValue.map(() => generateShortId())
        setLocalMessages(previewValue)
      }
    } else if (messages && Array.isArray(messages) && messages.length > 0) {
      if (!isEqual(localMessagesRef.current, messages)) {
        messageIdsRef.current = messages.map(() => generateShortId())
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

  /** Adds a new user message to the conversation. */
  const addMessage = () => {
    if (isPreview || disabled) return

    const newMessages = [...localMessages, { role: 'user' as const, content: '' }]
    messageIdsRef.current.push(generateShortId())
    setLocalMessages(newMessages)
    setMessages(newMessages)
  }

  /**
   * Deletes a message at the specified index
   */
  const deleteMessage = (index: number) => {
    if (isPreview || disabled || localMessages.length <= 1) return

    const newMessages = [...localMessages]
    newMessages.splice(index, 1)
    messageIdsRef.current.splice(index, 1)
    setLocalMessages(newMessages)
    setMessages(newMessages)
  }

  /** Duplicates a message immediately below the source message. */
  const duplicateMessage = (index: number) => {
    if (isPreview || disabled) return

    const sourceMessage = localMessages[index]
    if (!sourceMessage) return

    const newMessages = [...localMessages]
    newMessages.splice(index + 1, 0, { ...sourceMessage })
    messageIdsRef.current.splice(index + 1, 0, generateShortId())
    setLocalMessages(newMessages)
    setMessages(newMessages)
  }

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
      const tempId = messageIdsRef.current[index]
      messageIdsRef.current[index] = messageIdsRef.current[index - 1]
      messageIdsRef.current[index - 1] = tempId
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
      const tempId = messageIdsRef.current[index]
      messageIdsRef.current[index] = messageIdsRef.current[index + 1]
      messageIdsRef.current[index + 1] = tempId
      setLocalMessages(newMessages)
      setMessages(newMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

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
    <div className='flex w-full flex-col gap-2.5'>
      <div
        className={cn(
          'w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]',
          disabled && 'opacity-50'
        )}
      >
        {currentMessages.map((message, index) => (
          <div
            key={messageIdsRef.current[index] ?? `fallback-${index}`}
            className={cn(
              'relative flex w-full flex-col gap-2 p-2.5',
              index > 0 && 'border-[var(--border)] border-t'
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
              const workflowSearchHighlight = getActiveWorkflowSearchHighlight({
                activeSearchTarget,
                subBlockId,
                valuePath: [index, 'content'],
              })

              return (
                <>
                  <div
                    role='group'
                    aria-label={`Message ${index + 1}`}
                    className='flex cursor-pointer items-center justify-between'
                    onClick={(e) => handleHeaderClick(index, e)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        textareaRefs.current[fieldId]?.focus()
                      }
                    }}
                  >
                    <ChipSelect
                      options={[...MESSAGE_ROLE_OPTIONS]}
                      value={message.role}
                      onChange={(role) =>
                        updateMessageRole(index, role as 'system' | 'user' | 'assistant')
                      }
                      disabled={isPreview || disabled}
                      align='start'
                      aria-label={`Message ${index + 1} role`}
                    />

                    {!isPreview && !disabled && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='quiet'
                            size='icon'
                            onClick={(event: React.MouseEvent) => event.stopPropagation()}
                            aria-label={`Message ${index + 1} actions`}
                          >
                            <MoreHorizontal className='size-[14px]' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end' side='bottom'>
                          <DropdownMenuItem
                            disabled={index === 0}
                            onSelect={() => moveMessageUp(index)}
                          >
                            <ChevronUp />
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === currentMessages.length - 1}
                            onSelect={() => moveMessageDown(index)}
                          >
                            <ChevronDown />
                            Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => duplicateMessage(index)}>
                            <Duplicate />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={currentMessages.length <= 1}
                            onSelect={() => deleteMessage(index)}
                            className='[&_svg]:!text-[var(--text-error)] text-[var(--text-error)] focus:text-[var(--text-error)]'
                          >
                            <Trash />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  <ReferenceTextarea
                    ref={(element) => {
                      textareaRefs.current[fieldId] = element
                    }}
                    overlayRef={(element) => {
                      overlayRefs.current[fieldId] = element
                    }}
                    className='h-auto max-h-[192px] min-h-16 overflow-y-auto overflow-x-hidden'
                    overlayClassName='text-[var(--text-primary)] leading-[1.5]'
                    overlayContent={
                      <>
                        {formatDisplayText(message.content, {
                          accessiblePrefixes,
                          highlightAll: !accessiblePrefixes,
                          workflowSearchHighlight,
                        })}
                        {message.content.endsWith('\n') ? '\u200B' : null}
                      </>
                    }
                    interactiveOverlay={isPreview || disabled}
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
                    disabled={isPreview || disabled}
                    adornment={
                      <>
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
                      </>
                    }
                  />
                </>
              )
            })()}
          </div>
        ))}
      </div>
      {!isPreview && !disabled && (
        <Chip variant='border' leftIcon={Plus} onClick={addMessage}>
          Add message
        </Chip>
      )}
    </div>
  )
}
