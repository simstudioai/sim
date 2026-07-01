'use client'

import type React from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Badge, Button, cn, handleKeyboardActivation, Tooltip } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { ArrowUp, Mic, Paperclip, X } from 'lucide-react'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { VoiceInput } from '@/app/(interfaces)/chat/components/input/voice-input'

const logger = createLogger('ChatInput')

const MAX_TEXTAREA_HEIGHT = 200

interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  file: File
  dataUrl?: string
}

export const ChatInput: React.FC<{
  onSubmit?: (value: string, isVoiceInput?: boolean, files?: AttachedFile[]) => void
  isStreaming?: boolean
  onStopStreaming?: () => void
  onVoiceStart?: () => void
  voiceOnly?: boolean
  sttAvailable?: boolean
}> = ({
  onSubmit,
  isStreaming = false,
  onStopStreaming,
  onVoiceStart,
  voiceOnly = false,
  sttAvailable = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragCounter, setDragCounter] = useState(0)
  const isDragOver = dragCounter > 0

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [inputValue])

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return

    const newFiles: AttachedFile[] = []
    const maxSize = 10 * 1024 * 1024
    const maxFiles = 15

    for (let i = 0; i < selectedFiles.length; i++) {
      if (attachedFiles.length + newFiles.length >= maxFiles) break

      const file = selectedFiles[i]

      if (file.size > maxSize) {
        setUploadErrors((prev) => [...prev, `${file.name} is too large (max 10MB)`])
        continue
      }

      const isDuplicate = attachedFiles.some(
        (existing) => existing.name === file.name && existing.size === file.size
      )
      if (isDuplicate) {
        setUploadErrors((prev) => [...prev, `${file.name} already added`])
        continue
      }

      let dataUrl: string | undefined
      if (file.type.startsWith('image/')) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
        } catch (error) {
          logger.error('Error reading file:', error)
        }
      }

      newFiles.push({
        id: generateId(),
        name: file.name,
        size: file.size,
        type: file.type,
        file,
        dataUrl,
      })
    }

    if (newFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...newFiles])
      setUploadErrors([])
    }
  }

  const handleRemoveFile = useCallback((fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }, [])

  const handleSubmit = useCallback(() => {
    if (isStreaming) return
    if (!inputValue.trim() && attachedFiles.length === 0) return
    onSubmit?.(inputValue.trim(), false, attachedFiles)
    setInputValue('')
    setAttachedFiles([])
    setUploadErrors([])
  }, [isStreaming, inputValue, attachedFiles, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    textareaRef.current?.focus()
  }, [])

  const canSubmit = (inputValue.trim().length > 0 || attachedFiles.length > 0) && !isStreaming

  if (voiceOnly) {
    return (
      <Tooltip.Provider>
        <div className='flex items-center justify-center'>
          {sttAvailable && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <div>
                  <VoiceInput
                    onVoiceStart={onVoiceStart ?? (() => {})}
                    disabled={isStreaming}
                    large={true}
                  />
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>Start voice conversation</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
      </Tooltip.Provider>
    )
  }

  return (
    <Tooltip.Provider>
      <div className='fixed right-0 bottom-0 left-0 flex w-full items-center justify-center bg-gradient-to-t from-[var(--bg)] to-transparent px-4 pb-4 md:px-0 md:pb-4'>
        <div className='w-full max-w-3xl md:max-w-[748px]'>
          {/* Error Messages */}
          {uploadErrors.length > 0 && (
            <div className='mb-3 flex flex-col gap-2'>
              {uploadErrors.map((error, idx) => (
                <Badge key={`${error}-${idx}`} variant='red' size='lg' dot className='max-w-full'>
                  {error}
                </Badge>
              ))}
            </div>
          )}

          {/* Input container */}
          <div
            role='group'
            aria-label='Chat message input'
            onClick={handleContainerClick}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              handleKeyboardActivation(event, focusTextarea)
            }}
            className={cn(
              'relative z-10 cursor-text rounded-2xl border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2',
              isDragOver && 'border-purple-500'
            )}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isStreaming) setDragCounter((prev) => prev + 1)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isStreaming) e.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragCounter((prev) => Math.max(0, prev - 1))
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragCounter(0)
              if (!isStreaming) handleFileSelect(e.dataTransfer.files)
            }}
          >
            {/* File thumbnails */}
            {attachedFiles.length > 0 && (
              <div className='mb-1.5 flex flex-wrap gap-1.5'>
                {attachedFiles.map((file) => (
                  <Tooltip.Root key={file.id}>
                    <Tooltip.Trigger asChild>
                      <div className='group relative size-[56px] flex-shrink-0 cursor-pointer overflow-hidden rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-3)]'>
                        {file.dataUrl ? (
                          <img
                            src={file.dataUrl}
                            alt={file.name}
                            className='h-full w-full object-cover'
                          />
                        ) : (
                          <div className='flex h-full w-full flex-col items-center justify-center gap-0.5 text-[var(--text-muted)]'>
                            <Paperclip className='size-[18px]' />
                            <span className='max-w-[48px] truncate px-[2px] text-[9px]'>
                              {file.name.split('.').pop()}
                            </span>
                          </div>
                        )}
                        <Button
                          variant='primary'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFile(file.id)
                          }}
                          className='absolute top-[2px] right-[2px] size-[16px] rounded-full p-0 opacity-0 group-hover:opacity-100'
                        >
                          <X className='size-[10px]' />
                        </Button>
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>
                      <p className='max-w-[200px] truncate'>{file.name}</p>
                    </Tooltip.Content>
                  </Tooltip.Root>
                ))}
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isDragOver ? 'Drop files here...' : 'Enter a message...'}
              rows={1}
              className='m-0 h-auto min-h-[24px] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent p-1 text-[15px] text-[var(--text-primary)] leading-[24px] caret-[var(--text-primary)] outline-none [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden'
            />

            {/* Bottom row */}
            <div className='flex items-center justify-between'>
              {/* Left: attach */}
              <div>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='quiet'
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isStreaming || attachedFiles.length >= 15}
                      className='size-[28px] rounded-full p-0'
                    >
                      <Paperclip className='size-[16px]' strokeWidth={2} />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    <p>Attach files</p>
                  </Tooltip.Content>
                </Tooltip.Root>

                <input
                  ref={fileInputRef}
                  type='file'
                  multiple
                  accept={CHAT_ACCEPT_ATTRIBUTE}
                  onChange={(e) => {
                    handleFileSelect(e.target.files)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className='hidden'
                  disabled={isStreaming}
                />
              </div>

              {/* Right: mic + send */}
              <div className='flex items-center gap-1.5'>
                {sttAvailable && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='quiet'
                        onClick={onVoiceStart}
                        disabled={isStreaming}
                        className='size-[28px] rounded-full p-0'
                      >
                        <Mic className='size-[16px]' strokeWidth={2} />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>
                      <p>Start voice conversation</p>
                    </Tooltip.Content>
                  </Tooltip.Root>
                )}

                {isStreaming ? (
                  <Button
                    variant='primary'
                    onClick={onStopStreaming}
                    className='size-[28px] rounded-full p-0'
                    title='Stop generation'
                  >
                    <svg
                      className='block size-[14px] fill-current'
                      viewBox='0 0 24 24'
                      xmlns='http://www.w3.org/2000/svg'
                    >
                      <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
                    </svg>
                  </Button>
                ) : (
                  <Button
                    variant='primary'
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className='size-[28px] rounded-full p-0'
                  >
                    <ArrowUp className='block size-[16px]' strokeWidth={2.25} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  )
}
