import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  CODE_LINE_HEIGHT_PX,
  Code,
  calculateGutterWidth,
  chipFieldSurfaceClass,
  cn,
  getCodeEditorProps,
  highlight,
  languages,
} from '@sim/emcn'
import Editor from 'react-simple-code-editor'
import type { SchemaParameter } from '@/app/workspace/[workspaceId]/components/custom-tool-editor/custom-tool-schema'
import {
  createEnvVarPattern,
  createWorkflowVariablePattern,
} from '@/executor/utils/reference-validation'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: 'javascript' | 'json'
  placeholder?: string
  /** Layout/sizing only — the chip-field chrome is owned by this component. */
  className?: string
  /** Swaps the field border to the error token. */
  error?: boolean
  minHeight?: string
  highlightVariables?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
  schemaParameters?: SchemaParameter[]
}

const EMPTY_SCHEMA_PARAMETERS: NonNullable<CodeEditorProps['schemaParameters']> = []

export function CodeEditor({
  value,
  onChange,
  language,
  placeholder = '',
  className = '',
  error = false,
  minHeight,
  highlightVariables = true,
  onKeyDown,
  disabled = false,
  schemaParameters = EMPTY_SCHEMA_PARAMETERS,
}: CodeEditorProps) {
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])

  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const calculateVisualLines = () => {
      const preElement = editorRef.current?.querySelector('pre')
      if (!preElement) return

      const lines = value.split('\n')
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
  }, [value])

  const lineCount = value.split('\n').length
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
              i > 0 ? 'invisible' : 'text-[var(--code-line-number)]'
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
    <Code.Container
      className={cn(chipFieldSurfaceClass, error && 'border-[var(--text-error)]', className)}
      style={minHeight ? { minHeight } : undefined}
    >
      <Code.Gutter width={gutterWidth} className='rounded-l-lg bg-transparent dark:bg-transparent'>
        {renderLineNumbers()}
      </Code.Gutter>

      <Code.Content paddingLeft={`${gutterWidth}px`} editorRef={editorRef}>
        <Code.Placeholder gutterWidth={gutterWidth} show={value.length === 0 && !!placeholder}>
          {placeholder}
        </Code.Placeholder>

        <Editor
          value={value}
          onValueChange={onChange}
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
