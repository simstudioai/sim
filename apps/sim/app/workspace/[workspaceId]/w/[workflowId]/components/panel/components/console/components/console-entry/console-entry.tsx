import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Pause,
  Play,
} from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import type { ConsoleEntry as ConsoleEntryType } from '@/stores/panel/console/types'
import { CodeDisplay } from '../code-display/code-display'
import { JSONView } from '../json-view/json-view'

const logger = createLogger('ConsoleEntry')

interface ConsoleEntryProps {
  entry: ConsoleEntryType
  consoleWidth: number
}

// Helper function to check if an object contains an audio URL
const hasAudioData = (obj: any): boolean => {
  return obj && typeof obj === 'object' && 'audioUrl' in obj && typeof obj.audioUrl === 'string'
}

// Helper function to check if a string is likely a base64 image
const isBase64Image = (str: string): boolean => {
  if (typeof str !== 'string') return false
  return str.length > 100 && /^[A-Za-z0-9+/=]+$/.test(str)
}

// Helper function to check if an object contains an image URL
const hasImageData = (obj: any): boolean => {
  if (!obj || typeof obj !== 'object') return false

  // Case 1: Has explicit image data (base64)
  if (
    'image' in obj &&
    typeof obj.image === 'string' &&
    obj.image.length > 0 &&
    isBase64Image(obj.image)
  ) {
    return true
  }

  // Case 2: Has explicit image type in metadata
  if (
    obj.metadata?.type &&
    typeof obj.metadata.type === 'string' &&
    obj.metadata.type.toLowerCase() === 'image'
  ) {
    return true
  }

  // Case 3: Content URL points to an image file
  if (typeof obj.content === 'string' && obj.content.startsWith('http')) {
    return !!obj.content.toLowerCase().match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/)
  }

  // Case 4: Has URL property with image extension
  if ('url' in obj && typeof obj.url === 'string') {
    if (obj.metadata?.fileType?.startsWith('image/')) {
      return true
    }
    const url = obj.url.toLowerCase()
    return url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/) !== null
  }

  return false
}

// Get image URL from object
const getImageUrl = (obj: any): string | null => {
  if (!obj || typeof obj !== 'object') return null

  // Try content field first
  if (typeof obj.content === 'string' && obj.content.startsWith('http')) {
    return obj.content
  }

  // Try url field
  if ('url' in obj && typeof obj.url === 'string') {
    return obj.url
  }

  return null
}

// Get base64 image data from object
const getImageData = (obj: any): string | null => {
  if (!obj || typeof obj !== 'object') return null

  if (
    'image' in obj &&
    typeof obj.image === 'string' &&
    obj.image.length > 0 &&
    isBase64Image(obj.image)
  ) {
    return obj.image
  }

  return null
}

// Image preview component
const ImagePreview = ({
  imageUrl,
  imageData,
  isBase64 = false,
  onLoadError,
}: {
  imageUrl?: string
  imageData?: string
  isBase64?: boolean
  onLoadError?: (hasError: boolean) => void
}) => {
  const [loadError, setLoadError] = useState(false)

  // Only display image if we have valid data
  const hasValidData =
    (isBase64 && imageData && imageData.length > 0) || (imageUrl && imageUrl.length > 0)

  if (!hasValidData) {
    return null
  }

  if (loadError) {
    return null
  }

  // Determine the source for the image
  const imageSrc =
    isBase64 && imageData && imageData.length > 0
      ? `data:image/png;base64,${imageData}`
      : imageUrl || ''

  return (
    <div className='my-2 w-1/2'>
      <Image
        src={imageSrc}
        alt='Generated image'
        width={400}
        height={300}
        className='h-auto w-full rounded-lg border'
        unoptimized
        onError={(e) => {
          console.error('Image failed to load:', imageSrc)
          setLoadError(true)
          onLoadError?.(true)
        }}
        onLoad={() => {
          onLoadError?.(false)
        }}
      />
    </div>
  )
}

export function ConsoleEntry({ entry, consoleWidth }: ConsoleEntryProps) {
  const [isExpanded, setIsExpanded] = useState(true) // Default expanded
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showInput, setShowInput] = useState(false) // State for input/output toggle
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [imageLoadError, setImageLoadError] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Check if entry has audio data
  const hasAudio = useMemo(() => {
    return entry.output != null && hasAudioData(entry.output)
  }, [entry.output])

  // Check if entry has image data
  const hasImage = useMemo(() => {
    return entry.output != null && hasImageData(entry.output)
  }, [entry.output])

  // Only show image download button if image exists and didn't fail to load
  const showImageDownload = hasImage && !imageLoadError

  const audioUrl = useMemo(() => {
    return hasAudio && entry.output ? entry.output.audioUrl : null
  }, [hasAudio, entry.output])

  const imageUrl = useMemo(() => {
    return hasImage && entry.output ? getImageUrl(entry.output) : null
  }, [hasImage, entry.output])

  const imageData = useMemo(() => {
    return hasImage && entry.output ? getImageData(entry.output) : null
  }, [hasImage, entry.output])

  const isBase64Image = useMemo(() => {
    return imageData != null && imageData.length > 0
  }, [imageData])

  // Get the data to display based on the toggle state
  const displayData = useMemo(() => {
    return showInput ? entry.input : entry.output
  }, [showInput, entry.input, entry.output])

  // Check if input data exists
  const hasInputData = useMemo(() => {
    return (
      entry.input != null &&
      (typeof entry.input === 'object'
        ? Object.keys(entry.input).length > 0
        : entry.input !== undefined && entry.input !== null)
    )
  }, [entry.input])

  // Check if this is a function block with code input
  const shouldShowCodeDisplay = useMemo(() => {
    return (
      entry.blockType === 'function' &&
      showInput &&
      entry.input &&
      typeof entry.input === 'object' &&
      'code' in entry.input &&
      typeof entry.input.code === 'string'
    )
  }, [entry.blockType, showInput, entry.input])

  // Audio player logic
  useEffect(() => {
    if (!hasAudio || !audioUrl) return

    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl)
      audioRef.current.addEventListener('ended', () => setIsPlaying(false))
      audioRef.current.addEventListener('pause', () => setIsPlaying(false))
      audioRef.current.addEventListener('play', () => setIsPlaying(true))
      audioRef.current.addEventListener('timeupdate', updateProgress)
    } else {
      audioRef.current.src = audioUrl
      setProgress(0)
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.removeEventListener('ended', () => setIsPlaying(false))
        audioRef.current.removeEventListener('pause', () => setIsPlaying(false))
        audioRef.current.removeEventListener('play', () => setIsPlaying(true))
        audioRef.current.removeEventListener('timeupdate', updateProgress)
      }
    }
  }, [hasAudio, audioUrl])

  const updateProgress = () => {
    if (audioRef.current) {
      const value = (audioRef.current.currentTime / audioRef.current.duration) * 100
      setProgress(Number.isNaN(value) ? 0 : value)
    }
  }

  const togglePlay = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
  }

  const downloadAudio = async () => {
    if (!audioUrl) return

    try {
      const response = await fetch(audioUrl)
      const blob = await response.blob()

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tts-audio-${Date.now()}.mp3`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Error downloading audio:', error)
    }
  }

  const downloadImage = async () => {
    try {
      let blob: Blob
      if (isBase64Image && imageData && imageData.length > 0) {
        // Convert base64 to blob
        const byteString = atob(imageData)
        const arrayBuffer = new ArrayBuffer(byteString.length)
        const uint8Array = new Uint8Array(arrayBuffer)
        for (let i = 0; i < byteString.length; i++) {
          uint8Array[i] = byteString.charCodeAt(i)
        }
        blob = new Blob([arrayBuffer], { type: 'image/png' })
      } else if (imageUrl && imageUrl.length > 0) {
        // Use proxy endpoint to fetch image
        const proxyUrl = `/api/proxy/image?url=${encodeURIComponent(imageUrl)}`
        const response = await fetch(proxyUrl)
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.statusText}`)
        }
        blob = await response.blob()
      } else {
        throw new Error('No image data or URL provided')
      }

      // Create object URL and trigger download
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `generated-image-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Clean up the URL
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch (error) {
      console.error('Error downloading image:', error)
      alert('Failed to download image. Please try again later.')
    }
  }

  const blockConfig = useMemo(() => {
    if (!entry.blockType) return null
    return getBlock(entry.blockType)
  }, [entry.blockType])

  const handleCopy = () => {
    let textToCopy: string

    if (shouldShowCodeDisplay) {
      // For code display, copy just the code string
      textToCopy = entry.input.code
    } else {
      // For regular JSON display, copy the full JSON
      const dataToCopy = showInput ? entry.input : entry.output
      textToCopy = JSON.stringify(dataToCopy, null, 2)
    }

    navigator.clipboard.writeText(textToCopy)
    setShowCopySuccess(true)
  }

  useEffect(() => {
    if (showCopySuccess) {
      const timer = setTimeout(() => {
        setShowCopySuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showCopySuccess])

  const BlockIcon = blockConfig?.icon
  const blockColor = blockConfig?.bgColor || '#6B7280'

  // Handle image load error callback
  const handleImageLoadError = (hasError: boolean) => {
    setImageLoadError(hasError)
  }

  return (
    <div className='space-y-3'>
      {/* Header: Icon | Block name */}
      <div className='flex items-center gap-2'>
        {BlockIcon && (
          <div
            className='flex h-5 w-5 items-center justify-center rounded-md'
            style={{ backgroundColor: blockColor }}
          >
            <BlockIcon className='h-3 w-3 text-white' />
          </div>
        )}
        <span className='font-normal text-base text-sm leading-normal'>
          {entry.blockName || 'Unknown Block'}
        </span>
      </div>

      {/* Duration tag | Time tag | Input/Output tags */}
      <div className='flex items-center gap-2'>
        <div
          className={`flex h-5 items-center rounded-lg px-2 ${
            entry.error ? 'bg-[#F6D2D2] dark:bg-[#442929]' : 'bg-secondary'
          }`}
        >
          {entry.error ? (
            <div className='flex items-center gap-1'>
              <AlertCircle className='h-3 w-3 text-[#DC2626] dark:text-[#F87171]' />
              <span className='font-normal text-[#DC2626] text-xs leading-normal dark:text-[#F87171]'>
                Error
              </span>
            </div>
          ) : (
            <span className='font-normal text-muted-foreground text-xs leading-normal'>
              {entry.durationMs ?? 0}ms
            </span>
          )}
        </div>
        <div className='flex h-5 items-center rounded-lg bg-secondary px-2'>
          <span className='font-normal text-muted-foreground text-xs leading-normal'>
            {entry.startedAt ? format(new Date(entry.startedAt), 'HH:mm:ss') : 'N/A'}
          </span>
        </div>
        {/* Input/Output tags - only show if input data exists */}
        {hasInputData && (
          <>
            <button
              onClick={() => setShowInput(false)}
              className={`flex h-5 items-center rounded-lg px-2 transition-colors ${
                !showInput
                  ? 'border-[#e5e5e5] bg-[#f5f5f5] text-[#1a1a1a] dark:border-[#424242] dark:bg-[#1f1f1f] dark:text-[#ffffff]'
                  : 'bg-secondary text-muted-foreground hover:bg-secondary hover:text-card-foreground'
              }`}
            >
              <span className='font-normal text-xs leading-normal'>Output</span>
            </button>
            <button
              onClick={() => setShowInput(true)}
              className={`flex h-5 items-center rounded-lg px-2 transition-colors ${
                showInput
                  ? 'border-[#e5e5e5] bg-[#f5f5f5] text-[#1a1a1a] dark:border-[#424242] dark:bg-[#1f1f1f] dark:text-[#ffffff]'
                  : 'bg-secondary text-muted-foreground hover:bg-secondary hover:text-card-foreground'
              }`}
            >
              <span className='font-normal text-xs leading-normal'>Input</span>
            </button>
            {/* Copy button for code input - only show when input is selected and it's a function block with code */}
            {shouldShowCodeDisplay && (
              <Button
                variant='ghost'
                size='sm'
                className='h-5 w-5 p-0 hover:bg-transparent'
                onClick={handleCopy}
              >
                {showCopySuccess ? (
                  <Check className='h-3 w-3 text-gray-500' />
                ) : (
                  <Clipboard className='h-3 w-3 text-muted-foreground' />
                )}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Response area */}
      <div className='space-y-2 pb-2'>
        {/* Error display */}
        {entry.error && !showInput && (
          <div className='rounded-lg bg-[#F6D2D2] p-3 dark:bg-[#442929]'>
            <div className='overflow-hidden whitespace-pre-wrap break-all font-normal text-[#DC2626] text-sm leading-normal dark:text-[#F87171]'>
              {entry.error}
            </div>
          </div>
        )}

        {/* Warning display */}
        {entry.warning && !showInput && (
          <div className='rounded-lg border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800/50'>
            <div className='mb-1 font-normal text-sm text-yellow-800 leading-normal dark:text-yellow-200'>
              Warning
            </div>
            <div className='overflow-hidden whitespace-pre-wrap break-all font-normal text-sm text-yellow-700 leading-normal dark:text-yellow-300'>
              {entry.warning}
            </div>
          </div>
        )}

        {/* Content display */}
        {(showInput ? hasInputData : entry.output != null && !entry.error) && (
          <div className={`rounded-lg bg-secondary/50 ${shouldShowCodeDisplay ? 'p-0' : 'p-3'}`}>
            {shouldShowCodeDisplay ? (
              /* Code display - replace entire content */
              <CodeDisplay code={entry.input.code} />
            ) : (
              <div className='relative'>
                {/* Copy and Expand/Collapse buttons */}
                <div className='absolute top-[-2.8] right-0 z-10 flex items-center gap-1'>
                  {/* Audio controls - only show if audio data exists and we're showing output */}
                  {hasAudio && !showInput && (
                    <>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-6 w-6 p-0 hover:bg-transparent'
                        onClick={togglePlay}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                      >
                        {isPlaying ? (
                          <Pause className='h-3 w-3 text-muted-foreground' />
                        ) : (
                          <Play className='h-3 w-3 text-muted-foreground' />
                        )}
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-6 w-6 p-0 hover:bg-transparent'
                        onClick={downloadAudio}
                        aria-label='Download audio'
                      >
                        <Download className='h-3 w-3 text-muted-foreground' />
                      </Button>
                    </>
                  )}
                  {/* Image controls - only show if image data exists and didn't fail to load and we're showing output */}
                  {showImageDownload && !showInput && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 w-6 p-0 hover:bg-transparent'
                      onClick={downloadImage}
                      aria-label='Download image'
                    >
                      <Download className='h-3 w-3 text-muted-foreground' />
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-0 hover:bg-transparent'
                    onClick={handleCopy}
                  >
                    {showCopySuccess ? (
                      <Check className='h-3 w-3 text-gray-500' />
                    ) : (
                      <Clipboard className='h-3 w-3 text-muted-foreground' />
                    )}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-0 hover:bg-transparent'
                    onClick={() => setIsExpanded(!isExpanded)}
                  >
                    {isExpanded ? (
                      <ChevronUp className='h-3 w-3 text-muted-foreground' />
                    ) : (
                      <ChevronDown className='h-3 w-3 text-muted-foreground' />
                    )}
                  </Button>
                </div>

                {/* Image preview - show before JSON content - only for output mode */}
                {hasImage && !showInput && (
                  <ImagePreview
                    imageUrl={imageUrl || undefined}
                    imageData={imageData || undefined}
                    isBase64={isBase64Image}
                    onLoadError={handleImageLoadError}
                  />
                )}

                {/* Content */}
                {isExpanded ? (
                  <div className='max-w-full overflow-hidden break-all font-mono font-normal text-muted-foreground text-sm leading-normal'>
                    <JSONView data={displayData} />
                  </div>
                ) : (
                  <div
                    className='max-w-full cursor-pointer overflow-hidden break-all font-mono font-normal text-muted-foreground text-sm leading-normal'
                    onClick={() => setIsExpanded(true)}
                  >
                    {'{...}'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* No output message */}
        {!showInput && entry.output == null && !entry.error && (
          <div className='rounded-lg bg-secondary/50 p-3'>
            <div className='text-center font-normal text-muted-foreground text-sm leading-normal'>
              No output
            </div>
          </div>
        )}

        {/* No input message */}
        {showInput && !hasInputData && (
          <div className='rounded-lg bg-secondary/50 p-3'>
            <div className='text-center font-normal text-muted-foreground text-sm leading-normal'>
              No input
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
