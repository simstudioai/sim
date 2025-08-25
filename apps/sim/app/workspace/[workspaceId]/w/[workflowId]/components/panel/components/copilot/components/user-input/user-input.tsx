'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  ArrowUp,
  Brain,
  BrainCircuit,
  Check,
  FileText,
  Image,
  Infinity as InfinityIcon,
  Info,
  Loader2,
  MessageCircle,
  Package,
  Paperclip,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { useCopilotStore } from '@/stores/copilot/store'
import { CopilotSlider as Slider } from './copilot-slider'

export interface MessageFileAttachment {
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
  previewUrl?: string // For local preview of images before upload
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
    // Drag and drop state
    const [isDragging, setIsDragging] = useState(false)
    const [dragCounter, setDragCounter] = useState(0)
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

    // Auto-resize textarea and toggle vertical scroll when exceeding max height
    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea) {
        const maxHeight = 120
        textarea.style.height = 'auto'
        const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
        textarea.style.height = `${nextHeight}px`
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
      }
    }, [message])

    // Cleanup preview URLs on unmount
    useEffect(() => {
      return () => {
        attachedFiles.forEach((f) => {
          if (f.previewUrl) {
            URL.revokeObjectURL(f.previewUrl)
          }
        })
      }
    }, [])

    // Drag and drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => {
        const newCount = prev + 1
        if (newCount === 1) {
          setIsDragging(true)
        }
        return newCount
      })
    }

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => {
        const newCount = prev - 1
        if (newCount === 0) {
          setIsDragging(false)
        }
        return newCount
      })
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Add visual feedback for valid drop zone
      e.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setDragCounter(0)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files)
      }
    }

    // Process dropped or selected files
    const processFiles = async (fileList: FileList) => {
      const userId = session?.user?.id

      if (!userId) {
        console.error('User ID not available for file upload')
        return
      }

      // Process files one by one
      for (const file of Array.from(fileList)) {
        // Create a preview URL for images
        let previewUrl: string | undefined
        if (file.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(file)
        }

        // Create a temporary file entry with uploading state
        const tempFile: AttachedFile = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          path: '',
          uploading: true,
          previewUrl,
        }

        setAttachedFiles((prev) => [...prev, tempFile])

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
          setAttachedFiles((prev) =>
            prev.map((f) =>
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
          setAttachedFiles((prev) => prev.filter((f) => f.id !== tempFile.id))
        }
      }
    }

    const handleSubmit = () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) return

      // Check for failed uploads and show user feedback
      const failedUploads = attachedFiles.filter((f) => !f.uploading && !f.key)
      if (failedUploads.length > 0) {
        console.error(
          'Some files failed to upload:',
          failedUploads.map((f) => f.name)
        )
      }

      // Convert attached files to the format expected by the API
      const fileAttachments = attachedFiles
        .filter((f) => !f.uploading && f.key) // Only include successfully uploaded files with keys
        .map((f) => ({
          id: f.id,
          s3_key: f.key!, // Use the actual S3 key stored from the upload response
          filename: f.name,
          media_type: f.type,
          size: f.size,
        }))

      onSubmit(trimmedMessage, fileAttachments)

      // Clean up preview URLs before clearing
      attachedFiles.forEach((f) => {
        if (f.previewUrl) {
          URL.revokeObjectURL(f.previewUrl)
        }
      })

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
      if (disabled || isLoading) {
        return
      }

      fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) {
        return
      }

      await processFiles(files)

      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const removeFile = (fileId: string) => {
      // Clean up preview URL if it exists
      const file = attachedFiles.find((f) => f.id === fileId)
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
    }

    const handleFileClick = (file: AttachedFile) => {
      // If file has been uploaded and has an S3 key, open the S3 URL
      if (file.key) {
        const serveUrl = `/api/files/serve/s3/${encodeURIComponent(file.key)}?bucket=copilot`
        window.open(serveUrl, '_blank')
      } else if (file.previewUrl) {
        // If file hasn't been uploaded yet but has a preview URL, open that
        window.open(file.previewUrl, '_blank')
      }
    }

    const formatFileSize = (bytes: number) => {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`
    }

    const isImageFile = (type: string) => {
      return type.startsWith('image/')
    }

    const getFileIcon = (mediaType: string) => {
      if (mediaType.startsWith('image/')) {
        return <Image className='h-5 w-5 text-muted-foreground' />
      }
      if (mediaType.includes('pdf')) {
        return <FileText className='h-5 w-5 text-red-500' />
      }
      if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
        return <FileText className='h-5 w-5 text-blue-500' />
      }
      return <FileText className='h-5 w-5 text-muted-foreground' />
    }

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    const handleModeToggle = () => {
      if (onModeChange) {
        // Toggle between Ask and Agent
        onModeChange(mode === 'ask' ? 'agent' : 'ask')
      }
    }

    const getModeIcon = () => {
      if (mode === 'ask') {
        return <MessageCircle className='h-3 w-3 text-muted-foreground' />
      }
      return <Package className='h-3 w-3 text-muted-foreground' />
    }

    const getModeText = () => {
      if (mode === 'ask') {
        return 'Ask'
      }
      return 'Agent'
    }

    // Depth toggle state comes from global store; access via useCopilotStore
    const { agentDepth, agentPrefetch, setAgentDepth, setAgentPrefetch } = useCopilotStore()

    // Ensure MAX mode is off for Fast and Balanced depths
    useEffect(() => {
      if (agentDepth < 2 && !agentPrefetch) {
        setAgentPrefetch(true)
      }
    }, [agentDepth, agentPrefetch, setAgentPrefetch])

    const cycleDepth = () => {
      // 8 modes: depths 0-3, each with prefetch off/on. Cycle depth, then toggle prefetch when wrapping.
      const nextDepth = agentDepth === 3 ? 0 : ((agentDepth + 1) as 0 | 1 | 2 | 3)
      if (nextDepth === 0 && agentDepth === 3) {
        setAgentPrefetch(!agentPrefetch)
      }
      setAgentDepth(nextDepth)
    }

    const getCollapsedModeLabel = () => {
      const base = getDepthLabelFor(agentDepth)
      return !agentPrefetch ? `${base} MAX` : base
    }

    const getDepthLabelFor = (value: 0 | 1 | 2 | 3) => {
      return value === 0 ? 'Fast' : value === 1 ? 'Balanced' : value === 2 ? 'Advanced' : 'Behemoth'
    }

    // Removed descriptive suffixes; concise labels only
    const getDepthDescription = (value: 0 | 1 | 2 | 3) => {
      if (value === 0)
        return 'Fastest and cheapest. Good for small edits, simple workflows, and small tasks'
      if (value === 1) return 'Balances speed and reasoning. Good fit for most tasks'
      if (value === 2)
        return 'More reasoning for larger workflows and complex edits, still balanced for speed'
      return 'Maximum reasoning power. Best for complex workflow building and debugging'
    }

    const getDepthIconFor = (value: 0 | 1 | 2 | 3) => {
      const colorClass = !agentPrefetch
        ? 'text-[var(--brand-primary-hover-hex)]'
        : 'text-muted-foreground'
      if (value === 0) return <Zap className={`h-3 w-3 ${colorClass}`} />
      if (value === 1) return <InfinityIcon className={`h-3 w-3 ${colorClass}`} />
      if (value === 2) return <Brain className={`h-3 w-3 ${colorClass}`} />
      return <BrainCircuit className={`h-3 w-3 ${colorClass}`} />
    }

    const getDepthIcon = () => getDepthIconFor(agentDepth)

    return (
      <div className={cn('relative flex-none pb-4', className)}>
        <div
          className={cn(
            'rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] p-2 shadow-xs transition-all duration-200 dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
            isDragging &&
              'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Attached Files Display with Thumbnails */}
          {attachedFiles.length > 0 && (
            <div className='mb-2 flex flex-wrap gap-1.5'>
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-muted/40'
                  title={`${file.name} (${formatFileSize(file.size)})`}
                  onClick={() => handleFileClick(file)}
                >
                  {isImageFile(file.type) && file.previewUrl ? (
                    // For images, show actual thumbnail
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : isImageFile(file.type) && file.key ? (
                    // For uploaded images without preview URL, use S3 URL
                    <img
                      src={`/api/files/serve/s3/${encodeURIComponent(file.key)}?bucket=copilot`}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : (
                    // For other files, show icon centered
                    <div className='flex h-full w-full items-center justify-center bg-background/50'>
                      {getFileIcon(file.type)}
                    </div>
                  )}

                  {/* Loading overlay */}
                  {file.uploading && (
                    <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                      <Loader2 className='h-4 w-4 animate-spin text-white' />
                    </div>
                  )}

                  {/* Remove button */}
                  {!file.uploading && (
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(file.id)
                      }}
                      className='absolute top-0.5 right-0.5 h-5 w-5 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100'
                    >
                      <X className='h-3 w-3' />
                    </Button>
                  )}

                  {/* Hover overlay effect */}
                  <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
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
            placeholder={isDragging ? 'Drop files here...' : placeholder}
            disabled={disabled}
            rows={1}
            className='mb-2 min-h-[32px] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent px-[2px] py-1 text-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            style={{ height: 'auto' }}
          />

          {/* Bottom Row: Mode Selector + Attach Button + Send Button */}
          <div className='flex items-center justify-between'>
            {/* Left side: Mode Selector and Depth (if Agent) */}
            <div className='flex items-center gap-1.5'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={!onModeChange}
                    className='flex h-6 items-center gap-1.5 rounded-full border px-2 py-1 font-medium text-xs'
                  >
                    {getModeIcon()}
                    <span>{getModeText()}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='p-0'>
                  <TooltipProvider>
                    <div className='w-[160px] p-1'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            onSelect={() => onModeChange?.('ask')}
                            className={cn(
                              'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                              mode === 'ask' && 'bg-muted/40'
                            )}
                          >
                            <span className='flex items-center gap-1.5'>
                              <MessageCircle className='h-3 w-3 text-muted-foreground' />
                              Ask
                            </span>
                            {mode === 'ask' && <Check className='h-3 w-3 text-muted-foreground' />}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          sideOffset={6}
                          align='center'
                          className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                        >
                          Ask mode can help answer questions about your workflow, tell you about
                          Sim, and guide you in building/editing.
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            onSelect={() => onModeChange?.('agent')}
                            className={cn(
                              'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                              mode === 'agent' && 'bg-muted/40'
                            )}
                          >
                            <span className='flex items-center gap-1.5'>
                              <Package className='h-3 w-3 text-muted-foreground' />
                              Agent
                            </span>
                            {mode === 'agent' && (
                              <Check className='h-3 w-3 text-muted-foreground' />
                            )}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          sideOffset={6}
                          align='center'
                          className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                        >
                          Agent mode can build, edit, and interact with your workflows (Recommended)
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </DropdownMenuContent>
              </DropdownMenu>
              {
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className={cn(
                        'flex h-6 items-center gap-1.5 rounded-full border px-2 py-1 font-medium text-xs',
                        !agentPrefetch
                          ? 'border-[var(--brand-primary-hover-hex)] text-[var(--brand-primary-hover-hex)] hover:bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_8%,transparent)] hover:text-[var(--brand-primary-hover-hex)]'
                          : 'border-border text-foreground'
                      )}
                      title='Choose mode'
                    >
                      {getDepthIcon()}
                      <span>{getCollapsedModeLabel()}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start' className='p-0'>
                    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
                      <div className='w-[260px] p-3'>
                        <div className='mb-3 flex items-center justify-between'>
                          <div className='flex items-center gap-1.5'>
                            <span className='font-medium text-xs'>MAX mode</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type='button'
                                  className='h-3.5 w-3.5 rounded text-muted-foreground transition-colors hover:text-foreground'
                                  aria-label='MAX mode info'
                                >
                                  <Info className='h-3.5 w-3.5' />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side='right'
                                sideOffset={6}
                                align='center'
                                className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                              >
                                Significantly increases depth of reasoning
                                <br />
                                <span className='text-[10px] text-muted-foreground italic'>
                                  Only available in Advanced and Behemoth modes
                                </span>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={!agentPrefetch}
                            disabled={agentDepth < 2}
                            title={
                              agentDepth < 2
                                ? 'MAX mode is only available for Advanced or Expert'
                                : undefined
                            }
                            onCheckedChange={(checked) => {
                              if (agentDepth < 2) return
                              setAgentPrefetch(!checked)
                            }}
                          />
                        </div>
                        <div className='my-2 flex justify-center'>
                          <div className='h-px w-[100%] bg-border' />
                        </div>
                        <div className='mb-3'>
                          <div className='mb-2 flex items-center justify-between'>
                            <span className='font-medium text-xs'>Mode</span>
                            <div className='flex items-center gap-1'>
                              {getDepthIconFor(agentDepth)}
                              <span className='text-muted-foreground text-xs'>
                                {getDepthLabelFor(agentDepth)}
                              </span>
                            </div>
                          </div>
                          <div className='relative'>
                            <Slider
                              min={0}
                              max={3}
                              step={1}
                              value={[agentDepth]}
                              onValueChange={(val) =>
                                setAgentDepth((val?.[0] ?? 0) as 0 | 1 | 2 | 3)
                              }
                            />
                            <div className='pointer-events-none absolute inset-0'>
                              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-[33.333%] h-2 w-[3px] bg-background' />
                              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-[66.667%] h-2 w-[3px] bg-background' />
                            </div>
                          </div>
                        </div>
                        <div className='mt-3 text-[11px] text-muted-foreground'>
                          {getDepthDescription(agentDepth)}
                        </div>
                      </div>
                    </TooltipProvider>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            </div>

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
                  className='h-6 w-6 rounded-full bg-[var(--brand-primary-hover-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hover-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
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
            accept='.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.gif'
            multiple
            disabled={disabled || isLoading}
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { UserInputRef }
