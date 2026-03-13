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

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, AtSign, Loader2, Mic, Paperclip, Plus, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
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
import {
  type MentionFolderNav,
  MentionMenu,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components'
import { ContextPills } from './components'
import {
  useContextManagement,
  useFileAttachments,
  useMentionData,
  useMentionInsertHandlers,
  useMentionKeyboard,
  useMentionMenu,
  useMentionTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'
import { useAnimatedPlaceholder } from '../../hooks'

const TEXTAREA_BASE_CLASSES = cn(
  'm-0 box-border h-auto min-h-[24px] w-full resize-none',
  'overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent',
  'px-[4px] py-[4px] font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-transparent caret-[var(--text-primary)] outline-none',
  'placeholder:font-[380] placeholder:text-[var(--text-subtle)]',
  'focus-visible:ring-0 focus-visible:ring-offset-0',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

const OVERLAY_CLASSES = cn(
  'pointer-events-none absolute top-0 left-0 m-0 box-border h-auto w-full resize-none',
  'overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent',
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

export interface FileAttachmentForApi {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

interface UserInputProps {
  defaultValue?: string
  onSubmit: (text: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => void
  isSending: boolean
  onStopGeneration: () => void
  isInitialView?: boolean
  userId?: string
  onContextAdd?: (context: ChatContext) => void
}

export function UserInput({
  defaultValue = '',
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
  const [mentionFolderNav, setMentionFolderNav] = useState<MentionFolderNav | null>(null)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (defaultValue) setValue(defaultValue)
  }, [defaultValue])

  const animatedPlaceholder = useAnimatedPlaceholder(isInitialView)
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'

  const files = useFileAttachments({ userId: userId || session?.user?.id, disabled: false, isLoading: isSending })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)

  const contextManagement = useContextManagement({ message: value })

  const handleContextAdd = useCallback(
    (context: ChatContext) => {
      contextManagement.addContext(context)
      onContextAdd?.(context)
    },
    [contextManagement, onContextAdd]
  )

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

  const mentionData = useMentionData({
    workflowId: null,
    workspaceId,
  })

  const insertHandlers = useMentionInsertHandlers({
    mentionMenu,
    workflowId: null,
    selectedContexts: contextManagement.selectedContexts,
    onContextAdd: handleContextAdd,
    mentionFolderNav,
  })

  const mentionKeyboard = useMentionKeyboard({
    mentionMenu,
    mentionData,
    insertHandlers,
    mentionFolderNav,
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

  // Load mention data when menu is shown
  useEffect(() => {
    if (!mentionMenu.showMentionMenu || mentionFolderNav?.isInFolder) {
      return
    }

    const q = mentionMenu
      .getActiveMentionQueryAtPosition(mentionMenu.getCaretPos())
      ?.query.trim()
      .toLowerCase()

    if (q && q.length > 0) {
      void mentionData.ensurePastChatsLoaded()
      void mentionData.ensureKnowledgeLoaded()
      void mentionData.ensureBlocksLoaded()
      void mentionData.ensureTemplatesLoaded()
      void mentionData.ensureLogsLoaded()

      mentionMenu.setSubmenuActiveIndex(0)
      requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionMenu.showMentionMenu, mentionFolderNav?.isInFolder, value])

  useEffect(() => {
    if (mentionFolderNav?.isInFolder) {
      mentionMenu.setSubmenuActiveIndex(0)
      requestAnimationFrame(() => mentionMenu.scrollActiveItemIntoView(0))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionFolderNav?.isInFolder])

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    textareaRef.current?.focus()
  }, [textareaRef])

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
    mentionMenu.setShowMentionMenu(false)

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [onSubmit, files, value, contextManagement, mentionMenu, textareaRef])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && mentionMenu.showMentionMenu) {
        e.preventDefault()
        if (mentionFolderNav?.isInFolder) {
          mentionFolderNav.closeFolder()
          mentionMenu.setSubmenuQueryStart(null)
        } else {
          mentionMenu.closeMentionMenu()
        }
        return
      }

      if (mentionKeyboard.handleArrowNavigation(e)) return
      if (mentionKeyboard.handleArrowRight(e)) return
      if (mentionKeyboard.handleArrowLeft(e)) return

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        if (!mentionMenu.showMentionMenu) {
          if (!isSending) handleSubmit()
        } else {
          mentionKeyboard.handleEnterSelection(e)
        }
        return
      }

      if (!mentionMenu.showMentionMenu) {
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
      }
    },
    [handleSubmit, isSending, mentionMenu, mentionKeyboard, mentionTokensWithContext, value, textareaRef, mentionFolderNav]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setValue(newValue)

      const caret = e.target.selectionStart ?? newValue.length
      const activeMention = mentionMenu.getActiveMentionQueryAtPosition(caret, newValue)

      if (activeMention) {
        mentionMenu.setShowMentionMenu(true)
        mentionMenu.setInAggregated(false)
        if (mentionFolderNav?.isInFolder) {
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
    [mentionMenu, mentionFolderNav]
  )

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

  const insertTriggerAndOpenMenu = useCallback(() => {
    if (isSending) return
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.focus()
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const needsSpaceBefore = start > 0 && !/\s/.test(value.charAt(start - 1))

    const insertText = needsSpaceBefore ? ' @' : '@'
    const before = value.slice(0, start)
    const after = value.slice(end)
    setValue(`${before}${insertText}${after}`)

    setTimeout(() => {
      const newPos = before.length + insertText.length
      textarea.setSelectionRange(newPos, newPos)
      textarea.focus()
    }, 0)

    mentionMenu.setShowMentionMenu(true)
    mentionMenu.setOpenSubmenuFor(null)
    mentionMenu.setMentionActiveIndex(0)
    mentionMenu.setSubmenuActiveIndex(0)
  }, [isSending, textareaRef, value, mentionMenu])

  const handlePlusMenuSelect = useCallback((action: 'attachments' | 'resources') => {
    setPlusMenuOpen(false)
    if (action === 'attachments') {
      files.handleFileSelect()
    } else {
      insertTriggerAndOpenMenu()
    }
  }, [files, insertTriggerAndOpenMenu])

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

      elements.push(
        <span
          key={`mention-${i}-${range.start}-${range.end}`}
          className='rounded-[4px] bg-[rgba(50,189,126,0.65)] py-[1px]'
        >
          {range.token}
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
        'relative mx-auto w-full max-w-[42rem] cursor-text rounded-[20px] border border-[var(--border-1)] bg-[var(--white)] px-[10px] py-[8px] dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-sm'
      )}
      onDragEnter={files.handleDragEnter}
      onDragLeave={files.handleDragLeave}
      onDragOver={files.handleDragOver}
      onDrop={files.handleDrop}
    >
      {/* Context pills row */}
      {contextManagement.selectedContexts.length > 0 && (
        <div className='mb-[6px] flex flex-wrap items-center gap-[6px]'>
          <ContextPills
            contexts={contextManagement.selectedContexts}
            onRemoveContext={contextManagement.removeContext}
          />
        </div>
      )}

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

        {/* Mention Menu Portal */}
        {mentionMenu.showMentionMenu &&
          createPortal(
            <MentionMenu
              mentionMenu={mentionMenu}
              mentionData={mentionData}
              message={value}
              insertHandlers={insertHandlers}
              onFolderNavChange={setMentionFolderNav}
            />,
            document.body
          )}
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-[6px]'>
          <DropdownMenu open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className={cn(
                  'flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[#F0F0F0] transition-colors hover:bg-[#F7F7F7] dark:border-[#3d3d3d] dark:hover:bg-[#303030]',
                  isSending && 'cursor-not-allowed opacity-50'
                )}
                disabled={isSending}
                title='Add attachments or resources'
              >
                <Plus
                  className='h-[14px] w-[14px] text-[var(--text-muted)] dark:text-[var(--text-secondary)]'
                  strokeWidth={2}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' side='top' sideOffset={8}>
              <DropdownMenuItem onClick={() => handlePlusMenuSelect('attachments')}>
                <Paperclip className='h-[14px] w-[14px]' strokeWidth={2} />
                <span>Attachments</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePlusMenuSelect('resources')}>
                <AtSign className='h-[14px] w-[14px]' strokeWidth={2} />
                <span>Resources</span>
              </DropdownMenuItem>
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
                : 'text-[var(--text-muted)] hover:bg-[#F7F7F7] dark:text-[var(--text-secondary)] dark:hover:bg-[#303030]'
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
