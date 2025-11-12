import type { ReactElement } from 'react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Check, Copy, Wand2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import 'prismjs/components/prism-python'
import Editor from 'react-simple-code-editor'
import {
  CODE_LINE_HEIGHT_PX,
  Code as CodeEditor,
  calculateGutterWidth,
  getCodeEditorProps,
  highlight,
  languages,
} from '@/components/emcn/components/code/code'
import { Button } from '@/components/ui/button'
import { CodeLanguage } from '@/lib/execution/languages'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/references'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/sub-block'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { GenerationType } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { normalizeBlockName } from '@/stores/workflows/utils'

const logger = createLogger('Code')

/**
 * Default AI prompt for Python code generation.
 */
const PYTHON_AI_PROMPT = `You are an expert Python programmer.
Generate ONLY the raw body of a Python function based on the user's request.
The code should be executable within a Python function body context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use os.environ or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'def my_func(...)') or surrounding braces. Return the final value with 'return'.
4. Imports: You may add imports as needed (standard library or pip-installed packages) without comments.
5. No Markdown: Do NOT include backticks, code fences, or any markdown.
6. Clarity: Write clean, readable Python code.`

/**
 * Line height constant for consistent rendering.
 */
const LINE_HEIGHT_PX = CODE_LINE_HEIGHT_PX

/**
 * Applies dark mode styling to Prism.js syntax tokens.
 * Note: Most styling is now handled via code-dark-theme.css
 * @param highlightedCode - The HTML string with Prism.js highlighting
 * @returns The HTML string with dark mode styles applied
 */
const applyDarkModeTokenStyling = (highlightedCode: string): string => {
  // CSS file now handles token styling with higher specificity
  return highlightedCode
}

/**
 * Type definition for code placeholders during syntax highlighting.
 */
interface CodePlaceholder {
  placeholder: string
  original: string
  type: 'var' | 'env'
}

/**
 * Creates a syntax highlighter function with custom reference and environment variable highlighting.
 * @param effectiveLanguage - The language to use for syntax highlighting
 * @param shouldHighlightReference - Function to determine if a reference should be highlighted
 * @returns A function that highlights code with syntax and custom highlights
 */
const createHighlightFunction = (
  effectiveLanguage: 'javascript' | 'python' | 'json',
  shouldHighlightReference: (part: string) => boolean
) => {
  return (codeToHighlight: string): string => {
    const placeholders: CodePlaceholder[] = []
    let processedCode = codeToHighlight

    // Replace environment variables with placeholders
    processedCode = processedCode.replace(/\{\{([^}]+)\}\}/g, (match) => {
      const placeholder = `__ENV_VAR_${placeholders.length}__`
      placeholders.push({ placeholder, original: match, type: 'env' })
      return placeholder
    })

    // Replace variable references with placeholders
    processedCode = processedCode.replace(/<([^>]+)>/g, (match) => {
      if (shouldHighlightReference(match)) {
        const placeholder = `__VAR_REF_${placeholders.length}__`
        placeholders.push({ placeholder, original: match, type: 'var' })
        return placeholder
      }
      return match
    })

    // Apply Prism syntax highlighting
    const lang = effectiveLanguage === 'python' ? 'python' : 'javascript'
    let highlightedCode = highlight(processedCode, languages[lang], lang)

    // Apply dark mode token styling
    highlightedCode = applyDarkModeTokenStyling(highlightedCode)

    // Restore and highlight the placeholders
    placeholders.forEach(({ placeholder, original, type }) => {
      if (type === 'env') {
        highlightedCode = highlightedCode.replace(
          placeholder,
          `<span class="text-blue-500">${original}</span>`
        )
      } else if (type === 'var') {
        const escaped = original.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        highlightedCode = highlightedCode.replace(
          placeholder,
          `<span class="text-blue-500">${escaped}</span>`
        )
      }
    })

    return highlightedCode
  }
}

/**
 * Props for the `Code` editor component.
 */
interface CodeProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  language?: 'javascript' | 'json' | 'python'
  generationType?: GenerationType
  value?: string
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  readOnly?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  showCopyButton?: boolean
  onValidationChange?: (isValid: boolean) => void
  wandConfig: {
    enabled: boolean
    prompt: string
    generationType?: GenerationType
    placeholder?: string
    maintainHistory?: boolean
  }
  /** Ref to expose wand control handlers to parent */
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
  /** Whether to hide the internal wand button (controlled by parent) */
  hideInternalWand?: boolean
}

export function Code({
  blockId,
  subBlockId,
  placeholder = 'Write JavaScript...',
  language = 'javascript',
  generationType = 'javascript-function-body',
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
  readOnly = false,
  defaultValue,
  showCopyButton = false,
  onValidationChange,
  wandConfig,
  wandControlRef,
  hideInternalWand = false,
}: CodeProps) {
  // Route params
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Local state
  const [code, setCode] = useState<string>('')
  const [showTags, setShowTags] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])
  const [activeLineNumber, setActiveLineNumber] = useState(1)
  const [copied, setCopied] = useState(false)

  // Refs
  const editorRef = useRef<HTMLDivElement>(null)
  const handleStreamStartRef = useRef<() => void>(() => {})
  const handleGeneratedContentRef = useRef<(generatedCode: string) => void>(() => {})
  const handleStreamChunkRef = useRef<(chunk: string) => void>(() => {})

  // Custom hooks
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const [languageValue] = useSubBlockValue<string>(blockId, 'language')

  // Derived state
  const effectiveLanguage = (languageValue as 'javascript' | 'python' | 'json') || language

  const isValidJson = useMemo(() => {
    if (subBlockId !== 'responseFormat' || !code.trim()) {
      return true
    }
    try {
      JSON.parse(code)
      return true
    } catch {
      return false
    }
  }, [subBlockId, code])

  const gutterWidthPx = useMemo(() => {
    const lineCount = code.split('\n').length
    return calculateGutterWidth(lineCount)
  }, [code])

  const aiPromptPlaceholder = useMemo(() => {
    switch (generationType) {
      case 'json-schema':
        return 'Describe the JSON schema to generate...'
      case 'json-object':
        return 'Describe the JSON object to generate...'
      default:
        return 'Describe the JavaScript code to generate...'
    }
  }, [generationType])

  const dynamicPlaceholder = useMemo(() => {
    if (languageValue === CodeLanguage.Python) {
      return 'Write Python...'
    }
    return placeholder
  }, [languageValue, placeholder])

  const dynamicWandConfig = useMemo(() => {
    if (languageValue === CodeLanguage.Python) {
      return {
        ...wandConfig,
        prompt: PYTHON_AI_PROMPT,
        placeholder: 'Describe the Python function you want to create...',
      }
    }
    return wandConfig
  }, [wandConfig, languageValue])

  // AI code generation integration
  const wandHook = useWand({
    wandConfig: dynamicWandConfig || { enabled: false, prompt: '' },
    currentValue: code,
    onStreamStart: () => handleStreamStartRef.current?.(),
    onStreamChunk: (chunk: string) => handleStreamChunkRef.current?.(chunk),
    onGeneratedContent: (content: string) => handleGeneratedContentRef.current?.(content),
  })

  const isAiLoading = wandHook?.isLoading || false
  const isAiStreaming = wandHook?.isStreaming || false
  const generateCodeStream = wandHook?.generateStream || (() => {})
  const isPromptVisible = wandHook?.isPromptVisible || false
  const showPromptInline = wandHook?.showPromptInline || (() => {})
  const hidePromptInline = wandHook?.hidePromptInline || (() => {})
  const promptInputValue = wandHook?.promptInputValue || ''
  const updatePromptValue = wandHook?.updatePromptValue || (() => {})
  const cancelGeneration = wandHook?.cancelGeneration || (() => {})

  // Store integration
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    isStreaming: isAiStreaming,
    onStreamingEnd: () => {
      logger.debug('AI streaming ended, value persisted', { blockId, subBlockId })
    },
  })

  const getDefaultValueString = () => {
    if (defaultValue === undefined || defaultValue === null) return ''
    if (typeof defaultValue === 'string') return defaultValue
    return JSON.stringify(defaultValue, null, 2)
  }

  const value = isPreview
    ? previewValue
    : propValue !== undefined
      ? propValue
      : readOnly && defaultValue !== undefined
        ? getDefaultValueString()
        : storeValue

  // Effects: JSON validation
  useEffect(() => {
    if (onValidationChange && subBlockId === 'responseFormat') {
      const timeoutId = setTimeout(() => {
        onValidationChange(isValidJson)
      }, 150)
      return () => clearTimeout(timeoutId)
    }
  }, [isValidJson, onValidationChange, subBlockId])

  // Effects: AI stream handlers setup
  useEffect(() => {
    handleStreamStartRef.current = () => {
      setCode('')
    }

    handleGeneratedContentRef.current = (generatedCode: string) => {
      setCode(generatedCode)
      if (!isPreview && !disabled) {
        setStoreValue(generatedCode)
      }
    }
  }, [isPreview, disabled, setStoreValue])

  // Effects: Set read only state for textarea
  useEffect(() => {
    if (!editorRef.current) return

    const setReadOnly = () => {
      const textarea = editorRef.current?.querySelector('textarea')
      if (textarea) {
        textarea.readOnly = readOnly
      }
    }

    setReadOnly()

    const timeoutId = setTimeout(setReadOnly, 0)

    const observer = new MutationObserver(setReadOnly)
    if (editorRef.current) {
      observer.observe(editorRef.current, {
        childList: true,
        subtree: true,
      })
    }

    return () => {
      clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [readOnly])

  // Effects: Sync code with external value
  useEffect(() => {
    if (isAiStreaming) return
    const valueString = value?.toString() ?? ''
    if (valueString !== code) {
      setCode(valueString)
    }
  }, [value, code, isAiStreaming])

  // Effects: Track active line number for cursor position
  useEffect(() => {
    const textarea = editorRef.current?.querySelector('textarea')
    if (!textarea) return

    const updateActiveLineNumber = () => {
      const pos = textarea.selectionStart
      const textBeforeCursor = code.substring(0, pos)
      const lineNumber = textBeforeCursor.split('\n').length
      setActiveLineNumber(lineNumber)
    }

    updateActiveLineNumber()

    textarea.addEventListener('click', updateActiveLineNumber)
    textarea.addEventListener('keyup', updateActiveLineNumber)
    textarea.addEventListener('focus', updateActiveLineNumber)

    return () => {
      textarea.removeEventListener('click', updateActiveLineNumber)
      textarea.removeEventListener('keyup', updateActiveLineNumber)
      textarea.removeEventListener('focus', updateActiveLineNumber)
    }
  }, [code])

  // Effects: Calculate visual line heights for proper gutter alignment
  useEffect(() => {
    if (!editorRef.current) return

    const calculateVisualLines = () => {
      const preElement = editorRef.current?.querySelector('pre')
      if (!preElement) return

      const lines = code.split('\n')
      const newVisualLineHeights: number[] = []

      const tempContainer = document.createElement('div')
      tempContainer.style.cssText = `
        position: absolute;
        visibility: hidden;
        height: auto;
        width: ${preElement.clientWidth}px;
        font-family: ${window.getComputedStyle(preElement).fontFamily};
        font-size: ${window.getComputedStyle(preElement).fontSize};
        line-height: ${LINE_HEIGHT_PX}px;
        padding: 8px;
        white-space: pre-wrap;
        word-break: break-word;
        box-sizing: border-box;
      `
      document.body.appendChild(tempContainer)

      lines.forEach((line) => {
        const lineDiv = document.createElement('div')

        if (line.includes('<') && line.includes('>')) {
          const parts = line.split(/(<[^>]+>)/g)
          parts.forEach((part) => {
            const span = document.createElement('span')
            span.textContent = part
            lineDiv.appendChild(span)
          })
        } else {
          lineDiv.textContent = line || ' '
        }

        tempContainer.appendChild(lineDiv)
        const actualHeight = lineDiv.getBoundingClientRect().height
        const lineUnits = Math.max(1, Math.ceil(actualHeight / LINE_HEIGHT_PX))
        newVisualLineHeights.push(lineUnits)
        tempContainer.removeChild(lineDiv)
      })

      document.body.removeChild(tempContainer)
      setVisualLineHeights(newVisualLineHeights)
    }

    const timeoutId = setTimeout(calculateVisualLines, 50)

    const resizeObserver = new ResizeObserver(calculateVisualLines)
    if (editorRef.current) {
      resizeObserver.observe(editorRef.current)
    }

    return () => {
      clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [code])

  // Event Handlers
  /**
   * Handles drag-and-drop events for inserting reference tags into the code editor.
   * @param e - The drag event
   */
  const handleDrop = (e: React.DragEvent) => {
    if (isPreview || readOnly) return
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const textarea = editorRef.current?.querySelector('textarea')
      const dropPosition = textarea?.selectionStart ?? code.length
      const newValue = `${code.slice(0, dropPosition)}<${code.slice(dropPosition)}`

      setCode(newValue)
      setStoreValue(newValue)
      const newCursorPosition = dropPosition + 1
      setCursorPosition(newCursorPosition)

      setTimeout(() => {
        if (textarea) {
          textarea.focus()
          textarea.selectionStart = newCursorPosition
          textarea.selectionEnd = newCursorPosition

          // Show tag dropdown after cursor is positioned
          setShowTags(true)
          if (data.connectionData?.sourceBlockId) {
            setActiveSourceBlockId(data.connectionData.sourceBlockId)
          }
        }
      }, 0)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  /**
   * Handles selection of a tag from the tag dropdown.
   * @param newValue - The new code value with the selected tag inserted
   */
  const handleTagSelect = (newValue: string) => {
    if (!isPreview && !readOnly) {
      setCode(newValue)
      emitTagSelection(newValue)
    }
    setShowTags(false)
    setActiveSourceBlockId(null)

    setTimeout(() => {
      editorRef.current?.querySelector('textarea')?.focus()
    }, 0)
  }

  /**
   * Handles selection of an environment variable from the dropdown.
   * @param newValue - The new code value with the selected env var inserted
   */
  const handleEnvVarSelect = (newValue: string) => {
    if (!isPreview && !readOnly) {
      setCode(newValue)
      emitTagSelection(newValue)
    }
    setShowEnvVars(false)

    setTimeout(() => {
      editorRef.current?.querySelector('textarea')?.focus()
    }, 0)
  }

  /**
   * Handles copying the code to the clipboard.
   */
  const handleCopy = () => {
    const textToCopy = code
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Helper Functions
  /**
   * Determines whether a `<...>` segment should be highlighted as a reference.
   * @param part - The code segment to check
   * @returns True if the segment should be highlighted as a reference
   */
  const shouldHighlightReference = (part: string): boolean => {
    if (!part.startsWith('<') || !part.endsWith('>')) {
      return false
    }

    if (!isLikelyReferenceSegment(part)) {
      return false
    }

    const split = splitReferenceSegment(part)
    if (!split) {
      return false
    }

    const reference = split.reference

    if (!accessiblePrefixes) {
      return true
    }

    const inner = reference.slice(1, -1)
    const [prefix] = inner.split('.')
    const normalizedPrefix = normalizeBlockName(prefix)

    if (SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix)) {
      return true
    }

    return accessiblePrefixes.has(normalizedPrefix)
  }

  // Expose wand control handlers to parent via ref
  useImperativeHandle(
    wandControlRef,
    () => ({
      onWandTrigger: (prompt: string) => {
        generateCodeStream({ prompt })
      },
      isWandActive: isPromptVisible,
      isWandStreaming: isAiStreaming,
    }),
    [generateCodeStream, isPromptVisible, isAiStreaming]
  )

  /**
   * Renders the line numbers, aligned with wrapped visual lines and highlighting the active line.
   * @returns Array of React elements representing the line numbers
   */
  const renderLineNumbers = (): ReactElement[] => {
    const numbers: ReactElement[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height) => {
      const isActive = lineNumber === activeLineNumber
      numbers.push(
        <div
          key={`${lineNumber}-0`}
          className={cn('text-right text-xs tabular-nums leading-[21px]')}
          style={{ color: isActive ? '#eeeeee' : '#a8a8a8' }}
        >
          {lineNumber}
        </div>
      )
      for (let i = 1; i < height; i++) {
        numbers.push(
          <div
            key={`${lineNumber}-${i}`}
            className={cn('invisible text-right text-xs tabular-nums leading-[21px]')}
          >
            {lineNumber}
          </div>
        )
      }
      lineNumber++
    })

    if (numbers.length === 0) {
      numbers.push(
        <div
          key={'1-0'}
          className={cn('text-right text-xs tabular-nums leading-[21px]')}
          style={{ color: '#a8a8a8' }}
        >
          1
        </div>
      )
    }

    return numbers
  }

  return (
    <>
      {showCopyButton && code && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={handleCopy}
          disabled={!code}
          className={cn(
            'h-8 w-8 p-0',
            'text-muted-foreground/60 transition-all duration-200',
            'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
            'active:scale-95'
          )}
          aria-label='Copy code'
        >
          {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
        </Button>
      )}
      {!hideInternalWand && (
        <WandPromptBar
          isVisible={isPromptVisible}
          isLoading={isAiLoading}
          isStreaming={isAiStreaming}
          promptValue={promptInputValue}
          onSubmit={(prompt: string) => generateCodeStream({ prompt })}
          onCancel={isAiStreaming ? cancelGeneration : hidePromptInline}
          onChange={updatePromptValue}
          placeholder={dynamicWandConfig?.placeholder || aiPromptPlaceholder}
        />
      )}

      <CodeEditor.Container
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        isStreaming={isAiStreaming}
      >
        <div className='absolute top-2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
          {wandConfig?.enabled &&
            !isAiStreaming &&
            !isPreview &&
            !readOnly &&
            !hideInternalWand && (
              <Button
                variant='ghost'
                size='icon'
                onClick={isPromptVisible ? hidePromptInline : showPromptInline}
                disabled={isAiLoading || isAiStreaming}
                aria-label='Generate code with AI'
                className='h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-foreground hover:shadow'
              >
                <Wand2 className='h-4 w-4' />
              </Button>
            )}
        </div>

        <CodeEditor.Gutter width={gutterWidthPx}>{renderLineNumbers()}</CodeEditor.Gutter>

        <CodeEditor.Content paddingLeft={`${gutterWidthPx}px`} editorRef={editorRef}>
          <CodeEditor.Placeholder gutterWidth={gutterWidthPx} show={code.length === 0}>
            {dynamicPlaceholder}
          </CodeEditor.Placeholder>

          <Editor
            value={code}
            onValueChange={(newCode) => {
              if (!isAiStreaming && !isPreview && !disabled && !readOnly) {
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
              if (isAiStreaming) {
                e.preventDefault()
              }
            }}
            highlight={createHighlightFunction(effectiveLanguage, shouldHighlightReference)}
            {...getCodeEditorProps({ isStreaming: isAiStreaming, isPreview, disabled })}
          />

          {showEnvVars && !isAiStreaming && !readOnly && (
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={handleEnvVarSelect}
              searchTerm={searchTerm}
              inputValue={code}
              cursorPosition={cursorPosition}
              workspaceId={workspaceId}
              onClose={() => {
                setShowEnvVars(false)
                setSearchTerm('')
              }}
              inputRef={{
                current: editorRef.current?.querySelector('textarea') as HTMLTextAreaElement,
              }}
            />
          )}

          {showTags && !isAiStreaming && !readOnly && (
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
              inputRef={{
                current: editorRef.current?.querySelector('textarea') as HTMLTextAreaElement,
              }}
            />
          )}
        </CodeEditor.Content>
      </CodeEditor.Container>
    </>
  )
}
