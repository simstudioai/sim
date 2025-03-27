import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

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

  if (data === null) return <span className="text-muted-foreground">null</span>
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

  // Check if this is an object with image data
  if (data && typeof data === 'object' && 'url' in data) {
    const downloadImage = async () => {
      try {
        let blob: Blob;
        if (data.image) {
          // Convert base64 to blob
          const byteString = atob(data.image);
          const arrayBuffer = new ArrayBuffer(byteString.length);
          const uint8Array = new Uint8Array(arrayBuffer);
          for (let i = 0; i < byteString.length; i++) {
            uint8Array[i] = byteString.charCodeAt(i);
          }
          blob = new Blob([arrayBuffer], { type: 'image/png' });
        } else {
          // Use proxy endpoint to fetch image
          const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(data.url)}`;
          const response = await fetch(proxyUrl);
          if (!response.ok) {
            throw new Error(`Failed to download image: ${response.statusText}`);
          }
          blob = await response.blob();
        }

        // Create object URL and trigger download
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `generated-image-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the URL
        setTimeout(() => URL.revokeObjectURL(url), 100);
      } catch (error) {
        console.error('Error downloading image:', error);
        // Show error to user (you can replace this with your preferred notification system)
        alert('Failed to download image. Please try again later.');
      }
    }

    return (
      <div className="space-y-4">
        <div className="relative group">
          <img
            src={data.image ? `data:image/png;base64,${data.image}` : data.url}
            alt="Generated image"
            className="max-w-full h-auto rounded-md border"
          />
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
          {contextMenuPosition && (
            <div
              className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]"
              style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
            >
              <button
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center gap-2"
                onClick={() => copyToClipboard(data)}
              >
                Copy object
              </button>
              <button
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center gap-2"
                onClick={() => downloadImage()}
              >
                <Download className="h-4 w-4" />
                Download image
              </button>
            </div>
          )}
        </div>
        <div className="space-y-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
          <div>
            <span className="font-medium">Provider:</span>{' '}
            {data.model ? (data.model.toLowerCase().includes('dall-e') ? 'DALL-E' : 'Stable Diffusion') : 'Unknown'}
          </div>
          <div>
            <span className="font-medium">Model:</span>{' '}
            {data.model || 'Unknown'}
          </div>
          {data.prompt && (
            <div>
              <span className="font-medium">Prompt:</span>{' '}
              <TruncatedValue value={data.prompt} />
            </div>
          )}
          {data.revised_prompt && (
            <div>
              <span className="font-medium">Revised Prompt:</span>{' '}
              <TruncatedValue value={data.revised_prompt} />
            </div>
          )}
          <div>
            <span className="font-medium">URL:</span>{' '}
            <TruncatedValue value={data.url} />
          </div>
          <div>
            <span className="font-medium">Created:</span>{' '}
            {new Date().toLocaleString()}
          </div>
        </div>
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
            : (items as [string, any][]).map(([key, value], index) => (
                <div key={key} className="break-all">
                  <span className="text-muted-foreground">{key}</span>:{' '}
                  <JSONView data={value} level={level + 1} />
                  {index < items.length - 1 && ','}
                </div>
              ))}
        </div>
      )}
      <span className="text-muted-foreground">{isArray ? ']' : '}'}</span>
    </div>
  )
}
