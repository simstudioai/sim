import { useEffect, useRef, useState } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'
import Editor from 'react-simple-code-editor'
import { Button } from '@/components/ui/button'
import { EnvVarDropdown, checkEnvVarTrigger } from '@/components/ui/env-var-dropdown'
import { TagDropdown, checkTagTrigger } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface CodeProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  placeholder?: string
}

export function Code({
  blockId,
  subBlockId,
  isConnecting,
  placeholder = 'Write JavaScript...',
}: CodeProps) {
  // State management
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [code, setCode] = useState('')
  const [lineCount, setLineCount] = useState(1)
  const [showTags, setShowTags] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])
  const [isCollapsed, setIsCollapsed] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)

  // Effects
  useEffect(() => {
    if (storeValue !== null) {
      setCode(storeValue.toString())
    }
  }, [storeValue])

  useEffect(() => {
    if (!editorRef.current) return

    const calculateVisualLines = () => {
      const preElement = editorRef.current?.querySelector('pre')
      if (!preElement) return

      const lines = code.split('\n')
      const newVisualLineHeights: number[] = []

      const container = document.createElement('div')
      container.style.cssText = `
        position: absolute;
        visibility: hidden;
        width: ${preElement.clientWidth}px;
        font-family: ${window.getComputedStyle(preElement).fontFamily};
        font-size: ${window.getComputedStyle(preElement).fontSize};
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      `
      document.body.appendChild(container)

      lines.forEach((line) => {
        const lineDiv = document.createElement('div')

        if (line.includes('<') && line.includes('>')) {
          const parts = line.split(/(<[^>]+>)/g)
          parts.forEach((part) => {
            const span = document.createElement('span')
            span.textContent = part
            if (part.startsWith('<') && part.endsWith('>')) {
              span.style.color = 'rgb(153, 0, 85)'
            }
            lineDiv.appendChild(span)
          })
        } else {
          lineDiv.textContent = line || ' '
        }

        container.appendChild(lineDiv)
        const actualHeight = lineDiv.getBoundingClientRect().height
        const lineUnits = Math.ceil(actualHeight / 21)
        newVisualLineHeights.push(lineUnits)
        container.removeChild(lineDiv)
      })

      document.body.removeChild(container)
      setVisualLineHeights(newVisualLineHeights)
      setLineCount(newVisualLineHeights.reduce((sum, height) => sum + height, 0))
    }

    const resizeObserver = new ResizeObserver(calculateVisualLines)
    resizeObserver.observe(editorRef.current)

    return () => resizeObserver.disconnect()
  }, [code])

  // Handlers
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const textarea = editorRef.current?.querySelector('textarea')
      const dropPosition = textarea?.selectionStart ?? code.length
      const newValue = code.slice(0, dropPosition) + '<' + code.slice(dropPosition)

      setCode(newValue)
      setStoreValue(newValue)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      if (data.connectionData?.sourceBlockId) {
        setActiveSourceBlockId(data.connectionData.sourceBlockId)
      }

      setTimeout(() => {
        if (textarea) {
          textarea.selectionStart = dropPosition + 1
          textarea.selectionEnd = dropPosition + 1
          textarea.focus()
        }
      }, 0)
    } catch (error) {
      console.error('Failed to parse drop data:', error)
    }
  }

  const handleTagSelect = (newValue: string) => {
    setCode(newValue)
    setStoreValue(newValue)
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  const handleEnvVarSelect = (newValue: string) => {
    setCode(newValue)
    setStoreValue(newValue)
    setShowEnvVars(false)
  }

  // Render helpers
  const renderLineNumbers = () => {
    const numbers: JSX.Element[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height) => {
      for (let i = 0; i < height; i++) {
        numbers.push(
          <div
            key={`${lineNumber}-${i}`}
            className={cn('text-xs text-muted-foreground leading-[21px]', i > 0 && 'invisible')}
          >
            {lineNumber}
          </div>
        )
      }
      lineNumber++
    })

    return numbers
  }

  return (
    <div
      className={cn(
        'relative min-h-[100px] rounded-md border bg-background font-mono text-sm group',
        isConnecting && 'ring-2 ring-blue-500 ring-offset-2'
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {code.split('\n').length > 5 && (
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            'absolute right-2 top-2 z-10 p-1.5 rounded-md',
            'bg-accent/50 hover:bg-accent text-muted-foreground hover:text-foreground',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'text-xs font-medium'
          )}
        >
          {isCollapsed ? 'Expand' : 'Collapse'}
        </button>
      )}

      <div
        className="absolute left-0 top-0 bottom-0 w-[30px] bg-muted/30 flex flex-col items-end pr-3 pt-3 select-none overflow-hidden"
        aria-hidden="true"
      >
        {renderLineNumbers()}
      </div>

      <div
        className={cn(
          'pl-[30px] pt-0 mt-0 relative',
          isCollapsed && 'max-h-[126px] overflow-hidden'
        )}
        ref={editorRef}
      >
        {code.length === 0 && (
          <div className="absolute left-[42px] top-[12px] text-muted-foreground/50 select-none pointer-events-none">
            {placeholder}
          </div>
        )}

        <Editor
          value={code}
          onValueChange={(newCode) => {
            if (!isCollapsed) {
              setCode(newCode)
              setStoreValue(newCode)

              const textarea = editorRef.current?.querySelector('textarea')
              if (textarea) {
                const pos = textarea.selectionStart
                setCursorPosition(pos)

                const tagTrigger = checkTagTrigger(newCode, pos)
                setShowTags(tagTrigger.show)
                if (!tagTrigger.show) {
                  setActiveSourceBlockId(null)
                }

                const envVarTrigger = checkEnvVarTrigger(newCode, pos)
                setShowEnvVars(envVarTrigger.show)
                setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowTags(false)
              setShowEnvVars(false)
            }
          }}
          highlight={(code) => highlight(code, languages.javascript, 'javascript')}
          padding={12}
          style={{
            fontFamily: 'inherit',
            minHeight: '46px',
            lineHeight: '21px',
          }}
          className={cn('focus:outline-none', isCollapsed && 'pointer-events-none select-none')}
          textareaClassName={cn(
            'focus:outline-none focus:ring-0 bg-transparent',
            isCollapsed && 'pointer-events-none'
          )}
        />

        {showEnvVars && (
          <EnvVarDropdown
            visible={showEnvVars}
            onSelect={handleEnvVarSelect}
            searchTerm={searchTerm}
            inputValue={code}
            cursorPosition={cursorPosition}
            onClose={() => {
              setShowEnvVars(false)
              setSearchTerm('')
            }}
          />
        )}

        {showTags && (
          <TagDropdown
            visible={showTags}
            onSelect={handleTagSelect}
            blockId={blockId}
            activeSourceBlockId={activeSourceBlockId}
            inputValue={code}
            cursorPosition={cursorPosition}
            onClose={() => {
              setShowTags(false)
              setActiveSourceBlockId(null)
            }}
          />
        )}
      </div>
    </div>
  )
}
