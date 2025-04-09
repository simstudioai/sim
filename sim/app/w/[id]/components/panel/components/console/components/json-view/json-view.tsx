import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface JSONViewProps {
  data: any
  level?: number
  initiallyExpanded?: boolean
}

const MAX_STRING_LENGTH = 150

const TruncatedValue = ({ value }: { value: string }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (value.length <= MAX_STRING_LENGTH) {
    return <span>{value}</span>
  }

  return (
    <span>
      {isExpanded ? value : `${value.slice(0, MAX_STRING_LENGTH)}...`}
      <Button
        variant="link"
        size="sm"
        className="px-1 h-auto text-xs text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
      >
        {isExpanded ? 'Show less' : 'Show more'}
      </Button>
    </span>
  )
}

const copyToClipboard = (data: any) => {
  const stringified = JSON.stringify(data, null, 2)
  navigator.clipboard.writeText(stringified)
}

// Helper function to check if an object contains an image URL
const isImageData = (obj: any): boolean => {
  return obj && typeof obj === 'object' && 'url' in obj && typeof obj.url === 'string'
}

// Helper function to check if a string is likely a base64 image
const isBase64Image = (str: string): boolean => {
  if (typeof str !== 'string') return false
  // Check if it's a reasonably long string that could be a base64 image
  // and contains only valid base64 characters
  return str.length > 100 && /^[A-Za-z0-9+/=]+$/.test(str)
}

// Check if this is a response with the new image structure
// Strict validation to only detect actual image responses
const hasImageContent = (obj: any): boolean => {
  // Debug check - basic structure validation
  if (
    !(
      obj &&
      typeof obj === 'object' &&
      'content' in obj &&
      typeof obj.content === 'string' &&
      'metadata' in obj &&
      typeof obj.metadata === 'object'
    )
  ) {
    return false
  }

  // Case 1: Has explicit image data
  const hasExplicitImageData =
    'image' in obj &&
    typeof obj.image === 'string' &&
    obj.image.length > 0 &&
    isBase64Image(obj.image)

  if (hasExplicitImageData) {
    return true
  }

  // Case 2: Has explicit image type in metadata
  const hasExplicitImageType =
    obj.metadata &&
    obj.metadata.type &&
    typeof obj.metadata.type === 'string' &&
    obj.metadata.type.toLowerCase() === 'image'

  if (hasExplicitImageType) {
    return true
  }

  // Case 3: Content URL points to an image file
  const isImageUrl =
    typeof obj.content === 'string' &&
    obj.content.startsWith('http') &&
    !!obj.content.toLowerCase().match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/)

  return isImageUrl
}

// Image preview component with support for both URL and base64
const ImagePreview = ({
  imageUrl,
  imageData,
  isBase64 = false,
}: {
  imageUrl?: string
  imageData?: string
  isBase64?: boolean
}) => {
  const [loadError, setLoadError] = useState(false)

  const downloadImage = async () => {
    try {
      let blob: Blob
      if (isBase64 && imageData && imageData.length > 0) {
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
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`
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

  // Only display image if we have valid data
  const hasValidData =
    (isBase64 && imageData && imageData.length > 0) || (imageUrl && imageUrl.length > 0)

  if (!hasValidData) {
    return <div className="my-2 text-muted-foreground">Image data unavailable</div>
  }

  if (loadError) {
    return <div className="my-2 text-muted-foreground">Failed to load image</div>
  }

  // Determine the source for the image
  const imageSrc =
    isBase64 && imageData && imageData.length > 0
      ? `data:image/png;base64,${imageData}`
      : imageUrl || ''

  return (
    <div className="my-2 relative group">
      <img
        src={imageSrc}
        alt="Generated image"
        className="max-w-full h-auto rounded-md border"
        onError={(e) => {
          console.error('Image failed to load:', imageSrc)
          setLoadError(true)
          e.currentTarget.alt = 'Failed to load image'
          e.currentTarget.style.height = '100px'
          e.currentTarget.style.width = '100%'
          e.currentTarget.style.display = 'flex'
          e.currentTarget.style.alignItems = 'center'
          e.currentTarget.style.justifyContent = 'center'
          e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)'
        }}
      />
      {!loadError && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 bg-background/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation()
              downloadImage()
            }}
          >
            <Download className="h-4 w-4" />
            <span className="sr-only">Download image</span>
          </Button>
        </div>
      )}
    </div>
  )
}

export const JSONView = ({ data, level = 0, initiallyExpanded = false }: JSONViewProps) => {
  const [isCollapsed, setIsCollapsed] = useState(!initiallyExpanded)
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    setIsCollapsed(!initiallyExpanded)
  }, [initiallyExpanded])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    const handleClickOutside = () => setContextMenuPosition(null)
    if (contextMenuPosition) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenuPosition])

  // Check if this is a base64 image string
  const isBase64ImageString = typeof data === 'string' && isBase64Image(data)

  // Check if current object contains image URL
  const hasImageUrl = isImageData(data)

  // Check if this is a response object with the new image format
  const isResponseWithImage = hasImageContent(data)

  // Check if this is response.output with the new image structure
  const isToolResponseWithImage =
    data && typeof data === 'object' && data.output && hasImageContent(data.output)

  if (data === null) return <span className="text-muted-foreground">null</span>

  // Handle base64 image strings directly
  if (isBase64ImageString) {
    return (
      <div onContextMenu={handleContextMenu}>
        <ImagePreview imageData={data} isBase64={true} />
        {contextMenuPosition && (
          <div
            className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
              onClick={() => copyToClipboard(data)}
            >
              Copy base64 string
            </button>
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center gap-2"
              onClick={() => {
                document
                  .querySelector<HTMLButtonElement>('.group .bg-background\\/80 button')
                  ?.click()
              }}
            >
              <Download className="h-4 w-4" />
              Download image
            </button>
          </div>
        )}
      </div>
    )
  }

  if (typeof data !== 'object') {
    const stringValue = JSON.stringify(data)
    return (
      <span
        onContextMenu={handleContextMenu}
        className={`${typeof data === 'string' ? 'text-success' : 'text-info'} break-all relative`}
      >
        {typeof data === 'string' ? <TruncatedValue value={stringValue} /> : stringValue}
        {contextMenuPosition && (
          <div
            className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
              onClick={() => copyToClipboard(data)}
            >
              Copy value
            </button>
          </div>
        )}
      </span>
    )
  }

  // Handle objects that have the new image structure
  if (isResponseWithImage) {
    // Get the URL from content field since that's where it should be
    const imageUrl = data.content && typeof data.content === 'string' ? data.content : undefined
    // Check if we have valid image data
    const hasValidImage = data.image && typeof data.image === 'string' && data.image.length > 0

    return (
      <div className="relative" onContextMenu={handleContextMenu}>
        <span
          className="cursor-pointer select-none inline-flex items-center text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation()
            setIsCollapsed(!isCollapsed)
          }}
        >
          <span className="text-xs leading-none mr-1">{isCollapsed ? '▶' : '▼'}</span>
          <span>{'{'}</span>
          {isCollapsed ? '...' : ''}
        </span>

        {!isCollapsed && (
          <div className="ml-4 break-words">
            {Object.entries(data).map(([key, value], index) => {
              const isImageKey = key === 'image'

              return (
                <div key={key} className="break-all">
                  <span className="text-muted-foreground">{key}</span>:{' '}
                  {isImageKey ? (
                    <div>
                      <span className="text-success inline-block mb-2">
                        {hasValidImage && typeof value === 'string' && value.length > 100 ? (
                          <TruncatedValue value={JSON.stringify('[base64 image data]')} />
                        ) : (
                          '""'
                        )}
                      </span>
                      {/* Show image preview within the image field */}
                      <ImagePreview
                        imageUrl={imageUrl}
                        imageData={
                          hasValidImage && isBase64Image(data.image) ? data.image : undefined
                        }
                        isBase64={hasValidImage && isBase64Image(data.image)}
                      />
                    </div>
                  ) : (
                    <JSONView data={value} level={level + 1} />
                  )}
                  {index < Object.entries(data).length - 1 && ','}
                </div>
              )
            })}
          </div>
        )}

        {contextMenuPosition && (
          <div
            className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
              onClick={() => copyToClipboard(data)}
            >
              Copy object
            </button>
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center gap-2"
              onClick={() => {
                document
                  .querySelector<HTMLButtonElement>('.group .bg-background\\/80 button')
                  ?.click()
              }}
            >
              <Download className="h-4 w-4" />
              Download image
            </button>
          </div>
        )}

        <span className="text-muted-foreground">{'}'}</span>
      </div>
    )
  }

  // Handle tool response objects with the new image structure in output
  if (isToolResponseWithImage) {
    const outputData = data.output || {}
    const imageUrl =
      outputData.content && typeof outputData.content === 'string' ? outputData.content : undefined
    const hasValidImage =
      outputData.image && typeof outputData.image === 'string' && outputData.image.length > 0

    return (
      <div className="relative" onContextMenu={handleContextMenu}>
        <span
          className="cursor-pointer select-none inline-flex items-center text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation()
            setIsCollapsed(!isCollapsed)
          }}
        >
          <span className="text-xs leading-none mr-1">{isCollapsed ? '▶' : '▼'}</span>
          <span>{'{'}</span>
          {isCollapsed ? '...' : ''}
        </span>

        {!isCollapsed && (
          <div className="ml-4 break-words">
            {Object.entries(data).map(([key, value]: [string, any], index) => {
              const isOutputKey = key === 'output'

              return (
                <div key={key} className="break-all">
                  <span className="text-muted-foreground">{key}</span>:{' '}
                  {isOutputKey ? (
                    <div className="relative">
                      <span
                        className="cursor-pointer select-none inline-flex items-center text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          const nestedElem = e.currentTarget.nextElementSibling
                          if (nestedElem) {
                            nestedElem.classList.toggle('hidden')
                          }
                        }}
                      >
                        <span className="text-xs leading-none mr-1">▼</span>
                        <span>{'{'}</span>
                      </span>
                      <div className="ml-4 break-words">
                        {Object.entries(value).map(
                          ([outputKey, outputValue]: [string, any], idx) => {
                            const isImageSubKey = outputKey === 'image'

                            return (
                              <div key={outputKey} className="break-all">
                                <span className="text-muted-foreground">{outputKey}</span>:{' '}
                                {isImageSubKey ? (
                                  <div>
                                    <span className="text-success inline-block mb-2">
                                      {hasValidImage && outputValue.length > 100 ? (
                                        <TruncatedValue
                                          value={JSON.stringify('[base64 image data]')}
                                        />
                                      ) : (
                                        '""'
                                      )}
                                    </span>
                                    {/* Show image preview within nested image field */}
                                    <ImagePreview
                                      imageUrl={imageUrl}
                                      imageData={
                                        hasValidImage && isBase64Image(outputValue)
                                          ? outputValue
                                          : undefined
                                      }
                                      isBase64={hasValidImage && isBase64Image(outputValue)}
                                    />
                                  </div>
                                ) : (
                                  <JSONView data={outputValue} level={level + 2} />
                                )}
                                {idx < Object.entries(value).length - 1 && ','}
                              </div>
                            )
                          }
                        )}
                      </div>
                      <span className="text-muted-foreground">{'}'}</span>
                    </div>
                  ) : (
                    <JSONView data={value} level={level + 1} />
                  )}
                  {index < Object.entries(data).length - 1 && ','}
                </div>
              )
            })}
          </div>
        )}

        {contextMenuPosition && (
          <div
            className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
              onClick={() => copyToClipboard(data)}
            >
              Copy object
            </button>
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center gap-2"
              onClick={() => {
                document
                  .querySelector<HTMLButtonElement>('.group .bg-background\\/80 button')
                  ?.click()
              }}
            >
              <Download className="h-4 w-4" />
              Download image
            </button>
          </div>
        )}

        <span className="text-muted-foreground">{'}'}</span>
      </div>
    )
  }

  const isArray = Array.isArray(data)
  const items = isArray ? data : Object.entries(data)
  const isEmpty = items.length === 0

  if (isEmpty) {
    return <span className="text-muted-foreground">{isArray ? '[]' : '{}'}</span>
  }

  return (
    <div className="relative" onContextMenu={handleContextMenu}>
      <span
        className="cursor-pointer select-none inline-flex items-center text-muted-foreground"
        onClick={(e) => {
          e.stopPropagation()
          setIsCollapsed(!isCollapsed)
        }}
      >
        <span className="text-xs leading-none mr-1">{isCollapsed ? '▶' : '▼'}</span>
        <span>{isArray ? '[' : '{'}</span>
        {isCollapsed ? '...' : ''}
      </span>

      {/* Direct image render for objects with image URLs */}
      {!isCollapsed && hasImageUrl && <ImagePreview imageUrl={data.url} />}

      {contextMenuPosition && (
        <div
          className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
            onClick={() => copyToClipboard(data)}
          >
            Copy object
          </button>
          {hasImageUrl && (
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center gap-2"
              onClick={() => {
                document
                  .querySelector<HTMLButtonElement>('.group .bg-background\\/80 button')
                  ?.click()
              }}
            >
              <Download className="h-4 w-4" />
              Download image
            </button>
          )}
        </div>
      )}

      {!isCollapsed && (
        <div className="ml-4 break-words">
          {isArray
            ? items.map((item, index) => (
                <div key={index} className="break-all">
                  <JSONView data={item} level={level + 1} />
                  {index < items.length - 1 && ','}
                </div>
              ))
            : (items as [string, any][]).map(([key, value], index) => {
                // Handle the case where we have content (URL) and image (base64) fields
                const isImageField =
                  key === 'image' && typeof value === 'string' && value.length > 100

                return (
                  <div key={key} className="break-all">
                    <span className="text-muted-foreground">{key}</span>:{' '}
                    {isImageField ? (
                      <span className="text-success">
                        <TruncatedValue value={JSON.stringify('[base64 image data]')} />
                      </span>
                    ) : (
                      <JSONView data={value} level={level + 1} />
                    )}
                    {index < items.length - 1 && ','}
                  </div>
                )
              })}
        </div>
      )}
      <span className="text-muted-foreground">{isArray ? ']' : '}'}</span>
    </div>
  )
}
