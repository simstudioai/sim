'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, FileText, Loader2, Mic, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { useAnimatedPlaceholder } from '../../hooks'

const TEXTAREA_BASE_CLASSES = cn(
  'm-0 box-border h-auto min-h-[24px] w-full resize-none',
  'overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent',
  'px-[4px] py-[4px] font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-[var(--text-primary)] outline-none',
  'placeholder:font-[380] placeholder:text-[var(--text-subtle)]',
  'focus-visible:ring-0 focus-visible:ring-offset-0',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

const SEND_BUTTON_BASE = 'h-[28px] w-[28px] rounded-full border-0 p-0 transition-colors'
const SEND_BUTTON_ACTIVE =
  'bg-[var(--c-383838)] hover:bg-[var(--c-575757)] dark:bg-[var(--c-E0E0E0)] dark:hover:bg-[var(--c-CFCFCF)]'
const SEND_BUTTON_DISABLED = 'bg-[var(--c-808080)] dark:bg-[var(--c-808080)]'

const MAX_CHAT_TEXTAREA_HEIGHT = 200 // 8 lines × 24px line-height + 8px padding

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
  onSubmit: (text: string, fileAttachments?: FileAttachmentForApi[]) => void
  isSending: boolean
  onStopGeneration: () => void
  isInitialView?: boolean
  userId?: string
}

export function UserInput({
  defaultValue = '',
  onSubmit,
  isSending,
  onStopGeneration,
  isInitialView = true,
  userId,
}: UserInputProps) {
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    if (defaultValue) setValue(defaultValue)
  }, [defaultValue])

  const animatedPlaceholder = useAnimatedPlaceholder(isInitialView)
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'

  const files = useFileAttachments({ userId, disabled: false, isLoading: isSending })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)
  const canSubmit = (value.trim().length > 0 || hasFiles) && !isSending

  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const prefixRef = useRef('')

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wasSendingRef = useRef(false)

  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      textareaRef.current?.focus()
    }
    wasSendingRef.current = isSending
  }, [isSending])

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    textareaRef.current?.focus()
  }, [])

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

    onSubmit(value, fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined)
    setValue('')
    files.clearAttachedFiles()

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [onSubmit, files, value])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isSending) handleSubmit()
      }
    },
    [handleSubmit, isSending]
  )

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
      autoResizeTextarea(e, maxHeight)
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

    const w = window as Window & {
      SpeechRecognition?: typeof SpeechRecognition
      webkitSpeechRecognition?: typeof SpeechRecognition
    }
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

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        'mx-auto w-full max-w-[42rem] cursor-text rounded-[20px] border border-[var(--border-1)] bg-[var(--white)] px-[10px] py-[8px] dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-sm',
        files.isDragging && 'ring-[1.75px] ring-[var(--brand-secondary)]'
      )}
      onDragEnter={files.handleDragEnter}
      onDragLeave={files.handleDragLeave}
      onDragOver={files.handleDragOver}
      onDrop={files.handleDrop}
    >
      {/* Attached files */}
      {files.attachedFiles.length > 0 && (
        <div className='mb-[6px] flex flex-wrap gap-[6px]'>
          {files.attachedFiles.map((file) => {
            const isImage = file.type.startsWith('image/')
            return (
              <div
                key={file.id}
                className='group relative h-[56px] w-[56px] flex-shrink-0 cursor-pointer overflow-hidden rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)] hover:bg-[var(--surface-4)]'
                title={`${file.name} (${files.formatFileSize(file.size)})`}
                onClick={() => files.handleFileClick(file)}
              >
                {isImage && file.previewUrl ? (
                  <img
                    src={file.previewUrl}
                    alt={file.name}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <div className='flex h-full w-full flex-col items-center justify-center gap-[2px]'>
                    {file.type.includes('pdf') ? (
                      <FileText className='h-[18px] w-[18px] text-red-500' />
                    ) : (
                      <FileText className='h-[18px] w-[18px] text-blue-500' />
                    )}
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
            )
          })}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={files.isDragging ? 'Drop files here...' : placeholder}
        rows={1}
        className={cn(TEXTAREA_BASE_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
      />
      <div className='flex items-center justify-between'>
        <button
          type='button'
          onClick={files.handleFileSelect}
          className='flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[#F0F0F0] transition-colors hover:bg-[#F7F7F7] dark:border-[#3d3d3d] dark:hover:bg-[#303030]'
          title='Attach file'
        >
          <Paperclip
            className='h-[14px] w-[14px] text-[var(--text-muted)] dark:text-[var(--text-secondary)]'
            strokeWidth={2}
          />
        </button>
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

      {/* Hidden file input */}
      <input
        ref={files.fileInputRef}
        type='file'
        onChange={files.handleFileChange}
        className='hidden'
        accept={CHAT_ACCEPT_ATTRIBUTE}
        multiple
      />
    </div>
  )
}
