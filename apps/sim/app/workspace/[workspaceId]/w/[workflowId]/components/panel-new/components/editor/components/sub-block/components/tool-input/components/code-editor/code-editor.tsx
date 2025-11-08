import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import 'prismjs/components/prism-json'
import { Wand2 } from 'lucide-react'
import Editor from 'react-simple-code-editor'
import {
  CODE_LINE_HEIGHT_PX,
  Code,
  calculateGutterWidth,
  getCodeEditorProps,
  highlight,
  languages,
} from '@/components/emcn/components/code/code'
import { Button } from '@/components/ui/button'
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
  schemaParameters?: Array<{ name: string; type: string; description: string; required: boolean }>
  showWandButton?: boolean
  onWandClick?: () => void
  wandButtonDisabled?: boolean
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
  schemaParameters = [],
  showWandButton = false,
  onWandClick,
  wandButtonDisabled = false,
}: CodeEditorProps) {
  const [code, setCode] = useState(value)
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])

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
        const lineUnits = Math.ceil(actualHeight / CODE_LINE_HEIGHT_PX)
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
  const gutterWidth = calculateGutterWidth(lineCount)

  // Render helpers
  const renderLineNumbers = () => {
    const numbers: ReactElement[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height) => {
      for (let i = 0; i < height; i++) {
        numbers.push(
          <div
            key={`${lineNumber}-${i}`}
            className={cn(
              'text-xs tabular-nums',
              `leading-[${CODE_LINE_HEIGHT_PX}px]`,
              i > 0 ? 'invisible' : 'text-[#a8a8a8]'
            )}
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

    // Collect all syntax highlights to apply in a single pass
    type SyntaxHighlight = {
      start: number
      end: number
      replacement: string
    }
    const highlights: SyntaxHighlight[] = []

    // Find environment variables with {{var_name}} syntax
    let match
    const envVarRegex = /\{\{([^}]+)\}\}/g
    while ((match = envVarRegex.exec(highlighted)) !== null) {
      highlights.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement: `<span class="text-blue-500">${match[0]}</span>`,
      })
    }

    // Find tags with <tag_name> syntax (not in HTML context)
    if (!language.includes('html')) {
      const tagRegex = /<([^>\s/]+)>/g
      while ((match = tagRegex.exec(highlighted)) !== null) {
        // Skip HTML comments and closing tags
        if (!match[0].startsWith('<!--') && !match[0].includes('</')) {
          const escaped = `&lt;${match[1]}&gt;`
          highlights.push({
            start: match.index,
            end: match.index + match[0].length,
            replacement: `<span class="text-blue-500">${escaped}</span>`,
          })
        }
      }
    }

    // Find schema parameters as whole words
    if (schemaParameters.length > 0) {
      schemaParameters.forEach((param) => {
        // Escape special regex characters in parameter name
        const escapedName = param.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const paramRegex = new RegExp(`\\b(${escapedName})\\b`, 'g')
        while ((match = paramRegex.exec(highlighted)) !== null) {
          // Check if this position is already inside an HTML tag
          // by looking for unclosed < before this position
          let insideTag = false
          let pos = match.index - 1
          while (pos >= 0) {
            if (highlighted[pos] === '>') break
            if (highlighted[pos] === '<') {
              insideTag = true
              break
            }
            pos--
          }

          if (!insideTag) {
            highlights.push({
              start: match.index,
              end: match.index + match[0].length,
              replacement: `<span class="text-green-600 font-medium">${match[0]}</span>`,
            })
          }
        }
      })
    }

    // Sort highlights by start position (reverse order to maintain positions)
    highlights.sort((a, b) => b.start - a.start)

    // Apply all highlights
    highlights.forEach(({ start, end, replacement }) => {
      highlighted = highlighted.slice(0, start) + replacement + highlighted.slice(end)
    })

    return highlighted
  }

  return (
    <Code.Container className={className} style={{ minHeight }}>
      {showWandButton && onWandClick && (
        <Button
          variant='ghost'
          size='icon'
          onClick={onWandClick}
          disabled={wandButtonDisabled}
          aria-label='Generate with AI'
          className='absolute top-2 right-3 z-10 h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground opacity-0 shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-foreground hover:shadow group-hover:opacity-100'
        >
          <Wand2 className='h-4 w-4' />
        </Button>
      )}

      <Code.Gutter width={gutterWidth}>{renderLineNumbers()}</Code.Gutter>

      <Code.Content paddingLeft={`${gutterWidth}px`} editorRef={editorRef}>
        <Code.Placeholder gutterWidth={gutterWidth} show={code.length === 0 && !!placeholder}>
          {placeholder}
        </Code.Placeholder>

        <Editor
          value={code}
          onValueChange={(newCode) => {
            setCode(newCode)
            onChange(newCode)
          }}
          onKeyDown={onKeyDown}
          highlight={(code) => customHighlight(code)}
          disabled={disabled}
          {...getCodeEditorProps({ disabled })}
          className={cn(getCodeEditorProps({ disabled }).className, 'h-full')}
          style={{ minHeight }}
          textareaClassName={cn(
            getCodeEditorProps({ disabled }).textareaClassName,
            '!block !h-full !min-h-full'
          )}
        />
      </Code.Content>
    </Code.Container>
  )
}
