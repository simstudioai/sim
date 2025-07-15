import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface JSONViewProps {
  data: any
}

const MAX_STRING_LENGTH = 150
const MAX_OBJECT_KEYS = 10
const MAX_ARRAY_ITEMS = 20

const TruncatedValue = ({ value }: { value: string }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (value.length <= MAX_STRING_LENGTH) {
    return (
      <span className='break-all font-[380] text-muted-foreground leading-normal'>{value}</span>
    )
  }

  return (
    <span className='break-all font-[380] text-muted-foreground leading-normal'>
      {isExpanded ? value : `${value.slice(0, MAX_STRING_LENGTH)}...`}
      <Button
        variant='link'
        size='sm'
        className='h-auto px-1 font-[380] text-muted-foreground/70 text-xs hover:text-foreground'
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

const CollapsibleJSON = ({ data, depth = 0 }: { data: any; depth?: number }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (data === null) {
    return <span className='break-all font-[380] text-muted-foreground leading-normal'>null</span>
  }

  if (data === undefined) {
    return (
      <span className='break-all font-[380] text-muted-foreground leading-normal'>undefined</span>
    )
  }

  if (typeof data === 'string') {
    return <TruncatedValue value={JSON.stringify(data)} />
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return (
      <span className='break-all font-[380] text-muted-foreground leading-normal'>
        {JSON.stringify(data)}
      </span>
    )
  }

  if (Array.isArray(data)) {
    const shouldCollapse = depth > 0 && data.length > MAX_ARRAY_ITEMS

    if (shouldCollapse && !isExpanded) {
      return (
        <span
          className='cursor-pointer break-all font-[380] text-muted-foreground/70 text-xs leading-normal'
          onClick={() => setIsExpanded(true)}
        >
          {'[...]'}
        </span>
      )
    }

    return (
      <span className='break-all font-[380] text-muted-foreground/70 leading-normal'>
        {'['}
        {data.length > 0 && (
          <>
            {'\n'}
            {data.map((item, index) => (
              <span key={index} className='break-all'>
                {'  '.repeat(depth + 1)}
                <CollapsibleJSON data={item} depth={depth + 1} />
                {index < data.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {'  '.repeat(depth)}
          </>
        )}
        {']'}
      </span>
    )
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data)
    const shouldCollapse = depth > 0 && keys.length > MAX_OBJECT_KEYS

    if (shouldCollapse && !isExpanded) {
      return (
        <span
          className='cursor-pointer break-all font-[380] text-muted-foreground/70 text-xs leading-normal'
          onClick={() => setIsExpanded(true)}
        >
          {'{...}'}
        </span>
      )
    }

    return (
      <span className='break-all font-[380] text-muted-foreground/70 leading-normal'>
        {'{'}
        {keys.length > 0 && (
          <>
            {'\n'}
            {keys.map((key, index) => (
              <span key={key} className='break-all'>
                {'  '.repeat(depth + 1)}
                <span className='break-all font-[380] text-foreground leading-normal'>{key}</span>
                <span className='font-[380] text-muted-foreground/60 leading-normal'>: </span>
                <CollapsibleJSON data={data[key]} depth={depth + 1} />
                {index < keys.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {'  '.repeat(depth)}
          </>
        )}
        {'}'}
      </span>
    )
  }

  return (
    <span className='break-all font-[380] text-muted-foreground leading-normal'>
      {JSON.stringify(data)}
    </span>
  )
}

const copyToClipboard = (data: any) => {
  const stringified = JSON.stringify(data, null, 2)
  navigator.clipboard.writeText(stringified)
}

export const JSONView = ({ data }: JSONViewProps) => {
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number
    y: number
  } | null>(null)

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

  if (data === null)
    return <span className='font-[380] text-muted-foreground leading-normal'>null</span>

  // For non-object data, show simple JSON
  if (typeof data !== 'object') {
    const stringValue = JSON.stringify(data)
    return (
      <span
        onContextMenu={handleContextMenu}
        className='relative max-w-full overflow-hidden break-all font-[380] font-mono text-muted-foreground leading-normal'
      >
        {typeof data === 'string' ? (
          <TruncatedValue value={stringValue} />
        ) : (
          <span className='break-all font-[380] text-muted-foreground leading-normal'>
            {stringValue}
          </span>
        )}
        {contextMenuPosition && (
          <div
            className='fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md'
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              className='w-full px-3 py-1.5 text-left font-[380] text-sm hover:bg-accent'
              onClick={() => copyToClipboard(data)}
            >
              Copy value
            </button>
          </div>
        )}
      </span>
    )
  }

  // Default case: show JSON as formatted text with collapsible functionality
  return (
    <div onContextMenu={handleContextMenu}>
      <pre className='max-w-full overflow-hidden whitespace-pre-wrap break-all font-mono'>
        <CollapsibleJSON data={data} />
      </pre>
      {contextMenuPosition && (
        <div
          className='fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md'
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <button
            className='w-full px-3 py-1.5 text-left font-[380] text-sm hover:bg-accent'
            onClick={() => copyToClipboard(data)}
          >
            Copy object
          </button>
        </div>
      )}
    </div>
  )
}
