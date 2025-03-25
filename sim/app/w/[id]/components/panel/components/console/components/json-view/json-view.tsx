import { useEffect, useState } from 'react'
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
