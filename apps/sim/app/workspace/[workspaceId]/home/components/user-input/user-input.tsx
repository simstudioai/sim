'use client'

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onstart: ((ev: Event) => void) | null
  onend: ((ev: Event) => void) | null
  onresult: ((ev: SpeechRecognitionEvent) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognitionInstance
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionStatic
  webkitSpeechRecognition?: SpeechRecognitionStatic
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Loader2, Mic, Paperclip, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { Database, Plus, Sim, Table as TableIcon } from '@/components/emcn/icons'
import {
  AudioIcon,
  CsvIcon,
  DocxIcon,
  getDocumentIcon,
  JsonIcon,
  MarkdownIcon,
  PdfIcon,
  TxtIcon,
  VideoIcon,
  XlsxIcon,
} from '@/components/icons/document-icons'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  FileAttachmentForApi,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  useContextManagement,
  useFileAttachments,
  useMentionMenu,
  useMentionTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useAnimatedPlaceholder } from '../../hooks'

const TEXTAREA_BASE_CLASSES = cn(
  'm-0 box-border h-auto min-h-[24px] w-full resize-none',
  'overflow-y-auto overflow-x-hidden break-all border-0 bg-transparent',
  'px-[4px] py-[4px] font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-transparent caret-[var(--text-primary)] outline-none',
  'placeholder:font-[380] placeholder:text-[var(--text-subtle)]',
  'focus-visible:ring-0 focus-visible:ring-offset-0',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

const OVERLAY_CLASSES = cn(
  'pointer-events-none absolute top-0 left-0 m-0 box-border h-auto w-full resize-none',
  'overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all border-0 bg-transparent',
  'px-[4px] py-[4px] font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-[var(--text-primary)] outline-none',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

const SEND_BUTTON_BASE = 'h-[28px] w-[28px] rounded-full border-0 p-0 transition-colors'
const SEND_BUTTON_ACTIVE =
  'bg-[var(--c-383838)] hover:bg-[var(--c-575757)] dark:bg-[var(--c-E0E0E0)] dark:hover:bg-[var(--c-CFCFCF)]'
const SEND_BUTTON_DISABLED = 'bg-[var(--c-808080)] dark:bg-[var(--c-808080)]'

const MAX_CHAT_TEXTAREA_HEIGHT = 200

const DROP_OVERLAY_ICONS = [
  PdfIcon,
  DocxIcon,
  XlsxIcon,
  CsvIcon,
  TxtIcon,
  MarkdownIcon,
  JsonIcon,
  AudioIcon,
  VideoIcon,
] as const

function autoResizeTextarea(e: React.FormEvent<HTMLTextAreaElement>, maxHeight: number) {
  const target = e.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`
}

function mapResourceToContext(resource: MothershipResource): ChatContext {
  switch (resource.type) {
    case 'workflow':
      return {
        kind: 'workflow',
        workflowId: resource.id,
        label: resource.title,
      }
    case 'knowledgebase':
      return {
        kind: 'knowledge',
        knowledgeId: resource.id,
        label: resource.title,
      }
    case 'table':
      return { kind: 'table', tableId: resource.id, label: resource.title }
    case 'file':
      return { kind: 'file', fileId: resource.id, label: resource.title }
    default:
      return { kind: 'docs', label: resource.title }
  }
}

export type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'

interface UserInputProps {
  defaultValue?: string
  editValue?: string
  onEditValueConsumed?: () => void
  onSubmit: (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => void
  isSending: boolean
  onStopGeneration: () => void
  isInitialView?: boolean
  userId?: string
  onContextAdd?: (context: ChatContext) => void
}

export function UserInput({
  defaultValue = '',
  editValue,
  onEditValueConsumed,
  onSubmit,
  isSending,
  onStopGeneration,
  isInitialView = true,
  userId,
  onContextAdd,
}: UserInputProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: session } = useSession()
  const [value, setValue] = useState(defaultValue)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [plusMenuSearch, setPlusMenuSearch] = useState('')
  const [plusMenuActiveIndex, setPlusMenuActiveIndex] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)

  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue)
  if (defaultValue && defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
    setValue(defaultValue)
  } else if (!defaultValue && prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
  }

  const [prevEditValue, setPrevEditValue] = useState(editValue)
  if (editValue && editValue !== prevEditValue) {
    setPrevEditValue(editValue)
    setValue(editValue)
  } else if (!editValue && prevEditValue) {
    setPrevEditValue(editValue)
  }

  useEffect(() => {
    if (editValue) onEditValueConsumed?.()
  }, [editValue, onEditValueConsumed])

  const animatedPlaceholder = useAnimatedPlaceholder(isInitialView)
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'

  const files = useFileAttachments({
    userId: userId || session?.user?.id,
    workspaceId,
    disabled: false,
    isLoading: isSending,
  })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)

  const contextManagement = useContextManagement({ message: value })

  const handleContextAdd = useCallback(
    (context: ChatContext) => {
      contextManagement.addContext(context)
      onContextAdd?.(context)
    },
    [contextManagement, onContextAdd]
  )

  const existingResourceKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const ctx of contextManagement.selectedContexts) {
      if (ctx.kind === 'workflow' && ctx.workflowId) keys.add(`workflow:${ctx.workflowId}`)
      if (ctx.kind === 'knowledge' && ctx.knowledgeId) keys.add(`knowledgebase:${ctx.knowledgeId}`)
      if (ctx.kind === 'table' && ctx.tableId) keys.add(`table:${ctx.tableId}`)
      if (ctx.kind === 'file' && ctx.fileId) keys.add(`file:${ctx.fileId}`)
    }
    return keys
  }, [contextManagement.selectedContexts])

  const availableResources = useAvailableResources(workspaceId, existingResourceKeys)

  const filteredPlusMenuItems = useMemo(() => {
    const q = plusMenuSearch.toLowerCase().trim()
    if (!q) return null
    return availableResources.flatMap(({ type, items }) =>
      items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => ({ type, item }))
    )
  }, [plusMenuSearch, availableResources])

  const mentionMenu = useMentionMenu({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    onContextSelect: handleContextAdd,
    onMessageChange: setValue,
  })

  const mentionTokensWithContext = useMentionTokens({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    mentionMenu,
    setMessage: setValue,
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  const canSubmit = (value.trim().length > 0 || hasFiles) && !isSending

  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const prefixRef = useRef('')

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const textareaRef = mentionMenu.textareaRef
  const wasSendingRef = useRef(false)
  const atInsertPosRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    if (overlayRef.current) {
      overlayRef.current.scrollTop = textarea.scrollTop
    }
  }, [value, isInitialView, textareaRef])

  const handleResourceSelect = useCallback(
    (resource: MothershipResource) => {
      const textarea = textareaRef.current
      if (textarea) {
        const insertAt = atInsertPosRef.current ?? textarea.selectionStart ?? value.length
        atInsertPosRef.current = null

        const needsSpaceBefore = insertAt > 0 && !/\s/.test(value.charAt(insertAt - 1))
        const insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
        const before = value.slice(0, insertAt)
        const after = value.slice(insertAt)
        const newPos = before.length + insertText.length
        pendingCursorRef.current = newPos
        setValue(`${before}${insertText}${after}`)
      }

      const context = mapResourceToContext(resource)
      handleContextAdd(context)
      setPlusMenuOpen(false)
    },
    [textareaRef, value, handleContextAdd]
  )

  const handlePlusMenuSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const items = filteredPlusMenuItems
      if (!items) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPlusMenuActiveIndex((prev) => Math.min(prev + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPlusMenuActiveIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items.length > 0 && items[plusMenuActiveIndex]) {
          const { type, item } = items[plusMenuActiveIndex]
          handleResourceSelect({ type, id: item.id, title: item.name })
          setPlusMenuOpen(false)
          setPlusMenuSearch('')
          setPlusMenuActiveIndex(0)
        }
      }
    },
    [filteredPlusMenuItems, plusMenuActiveIndex, handleResourceSelect]
  )

  const handleContainerDragOver = useCallback(
    (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('application/x-sim-resource')) {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        return
      }
      files.handleDragOver(e)
    },
    [files]
  )

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      const resourceJson = e.dataTransfer.getData('application/x-sim-resource')
      if (resourceJson) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const resource = JSON.parse(resourceJson) as MothershipResource
          handleResourceSelect(resource)
        } catch {
          // Invalid JSON — ignore
        }
        return
      }
      files.handleDrop(e)
    },
    [handleResourceSelect, files]
  )

  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      textareaRef.current?.focus()
    }
    wasSendingRef.current = isSending
  }, [isSending, textareaRef])

  useEffect(() => {
    if (isInitialView) {
      textareaRef.current?.focus()
    }
  }, [isInitialView, textareaRef])

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return
      textareaRef.current?.focus()
    },
    [textareaRef]
  )

  const handleSubmit = useCallback(() => {
    const fileAttachmentsForApi: FileAttachmentForApi[] = files.attachedFiles
      .filter((f) => !f.uploading && f.key)
      .map((f) => ({
        id: f.id,
        key: f.key!,
        filename: f.name,
        media_type: f.type,
        size: f.size,
      }))

    onSubmit(
      value,
      fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined,
      contextManagement.selectedContexts.length > 0 ? contextManagement.selectedContexts : undefined
    )
    setValue('')
    files.clearAttachedFiles()
    contextManagement.clearContexts()

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [onSubmit, files, value, contextManagement, textareaRef])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSubmit()
        return
      }

      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectionLength > 0) {
          mentionTokensWithContext.removeContextsInSelection(selStart, selEnd)
        } else {
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
            const nextPos = Math.min(value.length, selStart + 1)
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
    },
    [handleSubmit, mentionTokensWithContext, value, textareaRef]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const caret = e.target.selectionStart ?? newValue.length

    if (
      caret > 0 &&
      newValue.charAt(caret - 1) === '@' &&
      (caret === 1 || /\s/.test(newValue.charAt(caret - 2)))
    ) {
      const before = newValue.slice(0, caret - 1)
      const after = newValue.slice(caret)
      setValue(`${before}${after}`)
      atInsertPosRef.current = caret - 1
      setPlusMenuOpen(true)
      setPlusMenuSearch('')
      setPlusMenuActiveIndex(0)
      return
    }

    setValue(newValue)
  }, [])

  const handleSelectAdjust = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart ?? 0
    const r = mentionTokensWithContext.findRangeContaining(pos)
    if (r) {
      const snapPos = pos - r.start < r.end - pos ? r.start : r.end
      setTimeout(() => {
        textarea.setSelectionRange(snapPos, snapPos)
      }, 0)
    }
  }, [textareaRef, mentionTokensWithContext])

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
      autoResizeTextarea(e, maxHeight)

      // Sync overlay scroll
      if (overlayRef.current) {
        overlayRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
      }
    },
    [isInitialView]
  )

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      setIsListening(false)
      return
    }

    const w = window as WindowWithSpeech
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    prefixRef.current = value

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      const prefix = prefixRef.current
      setValue(prefix ? `${prefix} ${transcript}` : transcript)
    }

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try {
          recognition.start()
        } catch {
          recognitionRef.current = null
          setIsListening(false)
        }
      }
    }
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'aborted' || e.error === 'not-allowed') {
        recognitionRef.current = null
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [isListening, value])

  const renderOverlayContent = useCallback(() => {
    const contexts = contextManagement.selectedContexts

    if (!value) {
      return <span>{'\u00A0'}</span>
    }

    if (contexts.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const tokens = extractContextTokens(contexts)
    const ranges = computeMentionHighlightRanges(value, tokens)

    if (ranges.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const elements: React.ReactNode[] = []
    let lastIndex = 0

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]

      if (range.start > lastIndex) {
        const before = value.slice(lastIndex, range.start)
        elements.push(<span key={`text-${i}-${lastIndex}-${range.start}`}>{before}</span>)
      }

      const mentionLabel =
        range.token.startsWith('@') || range.token.startsWith('/')
          ? range.token.slice(1)
          : range.token
      const matchingCtx = contexts.find((c) => c.label === mentionLabel)

      let mentionIconNode: React.ReactNode = null
      if (matchingCtx) {
        const iconClasses = 'absolute inset-0 m-auto h-[12px] w-[12px] text-[var(--text-icon)]'
        switch (matchingCtx.kind) {
          case 'workflow':
          case 'current_workflow': {
            const wfId = (matchingCtx as { workflowId: string }).workflowId
            const wfColor = useWorkflowRegistry.getState().workflows[wfId]?.color ?? '#888'
            mentionIconNode = (
              <div
                className='absolute inset-0 m-auto h-[12px] w-[12px] rounded-[3px] border-[2px]'
                style={{
                  backgroundColor: wfColor,
                  borderColor: `${wfColor}60`,
                  backgroundClip: 'padding-box',
                }}
              />
            )
            break
          }
          case 'knowledge':
            mentionIconNode = <Database className={iconClasses} />
            break
          case 'table':
            mentionIconNode = <TableIcon className={iconClasses} />
            break
          case 'file': {
            const FileDocIcon = getDocumentIcon('', mentionLabel)
            mentionIconNode = <FileDocIcon className={iconClasses} />
            break
          }
        }
      }

      elements.push(
        <span
          key={`mention-${i}-${range.start}-${range.end}`}
          className='rounded-[5px] bg-[var(--surface-5)] py-[2px]'
          style={{
            boxShadow: '-2px 0 0 var(--surface-5), 2px 0 0 var(--surface-5)',
          }}
        >
          <span className='relative'>
            <span className='invisible'>{range.token.charAt(0)}</span>
            {mentionIconNode}
          </span>
          {mentionLabel}
        </span>
      )
      lastIndex = range.end
    }

    const tail = value.slice(lastIndex)
    if (tail) {
      const displayTail = tail.endsWith('\n') ? `${tail}\u200B` : tail
      elements.push(<span key={`tail-${lastIndex}`}>{displayTail}</span>)
    }

    return elements.length > 0 ? elements : <span>{'\u00A0'}</span>
  }, [value, contextManagement.selectedContexts])

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        'relative z-10 mx-auto w-full max-w-[42rem] cursor-text rounded-[20px] border border-[var(--border-1)] bg-[var(--white)] px-[10px] py-[8px] dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-sm'
      )}
      onDragEnter={files.handleDragEnter}
      onDragLeave={files.handleDragLeave}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      {/* Attached files */}
      {files.attachedFiles.length > 0 && (
        <div className='mb-[6px] flex flex-wrap gap-[6px]'>
          {files.attachedFiles.map((file) => {
            const isImage = file.type.startsWith('image/')
            return (
              <Tooltip.Root key={file.id}>
                <Tooltip.Trigger asChild>
                  <div
                    className='group relative h-[56px] w-[56px] flex-shrink-0 cursor-pointer overflow-hidden rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)] hover:bg-[var(--surface-4)]'
                    onClick={() => files.handleFileClick(file)}
                  >
                    {isImage && file.previewUrl ? (
                      <img
                        src={file.previewUrl}
                        alt={file.name}
                        className='h-full w-full object-cover'
                      />
                    ) : (
                      <div className='flex h-full w-full flex-col items-center justify-center gap-[2px] text-[var(--text-icon)]'>
                        {(() => {
                          const Icon = getDocumentIcon(file.type, file.name)
                          return <Icon className='h-[18px] w-[18px]' />
                        })()}
                        <span className='max-w-[48px] truncate px-[2px] text-[9px] text-[var(--text-muted)]'>
                          {file.name.split('.').pop()}
                        </span>
                      </div>
                    )}
                    {file.uploading && (
                      <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                        <Loader2 className='h-[14px] w-[14px] animate-spin text-white' />
                      </div>
                    )}
                    {!file.uploading && (
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation()
                          files.removeFile(file.id)
                        }}
                        className='absolute top-[2px] right-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100'
                      >
                        <X className='h-[10px] w-[10px] text-white' />
                      </button>
                    )}
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  <p className='max-w-[200px] truncate'>{file.name}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            )
          })}
        </div>
      )}

      {/* Textarea with overlay for highlighting */}
      <div className='relative'>
        {/* Highlight overlay */}
        <div
          ref={overlayRef}
          className={cn(OVERLAY_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
          aria-hidden='true'
        >
          {renderOverlayContent()}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onCut={mentionTokensWithContext.handleCut}
          onSelect={handleSelectAdjust}
          onMouseUp={handleSelectAdjust}
          onScroll={(e) => {
            if (overlayRef.current) {
              overlayRef.current.scrollTop = e.currentTarget.scrollTop
            }
          }}
          placeholder={placeholder}
          rows={1}
          className={cn(TEXTAREA_BASE_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
        />
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-[6px]'>
          <DropdownMenu
            open={plusMenuOpen}
            onOpenChange={(open) => {
              setPlusMenuOpen(open)
              if (!open) {
                setPlusMenuSearch('')
                setPlusMenuActiveIndex(0)
                atInsertPosRef.current = null
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[#F0F0F0] transition-colors hover:bg-[#F7F7F7] dark:border-[#3d3d3d] dark:hover:bg-[#303030]'
                title='Add attachments or resources'
              >
                <Plus className='h-[16px] w-[16px] text-[var(--text-icon)]' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='top'
              sideOffset={8}
              className='flex w-[240px] flex-col overflow-hidden'
              onCloseAutoFocus={(e) => {
                e.preventDefault()
                const textarea = textareaRef.current
                if (!textarea) return
                if (pendingCursorRef.current !== null) {
                  textarea.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
                  pendingCursorRef.current = null
                }
                textarea.focus()
              }}
            >
              <DropdownMenuSearchInput
                placeholder='Search resources...'
                value={plusMenuSearch}
                onChange={(e) => {
                  setPlusMenuSearch(e.target.value)
                  setPlusMenuActiveIndex(0)
                }}
                onKeyDown={handlePlusMenuSearchKeyDown}
              />
              <div className='min-h-0 flex-1 overflow-y-auto'>
                {filteredPlusMenuItems ? (
                  filteredPlusMenuItems.length > 0 ? (
                    filteredPlusMenuItems.map(({ type, item }, index) => {
                      const config = getResourceConfig(type)
                      return (
                        <DropdownMenuItem
                          key={`${type}:${item.id}`}
                          className={cn(
                            index === plusMenuActiveIndex && 'bg-[var(--surface-active)]'
                          )}
                          onMouseEnter={() => setPlusMenuActiveIndex(index)}
                          onClick={() => {
                            handleResourceSelect({
                              type,
                              id: item.id,
                              title: item.name,
                            })
                            setPlusMenuOpen(false)
                            setPlusMenuSearch('')
                            setPlusMenuActiveIndex(0)
                          }}
                        >
                          {config.renderDropdownItem({ item })}
                          <span className='ml-auto pl-[8px] text-[11px] text-[var(--text-tertiary)]'>
                            {config.label}
                          </span>
                        </DropdownMenuItem>
                      )
                    })
                  ) : (
                    <div className='px-[8px] py-[5px] text-center font-medium text-[12px] text-[var(--text-tertiary)]'>
                      No results
                    </div>
                  )
                ) : (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        setPlusMenuOpen(false)
                        files.handleFileSelect()
                      }}
                    >
                      <Paperclip className='h-[14px] w-[14px]' strokeWidth={2} />
                      <span>Attachments</span>
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Sim className='h-[14px] w-[14px]' fill='currentColor' />
                        <span>Workspace</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {availableResources.map(({ type, items }) => {
                          if (items.length === 0) return null
                          const config = getResourceConfig(type)
                          const Icon = config.icon
                          return (
                            <DropdownMenuSub key={type}>
                              <DropdownMenuSubTrigger>
                                {type === 'workflow' ? (
                                  <div
                                    className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                                    style={{
                                      backgroundColor: '#808080',
                                      borderColor: '#80808060',
                                      backgroundClip: 'padding-box',
                                    }}
                                  />
                                ) : (
                                  <Icon className='h-[14px] w-[14px]' />
                                )}
                                <span>{config.label}</span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {items.map((item) => (
                                  <DropdownMenuItem
                                    key={item.id}
                                    onClick={() => {
                                      handleResourceSelect({
                                        type,
                                        id: item.id,
                                        title: item.name,
                                      })
                                      setPlusMenuOpen(false)
                                    }}
                                  >
                                    {config.renderDropdownItem({ item })}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )
                        })}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className='flex items-center gap-[6px]'>
          <button
            type='button'
            onClick={toggleListening}
            className={cn(
              'flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors',
              isListening
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-[var(--text-icon)] hover:bg-[#F7F7F7] dark:hover:bg-[#303030]'
            )}
            title={isListening ? 'Stop listening' : 'Voice input'}
          >
            <Mic className='h-[16px] w-[16px]' strokeWidth={2} />
          </button>
          {isSending ? (
            <Button
              onClick={onStopGeneration}
              className={cn(SEND_BUTTON_BASE, SEND_BUTTON_ACTIVE)}
              title='Stop generation'
            >
              <svg
                className='block h-[14px] w-[14px] fill-white dark:fill-black'
                viewBox='0 0 24 24'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
              </svg>
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                SEND_BUTTON_BASE,
                canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED
              )}
            >
              <ArrowUp
                className='block h-[16px] w-[16px] text-white dark:text-black'
                strokeWidth={2.25}
              />
            </Button>
          )}
        </div>
      </div>

      <input
        ref={files.fileInputRef}
        type='file'
        onChange={files.handleFileChange}
        className='hidden'
        accept={CHAT_ACCEPT_ATTRIBUTE}
        multiple
      />

      {files.isDragging && (
        <div className='pointer-events-none absolute inset-[6px] z-10 flex items-center justify-center rounded-[14px] border-[1.5px] border-[var(--border-1)] border-dashed bg-[var(--white)] dark:bg-[var(--surface-4)]'>
          <div className='flex flex-col items-center gap-[8px]'>
            <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Drop files</span>
            <div className='flex items-center gap-[8px] text-[var(--text-icon)]'>
              {DROP_OVERLAY_ICONS.map((Icon, i) => (
                <Icon key={i} className='h-[14px] w-[14px]' />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
