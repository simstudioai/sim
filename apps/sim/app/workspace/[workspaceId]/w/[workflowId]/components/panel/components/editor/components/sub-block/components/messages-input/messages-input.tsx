import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import { isEqual } from 'lodash'
import { ArrowLeftRight, ChevronDown, ChevronsUpDown, ChevronUp, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { cn } from '@/lib/core/utils/cn'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { FileUpload } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/file-upload/file-upload'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input/short-input'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('MessagesInput')

const MIN_TEXTAREA_HEIGHT_PX = 80

/** Workspace file record from API */
interface WorkspaceFile {
  id: string
  name: string
  path: string
  type: string
}
const MAX_TEXTAREA_HEIGHT_PX = 320

/** Pattern to match complete message objects in JSON */
const COMPLETE_MESSAGE_PATTERN =
  /"role"\s*:\s*"(system|user|assistant|media)"[^}]*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g

/** Pattern to match incomplete content at end of buffer */
const INCOMPLETE_CONTENT_PATTERN = /"content"\s*:\s*"((?:[^"\\]|\\.)*)$/

/** Pattern to match role before content */
const ROLE_BEFORE_CONTENT_PATTERN = /"role"\s*:\s*"(system|user|assistant|media)"[^{]*$/

/**
 * Unescapes JSON string content
 */
const unescapeContent = (str: string): string =>
  str.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')

/**
 * Media content for multimodal messages
 */
interface MediaContent {
  /** Source type: how the data was provided */
  sourceType: 'url' | 'base64' | 'file'
  /** The URL or base64 data */
  data: string
  /** MIME type (e.g., 'image/png', 'application/pdf', 'audio/mp3') */
  mimeType?: string
  /** Optional filename for file uploads */
  fileName?: string
  /** Optional workspace file ID (used by wand to select existing files) */
  fileId?: string
}

/**
 * Interface for individual message in the messages array
 */
interface Message {
  role: 'system' | 'user' | 'assistant' | 'media'
  content: string
  media?: MediaContent
}

/**
 * Props for the MessagesInput component
 */
interface MessagesInputProps {
  blockId: string
  subBlockId: string
  config: SubBlockConfig
  isPreview?: boolean
  previewValue?: Message[] | null
  disabled?: boolean
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
}

/**
 * MessagesInput component for managing LLM message history
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
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const [messages, setMessages] = useSubBlockValue<Message[]>(blockId, subBlockId, false)
  const [localMessages, setLocalMessages] = useState<Message[]>([{ role: 'user', content: '' }])
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const [openPopoverIndex, setOpenPopoverIndex] = useState<number | null>(null)
  const { activeWorkflowId } = useWorkflowRegistry()

  // Local media mode state - basic = FileUpload, advanced = URL/base64 textarea
  const [mediaMode, setMediaMode] = useState<'basic' | 'advanced'>('basic')

  // Workspace files for wand context
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])

  // Fetch workspace files for wand context
  const loadWorkspaceFiles = useCallback(async () => {
    if (!workspaceId || isPreview) return

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/files`)
      const data = await response.json()
      if (data.success) {
        setWorkspaceFiles(data.files || [])
      }
    } catch (error) {
      logger.error('Error loading workspace files:', error)
    }
  }, [workspaceId, isPreview])

  // Load workspace files on mount
  useEffect(() => {
    void loadWorkspaceFiles()
  }, [loadWorkspaceFiles])

  // Build sources string for wand - available workspace files
  const sourcesInfo = useMemo(() => {
    if (workspaceFiles.length === 0) {
      return 'No workspace files available. The user can upload files manually after generation.'
    }

    const filesList = workspaceFiles
      .filter(
        (f) =>
          f.type.startsWith('image/') ||
          f.type.startsWith('audio/') ||
          f.type.startsWith('video/') ||
          f.type === 'application/pdf'
      )
      .map((f) => `  - id: "${f.id}", name: "${f.name}", type: "${f.type}"`)
      .join('\n')

    if (!filesList) {
      return 'No media files in workspace. The user can upload files manually after generation.'
    }

    return `AVAILABLE WORKSPACE FILES (optional - you don't have to select one):\n${filesList}\n\nTo use a file, include "fileId": "<id>" in the media object. If not selecting a file, omit the fileId field.`
  }, [workspaceFiles])

  // Get indices of media messages for subscription
  const mediaIndices = useMemo(
    () =>
      localMessages
        .map((msg, index) => (msg.role === 'media' ? index : -1))
        .filter((i) => i !== -1),
    [localMessages]
  )

  // Subscribe to file upload values for all media messages
  const fileUploadValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return {}
        const blockValues = state.workflowValues[activeWorkflowId]?.[blockId] ?? {}
        const result: Record<number, { name: string; path: string; type: string; size: number }> =
          {}
        for (const index of mediaIndices) {
          const fileUploadKey = `${subBlockId}-media-${index}`
          const fileValue = blockValues[fileUploadKey]
          if (fileValue && typeof fileValue === 'object' && 'path' in fileValue) {
            result[index] = fileValue as { name: string; path: string; type: string; size: number }
          }
        }
        return result
      },
      [activeWorkflowId, blockId, subBlockId, mediaIndices]
    )
  )

  // Effect to sync FileUpload values to message media objects
  useEffect(() => {
    if (!activeWorkflowId || isPreview) return

    let hasChanges = false
    const updatedMessages = localMessages.map((msg, index) => {
      if (msg.role !== 'media') return msg

      const uploadedFile = fileUploadValues[index]
      if (uploadedFile) {
        const newMedia: MediaContent = {
          sourceType: 'file',
          data: uploadedFile.path,
          mimeType: uploadedFile.type,
          fileName: uploadedFile.name,
        }

        // Only update if different
        if (
          msg.media?.data !== newMedia.data ||
          msg.media?.sourceType !== newMedia.sourceType ||
          msg.media?.mimeType !== newMedia.mimeType ||
          msg.media?.fileName !== newMedia.fileName
        ) {
          hasChanges = true
          return {
            ...msg,
            content: uploadedFile.name || msg.content,
            media: newMedia,
          }
        }
      }

      return msg
    })

    if (hasChanges) {
      setLocalMessages(updatedMessages)
      setMessages(updatedMessages)
    }
  }, [activeWorkflowId, localMessages, isPreview, setMessages, fileUploadValues])

  const subBlockInput = useSubBlockInput({
    blockId,
    subBlockId,
    config,
    isPreview,
    disabled,
  })

  const getMessagesJson = useCallback((): string => {
    if (localMessages.length === 0) return ''
    const nonEmptyMessages = localMessages.filter((m) => m.content.trim() !== '')
    if (nonEmptyMessages.length === 0) return ''
    return JSON.stringify(nonEmptyMessages, null, 2)
  }, [localMessages])

  const streamBufferRef = useRef<string>('')

  const parseMessages = useCallback((content: string): Message[] | null => {
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        const validMessages: Message[] = parsed
          .filter(
            (m): m is { role: string; content: string; media?: MediaContent } =>
              typeof m === 'object' &&
              m !== null &&
              typeof m.role === 'string' &&
              typeof m.content === 'string'
          )
          .map((m) => {
            const role = ['system', 'user', 'assistant', 'media'].includes(m.role) ? m.role : 'user'
            const message: Message = {
              role: role as Message['role'],
              content: m.content,
            }
            if (m.media) {
              message.media = m.media
            }
            return message
          })
        return validMessages.length > 0 ? validMessages : null
      }
    } catch {
      // Parsing failed
    }
    return null
  }, [])

  const extractStreamingMessages = useCallback(
    (buffer: string): Message[] => {
      const complete = parseMessages(buffer)
      if (complete) return complete

      const result: Message[] = []

      COMPLETE_MESSAGE_PATTERN.lastIndex = 0
      let match
      while ((match = COMPLETE_MESSAGE_PATTERN.exec(buffer)) !== null) {
        result.push({ role: match[1] as Message['role'], content: unescapeContent(match[2]) })
      }

      const lastContentIdx = buffer.lastIndexOf('"content"')
      if (lastContentIdx !== -1) {
        const tail = buffer.slice(lastContentIdx)
        const incomplete = tail.match(INCOMPLETE_CONTENT_PATTERN)
        if (incomplete) {
          const head = buffer.slice(0, lastContentIdx)
          const roleMatch = head.match(ROLE_BEFORE_CONTENT_PATTERN)
          if (roleMatch) {
            const content = unescapeContent(incomplete[1])
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
    sources: sourcesInfo,
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
        // Process media messages - only allow fileId to set files, sanitize other attempts
        validMessages.forEach((msg, index) => {
          if (msg.role === 'media') {
            // Check if this is an existing file with valid data (preserve it)
            const hasExistingFile =
              msg.media?.sourceType === 'file' &&
              msg.media?.data?.startsWith('/api/') &&
              msg.media?.fileName

            if (hasExistingFile) {
              // Preserve existing file data as-is
              return
            }

            // Check if wand provided a fileId to select a workspace file
            if (msg.media?.fileId) {
              const file = workspaceFiles.find((f) => f.id === msg.media?.fileId)
              if (file) {
                // Set the file value in SubBlockStore so FileUpload picks it up
                const fileUploadKey = `${subBlockId}-media-${index}`
                const uploadedFile = {
                  name: file.name,
                  path: file.path,
                  type: file.type,
                  size: 0, // Size not available from workspace files list
                }
                useSubBlockStore.getState().setValue(blockId, fileUploadKey, uploadedFile)

                // Clear the media object - the FileUpload will sync the file data via useEffect
                // DON'T set media.data here as it would appear in the ShortInput (advanced mode)
                msg.media = undefined
                return
              }
            }

            // Sanitize: clear any media object that isn't a valid existing file or fileId match
            // This prevents the LLM from setting arbitrary data/variable references
            msg.media = undefined
          }
        })

        setLocalMessages(validMessages)
        setMessages(validMessages)
      } else {
        const trimmed = content.trim()
        if (trimmed) {
          const fallback: Message[] = [{ role: 'system', content: trimmed }]
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
        setLocalMessages(previewValue)
      }
    } else if (messages && Array.isArray(messages) && messages.length > 0) {
      if (!isEqual(localMessagesRef.current, messages)) {
        setLocalMessages(messages)
      }
    }
  }, [isPreview, previewValue, messages])

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

  const updateMessageRole = useCallback(
    (index: number, role: 'system' | 'user' | 'assistant' | 'media') => {
      if (isPreview || disabled) return

      const updatedMessages = [...localMessages]
      if (role === 'media') {
        updatedMessages[index] = {
          ...updatedMessages[index],
          role,
          content: updatedMessages[index].content || '',
          media: updatedMessages[index].media || {
            sourceType: 'file',
            data: '',
          },
        }
      } else {
        const { media: _, ...rest } = updatedMessages[index]
        updatedMessages[index] = {
          ...rest,
          role,
        }
      }
      setLocalMessages(updatedMessages)
      setMessages(updatedMessages)
    },
    [localMessages, setMessages, isPreview, disabled]
  )

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

  const formatRole = (role: string): string => {
    return role.charAt(0).toUpperCase() + role.slice(1)
  }

  const handleHeaderClick = useCallback((index: number, e: React.MouseEvent) => {
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
                  <div className='flex items-center'>
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
                          {(['system', 'user', 'assistant', 'media'] as const).map((role) => (
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
                  </div>

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
                      {/* Mode toggle for media messages */}
                      {message.role === 'media' && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              variant='ghost'
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                setMediaMode((m) => (m === 'basic' ? 'advanced' : 'basic'))
                              }}
                              disabled={disabled}
                              className='-my-1 -mr-1 h-6 w-6 p-0'
                              aria-label={
                                mediaMode === 'advanced'
                                  ? 'Switch to file upload'
                                  : 'Switch to URL/text input'
                              }
                            >
                              <ArrowLeftRight
                                className={cn(
                                  'h-3 w-3',
                                  mediaMode === 'advanced'
                                    ? 'text-[var(--text-primary)]'
                                    : 'text-[var(--text-secondary)]'
                                )}
                              />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content side='top'>
                            <p>
                              {mediaMode === 'advanced'
                                ? 'Switch to file upload'
                                : 'Switch to URL/text input'}
                            </p>
                          </Tooltip.Content>
                        </Tooltip.Root>
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

                {/* Content Input - different for media vs text messages */}
                {message.role === 'media' ? (
                  <div className='relative w-full px-[8px] py-[8px]'>
                    {mediaMode === 'basic' ? (
                      <FileUpload
                        blockId={blockId}
                        subBlockId={`${subBlockId}-media-${index}`}
                        acceptedTypes='image/*,audio/*,video/*,application/pdf,.doc,.docx,.txt'
                        multiple={false}
                        isPreview={isPreview}
                        disabled={disabled}
                      />
                    ) : (
                      <ShortInput
                        blockId={blockId}
                        subBlockId={`${subBlockId}-media-ref-${index}`}
                        placeholder='Reference file from previous block...'
                        config={{
                          id: `${subBlockId}-media-ref-${index}`,
                          type: 'short-input',
                        }}
                        value={
                          // Only show value for variable references, not file uploads
                          message.media?.sourceType === 'file' ? '' : message.media?.data || ''
                        }
                        onChange={(newValue: string) => {
                          const updatedMessages = [...localMessages]
                          if (updatedMessages[index].role === 'media') {
                            // Determine sourceType based on content
                            let sourceType: 'url' | 'base64' = 'url'
                            if (newValue.startsWith('data:') || newValue.includes(';base64,')) {
                              sourceType = 'base64'
                            }
                            updatedMessages[index] = {
                              ...updatedMessages[index],
                              content: newValue.substring(0, 50),
                              media: {
                                ...updatedMessages[index].media,
                                sourceType,
                                data: newValue,
                              },
                            }
                            setLocalMessages(updatedMessages)
                            setMessages(updatedMessages)
                          }
                        }}
                        isPreview={isPreview}
                        disabled={disabled}
                      />
                    )}
                  </div>
                ) : (
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
                )}
              </>
            )
          })()}
        </div>
      ))}
    </div>
  )
}
