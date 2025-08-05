'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { ArrowUp, Loader2, MessageCircle, Package, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/auth-client'
import { useCopilotStore } from '@/stores/copilot/store'

interface MessageFileAttachment {
  id: string
  s3_key: string
  filename: string
  media_type: string
  size: number
}

interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  path: string
  key?: string // Add key field to store the actual S3 key
  uploading: boolean
}

interface UserInputProps {
  onSubmit: (message: string, fileAttachments?: MessageFileAttachment[]) => void
  onAbort?: () => void
  disabled?: boolean
  isLoading?: boolean
  isAborting?: boolean
  placeholder?: string
  className?: string
  mode?: 'ask' | 'agent'
  onModeChange?: (mode: 'ask' | 'agent') => void
  value?: string // Controlled value from outside
  onChange?: (value: string) => void // Callback when value changes
}

interface UserInputRef {
  focus: () => void
}

const UserInput = forwardRef<UserInputRef, UserInputProps>(
  (
    {
      onSubmit,
      onAbort,
      disabled = false,
      isLoading = false,
      isAborting = false,
      placeholder = 'How can I help you today?',
      className,
      mode = 'agent',
      onModeChange,
      value: controlledValue,
      onChange: onControlledChange,
    },
    ref
  ) => {
    const [internalMessage, setInternalMessage] = useState('')
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    
    const { data: session } = useSession()
    const { currentChat, workflowId } = useCopilotStore()

    // Expose focus method to parent
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          textareaRef.current?.focus()
        },
      }),
      []
    )

    // Use controlled value if provided, otherwise use internal state
    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

    // Auto-resize textarea
    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px` // Max height of 120px
      }
    }, [message])

    const handleSubmit = () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) return

      // Convert attached files to the format expected by the API
      const fileAttachments = attachedFiles
        .filter(f => !f.uploading && f.key) // Only include successfully uploaded files with keys
        .map(f => ({
          id: f.id,
          s3_key: f.key!, // Use the actual S3 key stored from the upload response
          filename: f.name,
          media_type: f.type,
          size: f.size,
        }))

      onSubmit(trimmedMessage, fileAttachments)
      
      // Clear the message and files after submit
      if (controlledValue !== undefined) {
        onControlledChange?.('')
      } else {
        setInternalMessage('')
      }
      setAttachedFiles([])
    }

    const handleAbort = () => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      if (controlledValue !== undefined) {
        onControlledChange?.(newValue)
      } else {
        setInternalMessage(newValue)
      }
    }

    const handleFileSelect = () => {
      fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      const file = files[0]
      const userId = session?.user?.id

      if (!userId) {
        console.error('User ID not available for file upload')
        return
      }

      // Create a temporary file entry with uploading state
      const tempFile: AttachedFile = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        path: '',
        uploading: true,
      }

      setAttachedFiles(prev => [...prev, tempFile])

      try {
        // Request presigned URL
        const presignedResponse = await fetch('/api/files/presigned?type=copilot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
            userId,
          }),
        })

        if (!presignedResponse.ok) {
          throw new Error('Failed to get presigned URL')
        }

        const presignedData = await presignedResponse.json()

        // Upload file to S3
        console.log('Uploading to S3:', presignedData.presignedUrl)
        const uploadResponse = await fetch(presignedData.presignedUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type,
          },
          body: file,
        })

        console.log('S3 Upload response status:', uploadResponse.status)
        
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text()
          console.error('S3 Upload failed:', errorText)
          throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`)
        }

        // Update file entry with success
        setAttachedFiles(prev =>
          prev.map(f =>
            f.id === tempFile.id
              ? {
                  ...f,
                  path: presignedData.fileInfo.path,
                  key: presignedData.fileInfo.key, // Store the actual S3 key
                  uploading: false,
                }
              : f
          )
        )
      } catch (error) {
        console.error('File upload failed:', error)
        // Remove failed upload
        setAttachedFiles(prev => prev.filter(f => f.id !== tempFile.id))
      }

      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const removeFile = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId))
    }

    const formatFileSize = (bytes: number) => {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
    }

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    const handleModeToggle = () => {
      if (onModeChange) {
        onModeChange(mode === 'ask' ? 'agent' : 'ask')
      }
    }

    const getModeIcon = () => {
      return mode === 'ask' ? (
        <MessageCircle className='h-3 w-3 text-muted-foreground' />
      ) : (
        <Package className='h-3 w-3 text-muted-foreground' />
      )
    }

    return (
      <div className={cn('relative flex-none pb-4', className)}>
        <div className='rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] p-2 shadow-xs dark:border-[#414141] dark:bg-[#202020]'>
          {/* Attached Files Display */}
          {attachedFiles.length > 0 && (
            <div className='mb-2 space-y-1'>
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className='flex items-center gap-2 rounded-md bg-secondary/50 px-2 py-1 text-xs'
                >
                  <Paperclip className='h-3 w-3 text-muted-foreground' />
                  <span className='flex-1 truncate'>{file.name}</span>
                  <span className='text-muted-foreground'>
                    {formatFileSize(file.size)}
                  </span>
                  {file.uploading ? (
                    <Loader2 className='h-3 w-3 animate-spin text-muted-foreground' />
                  ) : (
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => removeFile(file.id)}
                      className='h-4 w-4 hover:bg-destructive hover:text-destructive-foreground'
                    >
                      <X className='h-3 w-3' />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Textarea Field */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className='mb-2 min-h-[32px] w-full resize-none overflow-hidden border-0 bg-transparent px-[2px] py-1 text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            style={{ height: 'auto' }}
          />

          {/* Bottom Row: Mode Selector + Attach Button + Send Button */}
          <div className='flex items-center justify-between'>
            {/* Left side: Mode Selector */}
            <Button
              variant='ghost'
              size='sm'
              onClick={handleModeToggle}
              disabled={!onModeChange}
              className='flex h-6 items-center gap-1.5 rounded-full bg-secondary px-2 py-1 font-medium text-secondary-foreground text-xs hover:bg-secondary/80'
            >
              {getModeIcon()}
              <span className='capitalize'>{mode}</span>
            </Button>

            {/* Right side: Attach Button + Send Button */}
            <div className='flex items-center gap-1'>
              {/* Attach Button */}
              <Button
                variant='ghost'
                size='icon'
                onClick={handleFileSelect}
                disabled={disabled || isLoading}
                className='h-6 w-6 text-muted-foreground hover:text-foreground'
                title='Attach file'
              >
                <Paperclip className='h-3 w-3' />
              </Button>

              {/* Send Button */}
              {showAbortButton ? (
                <Button
                  onClick={handleAbort}
                  disabled={isAborting}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
                  title='Stop generation'
                >
                  {isAborting ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <X className='h-3 w-3' />
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-[#802FFF] text-white shadow-[0_0_0_0_#802FFF] transition-all duration-200 hover:bg-[#7028E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  {isLoading ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <ArrowUp className='h-3 w-3' />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type='file'
            onChange={handleFileChange}
            className='hidden'
            accept='.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.gif,.svg'
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { UserInputRef }
