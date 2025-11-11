'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Paperclip, Send, Square, X } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { VoiceInput } from '@/app/chat/components/input/voice-input'

const logger = createLogger('ChatInput')

import { createLogger } from '@/lib/logs/console/logger'

const PLACEHOLDER_MOBILE = 'Enter a message'
const PLACEHOLDER_DESKTOP = 'Enter a message or click the mic to speak'
const MAX_TEXTAREA_HEIGHT = 120 // Max height in pixels (e.g., for about 3-4 lines)
const MAX_TEXTAREA_HEIGHT_MOBILE = 100 // Smaller for mobile

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
}> = ({ onSubmit, isStreaming = false, onStopStreaming, onVoiceStart, voiceOnly = false }) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Ref for the textarea
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isActive, setIsActive] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragCounter, setDragCounter] = useState(0)
  const isDragOver = dragCounter > 0

  // Check if speech-to-text is available in the browser
  const isSttAvailable =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  // Function to adjust textarea height
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto' // Reset height to correctly calculate scrollHeight
      const scrollHeight = el.scrollHeight

      // Use mobile height on mobile devices, desktop height on desktop
      const isMobile = window.innerWidth < 768
      const maxHeight = isMobile ? MAX_TEXTAREA_HEIGHT_MOBILE : MAX_TEXTAREA_HEIGHT

      if (scrollHeight > maxHeight) {
        el.style.height = `${maxHeight}px`
        el.style.overflowY = 'auto'
      } else {
        el.style.height = `${scrollHeight}px`
        el.style.overflowY = 'hidden'
      }
    }
  }

  // Adjust height on input change
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputValue])

  // Close the input when clicking outside (only when empty)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        if (!inputValue) {
          setIsActive(false)
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto' // Reset height
            textareaRef.current.style.overflowY = 'hidden' // Ensure overflow is hidden
          }
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inputValue])

  // Handle focus and initial height when activated
  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus()
      adjustTextareaHeight() // Adjust height when becoming active
    }
  }, [isActive])

  const handleActivate = () => {
    setIsActive(true)
    // Focus is now handled by the useEffect above
  }

  // Handle file selection
  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return

    const newFiles: AttachedFile[] = []
    const maxSize = 10 * 1024 * 1024 // 10MB limit
    const maxFiles = 15

    for (let i = 0; i < selectedFiles.length; i++) {
      if (attachedFiles.length + newFiles.length >= maxFiles) break

      const file = selectedFiles[i]

      // Check file size
      if (file.size > maxSize) {
        setUploadErrors((prev) => [...prev, `${file.name} is too large (max 10MB)`])
        continue
      }

      // Check for duplicates
      const isDuplicate = attachedFiles.some(
        (existingFile) => existingFile.name === file.name && existingFile.size === file.size
      )
      if (isDuplicate) {
        setUploadErrors((prev) => [...prev, `${file.name} already added`])
        continue
      }

      // Read file as data URL if it's an image
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
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        file,
        dataUrl,
      })
    }

    if (newFiles.length > 0) {
      setAttachedFiles([...attachedFiles, ...newFiles])
      setUploadErrors([]) // Clear errors when files are successfully added
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles(attachedFiles.filter((f) => f.id !== fileId))
  }

  const handleSubmit = () => {
    if (isStreaming) return
    if (!inputValue.trim() && attachedFiles.length === 0) return
    onSubmit?.(inputValue.trim(), false, attachedFiles) // false = not voice input
    setInputValue('')
    setAttachedFiles([])
    setUploadErrors([]) // Clear errors when sending message
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto' // Reset height after submit
      textareaRef.current.style.overflowY = 'hidden' // Ensure overflow is hidden
    }
    setIsActive(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
  }

  // Handle voice start with smooth transition to voice-first mode
  const handleVoiceStart = () => {
    onVoiceStart?.() // This will trigger the voice-first mode transition
  }

  // Voice-only mode interface (for voice-first UI)
  if (voiceOnly) {
    return (
      <Tooltip.Provider>
        <div className='flex items-center justify-center'>
          {/* Voice Input Only */}
          {isSttAvailable && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <div>
                  <VoiceInput onVoiceStart={handleVoiceStart} disabled={isStreaming} large={true} />
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
      <div className='fixed right-0 bottom-0 left-0 flex w-full items-center justify-center bg-gradient-to-t from-white to-transparent px-4 pb-4 text-black md:px-0 md:pb-4'>
        <div ref={wrapperRef} className='w-full max-w-3xl md:max-w-[748px]'>
          {/* Error Messages */}
          {uploadErrors.length > 0 && (
            <div className='mb-3'>
              <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/20'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />
                  <div className='flex-1'>
                    <div className='mb-1 font-medium text-red-800 text-sm dark:text-red-300'>
                      File upload error
                    </div>
                    <div className='space-y-1'>
                      {uploadErrors.map((error, idx) => (
                        <div key={idx} className='text-red-700 text-sm dark:text-red-400'>
                          {error}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Text Input Area with Controls */}
          <motion.div
            className={`rounded-2xl border shadow-sm transition-all duration-200 md:rounded-3xl ${
              isDragOver
                ? 'border-purple-500 bg-purple-50/50 dark:border-purple-500 dark:bg-purple-950/20'
                : 'border-gray-200 bg-white'
            }`}
            onClick={handleActivate}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isStreaming) {
                setDragCounter((prev) => prev + 1)
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isStreaming) {
                e.dataTransfer.dropEffect = 'copy'
              }
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
              if (!isStreaming) {
                handleFileSelect(e.dataTransfer.files)
              }
            }}
          >
            {/* File Previews */}
            {attachedFiles.length > 0 && (
              <div className='mb-2 flex flex-wrap gap-2 px-3 pt-3 md:px-4'>
                {attachedFiles.map((file) => {
                  const formatFileSize = (bytes: number) => {
                    if (bytes === 0) return '0 B'
                    const k = 1024
                    const sizes = ['B', 'KB', 'MB', 'GB']
                    const i = Math.floor(Math.log(bytes) / Math.log(k))
                    return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
                  }

                  return (
                    <div
                      key={file.id}
                      className={`group relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${
                        file.dataUrl
                          ? 'h-16 w-16 md:h-20 md:w-20'
                          : 'flex h-16 min-w-[120px] max-w-[200px] items-center gap-2 px-2 md:h-20 md:min-w-[140px] md:max-w-[220px] md:px-3'
                      }`}
                      title=''
                    >
                      {file.dataUrl ? (
                        <img
                          src={file.dataUrl}
                          alt={file.name}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <>
                          <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-gray-100 md:h-10 md:w-10 dark:bg-gray-700'>
                            <Paperclip
                              size={16}
                              className='text-gray-500 md:h-5 md:w-5 dark:text-gray-400'
                            />
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-gray-800 text-xs dark:text-gray-200'>
                              {file.name}
                            </div>
                            <div className='text-[10px] text-gray-500 dark:text-gray-400'>
                              {formatFileSize(file.size)}
                            </div>
                          </div>
                        </>
                      )}
                      <button
                        type='button'
                        onClick={() => handleRemoveFile(file.id)}
                        className='absolute top-1 right-1 rounded-full bg-gray-800/80 p-1 text-white opacity-0 transition-opacity hover:bg-gray-800/80 hover:text-white group-hover:opacity-100 dark:bg-black/70 dark:hover:bg-black/70 dark:hover:text-white'
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className='flex items-center gap-2 p-3 md:p-4'>
              {/* Paperclip Button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isStreaming || attachedFiles.length >= 15}
                    className='flex items-center justify-center rounded-full p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 md:p-2'
                  >
                    <Paperclip size={16} className='md:h-5 md:w-5' />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  <p>Attach files</p>
                </Tooltip.Content>
              </Tooltip.Root>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type='file'
                multiple
                accept='.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf,image/*'
                onChange={(e) => {
                  handleFileSelect(e.target.files)
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
                  }
                }}
                className='hidden'
                disabled={isStreaming}
              />

              {/* Text Input Container */}
              <div className='relative flex-1'>
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={handleInputChange}
                  className='flex w-full resize-none items-center overflow-hidden bg-transparent text-base outline-none placeholder:text-gray-400 md:font-[330]'
                  placeholder={isDragOver ? 'Drop files here...' : isActive ? '' : ''}
                  rows={1}
                  style={{
                    minHeight: window.innerWidth >= 768 ? '24px' : '28px',
                    lineHeight: '1.4',
                    paddingTop: window.innerWidth >= 768 ? '4px' : '3px',
                    paddingBottom: window.innerWidth >= 768 ? '4px' : '3px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                />

                {/* Placeholder */}
                <div className='pointer-events-none absolute top-0 left-0 flex h-full w-full items-center'>
                  {!isActive && !inputValue && (
                    <>
                      {/* Mobile placeholder */}
                      <div
                        className='-translate-y-1/2 absolute top-1/2 left-0 transform select-none text-base text-gray-400 md:hidden'
                        style={{ paddingTop: '3px', paddingBottom: '3px' }}
                      >
                        {isDragOver ? 'Drop files here...' : PLACEHOLDER_MOBILE}
                      </div>
                      {/* Desktop placeholder */}
                      <div
                        className='-translate-y-1/2 absolute top-1/2 left-0 hidden transform select-none font-[330] text-base text-gray-400 md:block'
                        style={{ paddingTop: '4px', paddingBottom: '4px' }}
                      >
                        {isDragOver ? 'Drop files here...' : PLACEHOLDER_DESKTOP}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Voice Input */}
              {isSttAvailable && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <div>
                      <VoiceInput onVoiceStart={handleVoiceStart} disabled={isStreaming} minimal />
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    <p>Start voice conversation</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              )}

              {/* Send Button */}
              <button
                className={`flex items-center justify-center rounded-full p-1.5 text-white transition-colors md:p-2 ${
                  inputValue.trim() || attachedFiles.length > 0
                    ? 'bg-black hover:bg-zinc-700'
                    : 'cursor-default bg-gray-300 hover:bg-gray-400'
                }`}
                title={isStreaming ? 'Stop' : 'Send'}
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  if (isStreaming) {
                    onStopStreaming?.()
                  } else {
                    handleSubmit()
                  }
                }}
              >
                {isStreaming ? (
                  <>
                    <Square size={16} className='md:hidden' />
                    <Square size={18} className='hidden md:block' />
                  </>
                ) : (
                  <>
                    <Send size={16} className='md:hidden' />
                    <Send size={18} className='hidden md:block' />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </Tooltip.Provider>
  )
}
