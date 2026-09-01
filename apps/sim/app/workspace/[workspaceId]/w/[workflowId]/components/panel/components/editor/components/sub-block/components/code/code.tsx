import type { ReactElement } from 'react'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  CODE_LINE_HEIGHT_PX,
  Code as CodeEditor,
  calculateGutterWidth,
  cn,
  Duplicate,
  getCodeEditorProps,
  highlight,
  languages,
} from '@sim/emcn'
import { Check, Wand } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import Editor from 'react-simple-code-editor'
import { Button } from '@/components/ui/button'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/sanitization/references'
import { WORKFLOW_SEARCH_HIGHLIGHT_CLASS } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/constants'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import {
  getValidWorkflowSearchRange,
  type WorkflowSearchTextHighlight,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  maskSecretText,
  shouldMaskSecretValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { restoreCursorAfterInsertion } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/utils'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { GenerationType } from '@/blocks/types'
import { normalizeName } from '@/executor/constants'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'
import { createShouldHighlightEnvVar, useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
import { useCodeUndoRedo } from '@/hooks/use-code-undo-redo'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Code')

/**
 * Default AI prompt for Python code generation.
 */
const PYTHON_AI_PROMPT = `You are an expert Python programmer.
Generate ONLY raw Python source based on the user's request.
The source runs as a module with __name__ set to '__main__'.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use os.environ or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. When the placeholder is the complete expression, prefer the unquoted form (for example, 'api_key = {{API_KEY}}'). Quoted and embedded string forms are also supported. Sim binds the resolved value separately from the source at execution time, preserving its exact string contents.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes.
3. Module Source: You may define functions and classes and use an if __name__ == '__main__' guard. Assign the final structured value to __sim_result__. A top-level return is supported only for backward-compatible legacy snippets.
4. Imports: The Python standard library is always available. Third-party packages are available ONLY when the block has a sandbox selected — the sandbox's package list is appended below when one is. Never import a package that is not on that list.
5. No Markdown: Do NOT include backticks, code fences, or any markdown.
6. Clarity: Write clean, readable Python code.
7. No Explanations: Output the raw Python code only — no prose before or after it.

Example Scenario:
User Prompt: "Fetch user data from an API. Use the User ID passed in as 'userId' and an API Key stored as the 'SERVICE_API_KEY' environment variable."

Generated Code:
import json
import urllib.error
import urllib.request

user_id = <userId>  # Correct: accessing an input parameter without quotes
api_key = {{SERVICE_API_KEY}}  # Correct: accessing an environment variable without quotes
url = f"https://api.example.com/users/{user_id}"

request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})

try:
    with urllib.request.urlopen(request) as response:
        # Assign the fetched data, which becomes the block's output
        __sim_result__ = json.loads(response.read().decode())
except urllib.error.HTTPError as error:
    # Raising marks the block execution as failed
    raise Exception(f"API request failed with status {error.code}: {error.read().decode()}")`

const SHELL_AI_PROMPT = `You are an expert Bash programmer.
Generate ONLY the raw Bash script based on the user's request.
- Input parameters and workflow values use angle-bracket references such as <paramName>.
- Environment variables use double curly braces such as {{ENV_VAR_NAME}}.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference environment variables with the exact {{VARIABLE_NAME}} syntax. For a complete argument, prefer the unquoted placeholder; quoted and embedded forms are also supported. Sim supplies the exact value through a runtime environment binding instead of inserting it into the script source.
2. Reference input parameters and workflow variables with the exact <variable_name> syntax.
3. Return only executable shell commands. Do not include markdown or code fences.
4. Use set -euo pipefail when it is safe for the requested script.
5. Only use commands available in the default image or the selected sandbox's CLI tools.
6. To return a typed result, print exactly one line prefixed with __SIM_RESULT__= followed by JSON. Keep ordinary command output in stdout.
7. A placeholder inside a quoted heredoc such as <<'EOF' is supported without enabling unrelated $VAR, backtick, or command substitutions in that heredoc.
8. Write clean, readable Bash.`

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

const WORKFLOW_SEARCH_MATCH_PLACEHOLDER = '__WORKFLOW_SEARCH_MATCH__'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * Highlighter that conceals the editor's contents.
 *
 * @remarks
 * `react-simple-code-editor` paints its textarea with a transparent text fill
 * and shows the markup returned by its `highlight` prop instead, so swapping the
 * highlighter is what actually hides a secret — the textarea's own value is
 * never visible.
 *
 * @param codeToHighlight - The plaintext editor contents
 * @returns Escaped markup with every character replaced by a mask glyph
 */
export const highlightMaskedCode = (codeToHighlight: string): string =>
  escapeHtml(maskSecretText(codeToHighlight))

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
 * @param shouldHighlightReference - Function to determine if a block reference should be highlighted
 * @param shouldHighlightEnvVar - Function to determine if an env var should be highlighted
 * @returns A function that highlights code with syntax and custom highlights
 */
const createHighlightFunction = (
  effectiveLanguage: 'javascript' | 'python' | 'json' | 'shell',
  shouldHighlightReference: (part: string) => boolean,
  shouldHighlightEnvVar: (varName: string) => boolean,
  workflowSearchHighlight?: WorkflowSearchTextHighlight | null
) => {
  return (codeToHighlight: string): string => {
    const placeholders: CodePlaceholder[] = []
    let processedCode = codeToHighlight
    const workflowSearchRange = getValidWorkflowSearchRange(
      codeToHighlight,
      workflowSearchHighlight
    )

    if (workflowSearchRange) {
      processedCode = `${codeToHighlight.slice(0, workflowSearchRange.start)}${WORKFLOW_SEARCH_MATCH_PLACEHOLDER}${codeToHighlight.slice(workflowSearchRange.end)}`
    }

    processedCode = processedCode.replace(createEnvVarPattern(), (match) => {
      const varName = match.slice(2, -2).trim()
      if (shouldHighlightEnvVar(varName)) {
        const placeholder = `__ENV_VAR_${placeholders.length}__`
        placeholders.push({ placeholder, original: match, type: 'env' })
        return placeholder
      }
      return match
    })

    processedCode = processedCode.replace(createReferencePattern(), (match) => {
      if (shouldHighlightReference(match)) {
        const placeholder = `__VAR_REF_${placeholders.length}__`
        placeholders.push({ placeholder, original: match, type: 'var' })
        return placeholder
      }
      return match
    })

    const lang =
      effectiveLanguage === 'python'
        ? 'python'
        : effectiveLanguage === 'shell'
          ? 'bash'
          : 'javascript'
    let highlightedCode = highlight(processedCode, languages[lang], lang)

    highlightedCode = applyDarkModeTokenStyling(highlightedCode)

    placeholders.forEach(({ placeholder, original, type }) => {
      if (type === 'env') {
        highlightedCode = highlightedCode.replace(
          placeholder,
          `<span style="color: var(--brand-secondary);">${original}</span>`
        )
      } else if (type === 'var') {
        const escaped = original.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        highlightedCode = highlightedCode.replace(
          placeholder,
          `<span style="color: var(--brand-secondary);">${escaped}</span>`
        )
      }
    })

    if (workflowSearchRange) {
      const matchText = codeToHighlight.slice(workflowSearchRange.start, workflowSearchRange.end)
      highlightedCode = highlightedCode.replace(
        WORKFLOW_SEARCH_MATCH_PLACEHOLDER,
        `<mark class="${WORKFLOW_SEARCH_HIGHLIGHT_CLASS}">${escapeHtml(matchText)}</mark>`
      )
    }

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
  /** Whether to conceal the value except while the editor is focused */
  password?: boolean
  language?: 'javascript' | 'json' | 'python' | 'shell'
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

export const Code = memo(function Code({
  blockId,
  subBlockId,
  placeholder = 'Write JavaScript...',
  password = false,
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
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [code, setCode] = useState<string>('')
  const [showTags, setShowTags] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [visualLineHeights, setVisualLineHeights] = useState<number[]>([])
  const [activeLineNumber, setActiveLineNumber] = useState(1)
  const [copied, setCopied] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const handleStreamStartRef = useRef<() => void>(() => {})
  const handleGeneratedContentRef = useRef<(generatedCode: string) => void>(() => {})
  const handleStreamChunkRef = useRef<(chunk: string) => void>(() => {})
  const codeRef = useRef(code)
  codeRef.current = code

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const [languageValue] = useSubBlockValue<string>(blockId, 'language')
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const blockType = useWorkflowStore(
    useCallback((state) => state.blocks?.[blockId]?.type, [blockId])
  )

  const effectiveLanguage =
    (languageValue as 'javascript' | 'python' | 'json' | 'shell') || language
  const isFunctionCode = blockType === 'function' && subBlockId === 'code'

  const trimmedCode = code.trim()
  const containsReferencePlaceholders =
    trimmedCode.includes('{{') ||
    trimmedCode.includes('}}') ||
    trimmedCode.includes('<') ||
    trimmedCode.includes('>')

  const shouldValidateJson = effectiveLanguage === 'json' && !containsReferencePlaceholders

  const isValidJson = useMemo(() => {
    if (!shouldValidateJson || !trimmedCode) {
      return true
    }
    try {
      JSON.parse(trimmedCode)
      return true
    } catch {
      return false
    }
  }, [shouldValidateJson, trimmedCode])

  const gutterWidthPx = useMemo(() => {
    const lineCount = code.split('\n').length
    return calculateGutterWidth(lineCount)
  }, [code])

  const aiPromptPlaceholder = useMemo(() => {
    switch (generationType) {
      case 'json-schema':
        return 'Describe the JSON schema to generate...'
      case 'json-object':
      case 'table-schema':
        return 'Describe the JSON object to generate...'
      default:
        return 'Describe the JavaScript code to generate...'
    }
  }, [generationType])

  const dynamicPlaceholder = useMemo(() => {
    if (languageValue === CodeLanguage.Python) {
      return 'Write Python...'
    }
    if (languageValue === CodeLanguage.Shell) {
      return 'Write shell commands...'
    }
    return placeholder
  }, [languageValue, placeholder])

  const dynamicWandConfig = useMemo(() => {
    if (languageValue === CodeLanguage.Python) {
      return {
        ...wandConfig,
        prompt: PYTHON_AI_PROMPT,
        placeholder: 'Describe the Python script you want to create...',
      }
    }
    if (languageValue === CodeLanguage.Shell) {
      return {
        ...wandConfig,
        prompt: SHELL_AI_PROMPT,
        placeholder: 'Describe the shell commands you want to run...',
      }
    }
    return wandConfig
  }, [wandConfig, languageValue])

  const [tableIdValue] = useSubBlockValue<string>(blockId, 'tableId')
  const [sandboxIdValue] = useSubBlockValue<string>(blockId, 'sandboxId')

  const wandHook = useWand({
    wandConfig: dynamicWandConfig || { enabled: false, prompt: '' },
    currentValue: code,
    contextParams: {
      tableId: typeof tableIdValue === 'string' ? tableIdValue : null,
      sandboxId: typeof sandboxIdValue === 'string' ? sandboxIdValue : null,
    },
    // Keyed off the same value that swaps the prompt below, so history from the
    // previous language cannot steer the next generation back to it.
    historyResetKey: typeof languageValue === 'string' ? languageValue : undefined,
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

  const { recordChange, recordReplace, flushPending, startSession, undo, redo } = useCodeUndoRedo({
    blockId,
    subBlockId,
    value: code,
    enabled: isFunctionCode,
    isReadOnly: readOnly || disabled || isPreview,
    isStreaming: isAiStreaming,
  })

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

  useEffect(() => {
    if (!onValidationChange) return

    const isValid = !shouldValidateJson || isValidJson

    if (isValid) {
      onValidationChange(true)
      return
    }

    const timeoutId = setTimeout(() => {
      onValidationChange(false)
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [isValidJson, onValidationChange, shouldValidateJson])

  useEffect(() => {
    handleStreamStartRef.current = () => {
      setCode('')
    }

    handleStreamChunkRef.current = (chunk: string) => {
      setCode((prev: string) => prev + chunk)
    }

    handleGeneratedContentRef.current = (generatedCode: string) => {
      setCode(generatedCode)
      if (!isPreview && !disabled) {
        setStoreValue(generatedCode)
        recordReplace(generatedCode)
      }
    }
  }, [disabled, isPreview, recordReplace, setStoreValue])

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

  useEffect(() => {
    if (isAiStreaming) return
    const valueString = value?.toString() ?? ''
    if (valueString !== code) {
      setCode(valueString)
    }
  }, [value, code, isAiStreaming])

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

      lines.forEach((line: string) => {
        const lineDiv = document.createElement('div')

        if (line.includes('<') && line.includes('>')) {
          const parts = line.split(/(<[^>]+>)/g)
          parts.forEach((part: string) => {
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
      recordChange(newValue)
      const newCursorPosition = dropPosition + 1
      setCursorPosition(newCursorPosition)

      setTimeout(() => {
        if (textarea) {
          textarea.focus()
          textarea.selectionStart = newCursorPosition
          textarea.selectionEnd = newCursorPosition

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
   * @param newCursorPosition - The cursor position after the inserted tag
   */
  const handleTagSelect = (newValue: string, newCursorPosition: number) => {
    const textarea = editorRef.current?.querySelector('textarea') as HTMLTextAreaElement | null

    if (!isPreview && !readOnly) {
      setCode(newValue)
      emitTagSelection(newValue)
      recordChange(newValue)
      restoreCursorAfterInsertion(textarea, newCursorPosition)
    } else {
      setTimeout(() => textarea?.focus(), 0)
    }
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  /**
   * Handles selection of an environment variable from the dropdown.
   * @param newValue - The new code value with the selected env var inserted
   * @param newCursorPosition - The cursor position after the inserted env var
   */
  const handleEnvVarSelect = (newValue: string, newCursorPosition: number) => {
    const textarea = editorRef.current?.querySelector('textarea') as HTMLTextAreaElement | null

    if (!isPreview && !readOnly) {
      setCode(newValue)
      emitTagSelection(newValue)
      recordChange(newValue)
      restoreCursorAfterInsertion(textarea, newCursorPosition)
    } else {
      setTimeout(() => textarea?.focus(), 0)
    }
    setShowEnvVars(false)
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

  /**
   * Determines whether a `<...>` segment should be highlighted as a reference.
   * @param part - The code segment to check
   * @returns True if the segment should be highlighted as a reference
   */
  const shouldHighlightReference = useCallback(
    (part: string): boolean => {
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
      const normalizedPrefix = normalizeName(prefix)

      if (SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix)) {
        return true
      }

      return accessiblePrefixes.has(normalizedPrefix)
    },
    [accessiblePrefixes]
  )

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

  const shouldHighlightEnvVar = useMemo(
    () => createShouldHighlightEnvVar(availableEnvVars),
    [availableEnvVars]
  )
  const workflowSearchHighlight = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    subBlockId,
    valuePath: [],
  })

  const shouldMask = shouldMaskSecretValue({ password, isFocused })

  const highlightCode = useMemo(
    () =>
      createHighlightFunction(
        effectiveLanguage,
        shouldHighlightReference,
        shouldHighlightEnvVar,
        workflowSearchHighlight
      ),
    [effectiveLanguage, shouldHighlightReference, shouldHighlightEnvVar, workflowSearchHighlight]
  )

  const handleValueChange = useCallback(
    (newCode: string) => {
      if (!isAiStreaming && !isPreview && !disabled && !readOnly) {
        setCode(newCode)
        setStoreValue(newCode)
        recordChange(newCode)

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
    },
    [isAiStreaming, isPreview, disabled, readOnly, recordChange, setStoreValue]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setShowTags(false)
        setShowEnvVars(false)
      }
      if (isAiStreaming) {
        e.preventDefault()
        return
      }
      if (!isFunctionCode) return
      const isUndo = (e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && !e.shiftKey
      const isRedo =
        ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
        (e.key === 'y' && (e.metaKey || e.ctrlKey))
      if (isUndo) {
        e.preventDefault()
        e.stopPropagation()
        undo()
        return
      }
      if (isRedo) {
        e.preventDefault()
        e.stopPropagation()
        redo()
      }
    },
    [isAiStreaming, isFunctionCode, redo, undo]
  )

  const handleEditorFocus = useCallback(() => {
    setIsFocused(true)
    startSession(codeRef.current)
    if (!isPreview && !disabled && !readOnly && codeRef.current.trim() === '') {
      setShowTags(true)
      setCursorPosition(0)
    }
  }, [disabled, isPreview, readOnly, startSession])

  const handleEditorBlur = useCallback(() => {
    setIsFocused(false)
    flushPending()
  }, [flushPending])

  /**
   * Renders the line numbers, aligned with wrapped visual lines and highlighting the active line.
   * @returns Array of React elements representing the line numbers
   */
  const renderLineNumbers = (): ReactElement[] => {
    const numbers: ReactElement[] = []
    let lineNumber = 1

    visualLineHeights.forEach((height: number) => {
      const isActive = lineNumber === activeLineNumber
      numbers.push(
        <div
          key={`${lineNumber}-0`}
          className={cn(
            'text-right text-xs tabular-nums leading-[21px]',
            isActive
              ? 'text-[var(--text-primary)] dark:text-[var(--code-foreground)]'
              : 'text-[var(--text-muted)] dark:text-[var(--code-line-number)]'
          )}
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
          className={cn(
            'text-right text-xs tabular-nums leading-[21px]',
            'text-[var(--text-muted)] dark:text-[var(--code-line-number)]'
          )}
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
            'size-8 p-0',
            'text-muted-foreground/60 transition-all duration-200',
            'hover-hover:scale-105 hover-hover:bg-muted/50 hover-hover:text-foreground',
            'active:scale-95'
          )}
          aria-label='Copy code'
        >
          {copied ? <Check className='h-3.5 w-3.5' /> : <Duplicate className='h-3.5 w-3.5' />}
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

      <CodeEditor.Container onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
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
                className='size-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover-hover:border-primary/20 hover-hover:bg-muted hover-hover:text-foreground hover-hover:shadow'
              >
                <Wand className='size-4' />
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
            onValueChange={handleValueChange}
            onKeyDown={handleKeyDown}
            onFocus={handleEditorFocus}
            onBlur={handleEditorBlur}
            highlight={shouldMask ? highlightMaskedCode : highlightCode}
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
})
