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
} from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/core/utils/cn'
import {
  createEnvVarPattern,
  createWorkflowVariablePattern,
} from '@/executor/utils/reference-validation'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: 'javascript' | 'json'
  placeholder?: string
  className?: string
  gutterClassName?: string
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
  gutterClassName = '',
  minHeight,
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

  const lineCount = code.split('\n').length
  const gutterWidth = calculateGutterWidth(lineCount)

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

  const customHighlight = (code: string) => {
    if (!highlightVariables || language !== 'javascript') {
      return highlight(code, languages[language], language)
    }

    const escapeHtml = (text: string) =>
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const placeholders: Array<{
      placeholder: string
      original: string
      type: 'env' | 'param' | 'variable'
    }> = []
    let processedCode = code

    processedCode = processedCode.replace(createEnvVarPattern(), (match) => {
      const placeholder = `__ENV_VAR_${placeholders.length}__`
      placeholders.push({ placeholder, original: match, type: 'env' })
      return placeholder
    })

    processedCode = processedCode.replace(createWorkflowVariablePattern(), (match) => {
      const placeholder = `__VARIABLE_${placeholders.length}__`
      placeholders.push({ placeholder, original: match, type: 'variable' })
      return placeholder
    })

    if (schemaParameters.length > 0) {
      schemaParameters.forEach((param) => {
        const escapedName = param.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const paramRegex = new RegExp(`\\b(${escapedName})\\b`, 'g')
        processedCode = processedCode.replace(paramRegex, (match) => {
          const placeholder = `__PARAM_${placeholders.length}__`
          placeholders.push({ placeholder, original: match, type: 'param' })
          return placeholder
        })
      })
    }

    let highlighted = highlight(processedCode, languages[language], language)

    placeholders.forEach(({ placeholder, original, type }) => {
      const escapedOriginal = type === 'variable' ? escapeHtml(original) : original
      const replacement =
        type === 'env' || type === 'variable'
          ? `<span style="color: var(--brand-secondary);">${escapedOriginal}</span>`
          : `<span style="color: var(--brand-secondary); font-weight: 500;">${original}</span>`

      highlighted = highlighted.replace(placeholder, replacement)
    })

    return highlighted
  }

  return (
    <Code.Container className={className} style={minHeight ? { minHeight } : undefined}>
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

      <Code.Gutter width={gutterWidth} className={gutterClassName}>
        {renderLineNumbers()}
      </Code.Gutter>

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
          style={minHeight ? { minHeight } : undefined}
          textareaClassName={cn(
            getCodeEditorProps({ disabled }).textareaClassName,
            '!block !h-full !min-h-full'
          )}
        />
      </Code.Content>
    </Code.Container>
  )
}
