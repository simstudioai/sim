import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-json'
import 'prismjs/themes/prism.css'

import Editor from 'react-simple-code-editor'
import { cn } from '@/lib/utils'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: 'javascript' | 'json'
  placeholder?: string
  className?: string
  minHeight?: string
  highlightVariables?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
}

export function CodeEditor({
  value,
  onChange,
  language,
  placeholder = '',
  className = '',
  minHeight = '360px',
  highlightVariables = true,
  onKeyDown,
  disabled = false,
}: CodeEditorProps) {
  const [code, setCode] = useState(value)
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])
  const [isCollapsed, setIsCollapsed] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCode(value)
  }, [value])

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
        lineDiv.textContent = line || ' '
        container.appendChild(lineDiv)
        const actualHeight = lineDiv.getBoundingClientRect().height
        const lineUnits = Math.ceil(actualHeight / 21)
        newVisualLineHeights.push(lineUnits)
        container.removeChild(lineDiv)
      })

      document.body.removeChild(container)
      setVisualLineHeights(newVisualLineHeights)
    }

    const resizeObserver = new ResizeObserver(calculateVisualLines)
    resizeObserver.observe(editorRef.current)

    return () => resizeObserver.disconnect()
  }, [code])

  // Calculate the number of lines to determine gutter width
  const lineCount = code.split('\n').length
  const gutterWidth = lineCount >= 100 ? '40px' : lineCount >= 10 ? '35px' : '30px'

  // Render helpers
  const renderLineNumbers = () => {
    const numbers: ReactElement[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height) => {
      for (let i = 0; i < height; i++) {
        numbers.push(
          <div
            key={`${lineNumber}-${i}`}
            className={cn('text-muted-foreground text-xs leading-[21px]', i > 0 && 'invisible')}
          >
            {lineNumber}
          </div>
        )
      }
      lineNumber++
    })

    return numbers
  }

  // Custom highlighter that highlights environment variables and tags
  const customHighlight = (code: string) => {
    if (!highlightVariables || language !== 'javascript') {
      // Use default Prism highlighting for non-JS or when variable highlighting is off
      return highlight(code, languages[language], language)
    }

    // First, get the default Prism highlighting
    let highlighted = highlight(code, languages[language], language)

    // Then, highlight environment variables with {{var_name}} syntax in blue
    if (highlighted.includes('{{')) {
      highlighted = highlighted.replace(
        /\{\{([^}]+)\}\}/g,
        '<span class="text-blue-500">{{$1}}</span>'
      )
    }

    // Also highlight tags with <tag_name> syntax in blue
    if (highlighted.includes('<') && !language.includes('html')) {
      highlighted = highlighted.replace(/<([^>\s/]+)>/g, (match, group) => {
        // Avoid replacing HTML tags in comments
        if (match.startsWith('<!--') || match.includes('</')) {
          return match
        }
        return `<span class="text-blue-500">&lt;${group}&gt;</span>`
      })
    }

    return highlighted
  }

  return (
    <div
      className={cn(
        'group relative min-h-[100px] rounded-md border bg-background font-mono text-sm',
        className
      )}
    >
      {code.split('\n').length > 5 && (
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            'absolute top-2 right-2 z-10 rounded-md p-1.5',
            'bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground',
            'opacity-0 transition-opacity group-hover:opacity-100',
            'font-medium text-xs'
          )}
        >
          {isCollapsed ? 'Expand' : 'Collapse'}
        </button>
      )}

      <div
        className='absolute top-0 bottom-0 left-0 flex select-none flex-col items-end overflow-hidden bg-muted/30 pt-3 pr-3'
        aria-hidden='true'
        style={{
          width: gutterWidth,
        }}
      >
        {renderLineNumbers()}
      </div>

      <div
        className={cn('relative mt-0 pt-0', isCollapsed && 'max-h-[126px] overflow-hidden')}
        ref={editorRef}
        style={{
          minHeight,
          paddingLeft: gutterWidth,
        }}
      >
        {code.length === 0 && placeholder && (
          <pre
            className='pointer-events-none absolute top-[12px] select-none overflow-visible whitespace-pre-wrap text-muted-foreground/50'
            style={{ left: `calc(${gutterWidth} + 12px)`, fontFamily: 'inherit', margin: 0 }}
          >
            {placeholder}
          </pre>
        )}

        <Editor
          value={code}
          onValueChange={(newCode) => {
            if (!isCollapsed) {
              setCode(newCode)
              onChange(newCode)
            }
          }}
          onKeyDown={onKeyDown}
          highlight={(code) => customHighlight(code)}
          padding={12}
          disabled={disabled}
          style={{
            fontFamily: 'inherit',
            minHeight: '46px',
            lineHeight: '21px',
          }}
          className={cn('focus:outline-none', isCollapsed && 'pointer-events-none select-none')}
          textareaClassName={cn(
            'focus:outline-none focus:ring-0 bg-transparent',
            (isCollapsed || disabled) && 'pointer-events-none'
          )}
        />
      </div>
    </div>
  )
}
