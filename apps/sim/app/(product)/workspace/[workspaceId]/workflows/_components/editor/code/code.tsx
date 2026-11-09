'use client'

import {
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { EnvVarDropdown } from '@/app/(product)/_components/env-var-dropdown/env-var-dropdown'
import { CodeField } from '@/app/(product)/workspace/[workspaceId]/_components/code-field/code-field'
import type { CodeFieldLanguage } from '@/app/(product)/workspace/[workspaceId]/_components/code-field/highlight'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/code/code.module.css'
import {
  PYTHON_AI_PROMPT,
  SHELL_AI_PROMPT,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/code/wand-prompts'
import {
  highlightCode,
  highlightMaskedCode,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/code-highlight'
import { shouldMaskSecretValue } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/password-mask'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import type { WandControlHandlers } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/wand-control'
import { TagDropdown } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import {
  WandButton,
  WandPromptBar,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/wand-prompt-bar/wand-prompt-bar'
import {
  CodeLanguage,
  checkTagTrigger,
  createShouldHighlightEnvVar,
  type GenerationType,
  getBlock,
  isAccessibleCodeReference,
  useAccessibleReferencePrefixes,
  useAvailableEnvVarKeys,
  useCodeUndoRedo,
  useSubBlockValue,
  useTagSelection,
  useWand,
  useWorkflowScope,
  useWorkflowStore,
} from '@/platform/lib/data/workflow-editor'
import { checkEnvVarTrigger, readConnectionDrop } from '@/platform/lib/data/workflow-editor/code'

/** How long JSON must stay invalid before the label row marks it, so typing never flickers it. */
const INVALID_JSON_SETTLE_MS = 150

const CODE_LANGUAGES: readonly CodeFieldLanguage[] = ['javascript', 'json', 'python', 'shell']

function isCodeLanguage(value: unknown): value is CodeFieldLanguage {
  return typeof value === 'string' && (CODE_LANGUAGES as readonly string[]).includes(value)
}

/** The value's text, as the editor shows any stored value. */
function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/** A read-only field's default: text as written, anything structured as indented JSON. */
function defaultText(defaultValue: unknown): string {
  if (defaultValue === undefined || defaultValue === null) return ''
  if (typeof defaultValue === 'string') return defaultValue
  return JSON.stringify(defaultValue, null, 2)
}

/** Puts the caret back after React commits a picker's insertion, so it lands after the text. */
function placeCaret(textarea: HTMLTextAreaElement | null, position: number) {
  setTimeout(() => {
    if (!textarea) return
    textarea.focus()
    textarea.selectionStart = position
    textarea.selectionEnd = position
  })
}

function promptPlaceholderFor(generationType: GenerationType): string {
  switch (generationType) {
    case 'json-schema':
      return 'Describe the JSON schema to generate...'
    case 'json-object':
    case 'table-schema':
      return 'Describe the JSON object to generate...'
    default:
      return 'Describe the JavaScript code to generate...'
  }
}

/** The AI prompt a code field runs: its own, or the Function block's for Python and Shell. */
interface CodeWandConfig {
  enabled: boolean
  prompt: string
  generationType?: GenerationType
  placeholder?: string
  maintainHistory?: boolean
}

interface CodeProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  /** Conceal the value except while the editor is focused. */
  password?: boolean
  language?: CodeFieldLanguage
  /** Picks the AI prompt's placeholder. */
  generationType?: GenerationType
  /** A value the block computes from its other fields; the field shows it instead of its own. */
  value?: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  readOnly?: boolean
  /** Accepted for the block config's sake; the field does not collapse. */
  collapsible?: boolean
  /** Accepted for the block config's sake; the field does not collapse. */
  defaultCollapsed?: boolean
  /** What a read-only field shows; structured values show as indented JSON. */
  defaultValue?: unknown
  showCopyButton?: boolean
  /** Reports whether a JSON field parses, for the label row's validity mark. */
  onValidationChange?: (isValid: boolean) => void
  wandConfig: CodeWandConfig
  wandControlRef?: MutableRefObject<WandControlHandlers | null>
  /** The sub-block's label row owns the AI prompt, so the field shows none of its own. */
  hideInternalWand?: boolean
}

/**
 * A code sub-block: Prism highlighting in the block's language (a Function block's `language`
 * field wins over the config), `<block.output>` references and `{{SECRET}}` names in the reference
 * color, line numbers that follow wrapping, JSON validity, the `<` and `{{` pickers at the caret,
 * dropped connections, password masking, copy, AI generation that streams into the field, and the
 * Function block's own undo history.
 */
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
  const { workspaceId } = useWorkflowScope()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const persistGeneratedRef = useRef<(content: string) => void>(() => {})

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const [languageValue] = useSubBlockValue<unknown>(blockId, 'language')
  const [tableIdValue] = useSubBlockValue<unknown>(blockId, 'tableId')
  const [sandboxIdValue] = useSubBlockValue<unknown>(blockId, 'sandboxId')
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const blockType = useWorkflowStore(
    useCallback((state) => state.blocks?.[blockId]?.type, [blockId])
  )

  const [showTags, setShowTags] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const effectiveLanguage = isCodeLanguage(languageValue) ? languageValue : language
  const isFunctionCode = blockType === 'function' && subBlockId === 'code'

  const dynamicWandConfig = useMemo<CodeWandConfig>(() => {
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

  const [code, setCode] = useState('')
  const codeRef = useRef(code)
  codeRef.current = code

  const wand = useWand({
    workspaceId,
    wandConfig: dynamicWandConfig,
    currentValue: code,
    contextParams: {
      tableId: typeof tableIdValue === 'string' ? tableIdValue : null,
      sandboxId: typeof sandboxIdValue === 'string' ? sandboxIdValue : null,
    },
    // Keyed off the value that swaps the prompt, so history from the previous language cannot
    // steer the next generation back to it.
    historyResetKey: typeof languageValue === 'string' ? languageValue : undefined,
    onStreamStart: () => setCode(''),
    onStreamChunk: (chunk) => setCode((current) => current + chunk),
    onGeneratedContent: (content) => persistGeneratedRef.current(content),
  })
  const isStreaming = wand.isStreaming

  const { recordChange, recordReplace, flushPending, startSession, undo, redo } = useCodeUndoRedo({
    blockId,
    subBlockId,
    value: code,
    enabled: isFunctionCode,
    isReadOnly: readOnly || disabled || isPreview,
    isStreaming,
  })

  const [storeValue, setStoreValue] = useSubBlockValue<unknown>(blockId, subBlockId, false, {
    isStreaming,
  })

  persistGeneratedRef.current = (content: string) => {
    setCode(content)
    if (!isPreview && !disabled) {
      setStoreValue(content)
      recordReplace(content)
    }
  }

  const value = isPreview
    ? previewValue
    : propValue !== undefined
      ? propValue
      : readOnly && defaultValue !== undefined
        ? defaultText(defaultValue)
        : storeValue
  const valueText = textOf(value)

  // Before paint, so the stored code never flashes the placeholder on mount.
  useLayoutEffect(() => {
    if (isStreaming) return
    if (valueText !== code) setCode(valueText)
  }, [valueText, code, isStreaming])

  const trimmedCode = code.trim()
  const containsReferencePlaceholders =
    trimmedCode.includes('{{') ||
    trimmedCode.includes('}}') ||
    trimmedCode.includes('<') ||
    trimmedCode.includes('>')
  const shouldValidateJson = effectiveLanguage === 'json' && !containsReferencePlaceholders
  const isValidJson = useMemo(() => {
    if (!shouldValidateJson || !trimmedCode) return true
    try {
      JSON.parse(trimmedCode)
      return true
    } catch {
      return false
    }
  }, [shouldValidateJson, trimmedCode])

  useEffect(() => {
    if (!onValidationChange) return
    if (!shouldValidateJson || isValidJson) {
      onValidationChange(true)
      return
    }
    const timer = setTimeout(() => onValidationChange(false), INVALID_JSON_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [isValidJson, onValidationChange, shouldValidateJson])

  useImperativeHandle(
    wandControlRef,
    () => ({
      onWandTrigger: (prompt: string) => {
        wand.generateStream({ prompt })
      },
      isWandActive: wand.isPromptVisible,
      isWandStreaming: wand.isStreaming,
    }),
    [wand.generateStream, wand.isPromptVisible, wand.isStreaming]
  )

  const handleValueChange = (newCode: string) => {
    if (isStreaming || isPreview || disabled || readOnly) return
    setCode(newCode)
    setStoreValue(newCode)
    recordChange(newCode)
    const textarea = textareaRef.current
    if (!textarea) return
    const position = textarea.selectionStart
    setCursorPosition(position)
    const tagTrigger = checkTagTrigger(newCode, position)
    setShowTags(tagTrigger.show)
    if (!tagTrigger.show) setActiveSourceBlockId(null)
    const envVarTrigger = checkEnvVarTrigger(newCode, position)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      setShowTags(false)
      setShowEnvVars(false)
    }
    if (isStreaming) {
      event.preventDefault()
      return
    }
    if (!isFunctionCode) return
    const modifier = event.metaKey || event.ctrlKey
    const isZ = event.key === 'z' || event.key === 'Z'
    const isUndo = isZ && modifier && !event.shiftKey
    const isRedo = (isZ && modifier && event.shiftKey) || (event.key === 'y' && modifier)
    if (isUndo) {
      event.preventDefault()
      event.stopPropagation()
      undo()
      return
    }
    if (isRedo) {
      event.preventDefault()
      event.stopPropagation()
      redo()
    }
  }

  const handleFocus = () => {
    setIsFocused(true)
    startSession(codeRef.current)
    if (!isPreview && !disabled && !readOnly && codeRef.current.trim() === '') {
      setShowTags(true)
      setCursorPosition(0)
    }
  }

  const handleBlur = () => {
    setIsFocused(false)
    flushPending()
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const drop = readConnectionDrop(event.dataTransfer)
    if (!drop) return
    const textarea = textareaRef.current
    const dropPosition = textarea?.selectionStart ?? code.length
    const newValue = `${code.slice(0, dropPosition)}<${code.slice(dropPosition)}`
    setCode(newValue)
    setStoreValue(newValue)
    recordChange(newValue)
    const caret = dropPosition + 1
    setCursorPosition(caret)
    setTimeout(() => {
      if (!textarea) return
      textarea.focus()
      textarea.selectionStart = caret
      textarea.selectionEnd = caret
      setShowTags(true)
      if (drop.sourceBlockId) setActiveSourceBlockId(drop.sourceBlockId)
    })
  }

  const handleTagSelect = (newValue: string, newCursorPosition: number) => {
    const textarea = textareaRef.current
    if (!isPreview && !readOnly) {
      setCode(newValue)
      emitTagSelection(newValue)
      recordChange(newValue)
      placeCaret(textarea, newCursorPosition)
    } else {
      setTimeout(() => textarea?.focus())
    }
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  const handleEnvVarSelect = (newValue: string, newCursorPosition: number) => {
    const textarea = textareaRef.current
    if (!isPreview && !readOnly) {
      setCode(newValue)
      emitTagSelection(newValue)
      recordChange(newValue)
      placeCaret(textarea, newCursorPosition)
    } else {
      setTimeout(() => textarea?.focus())
    }
    setShowEnvVars(false)
  }

  const isEnvVar = useMemo(() => createShouldHighlightEnvVar(availableEnvVars), [availableEnvVars])
  const search = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: [],
  })
  const shouldMask = shouldMaskSecretValue({ password, isFocused })
  const highlight = shouldMask
    ? highlightMaskedCode
    : (source: string) =>
        highlightCode(source, effectiveLanguage, {
          isReference: (part) => isAccessibleCodeReference(part, accessiblePrefixes),
          isEnvVar,
          search,
        })

  const fieldPlaceholder =
    languageValue === CodeLanguage.Python
      ? 'Write Python...'
      : languageValue === CodeLanguage.Shell
        ? 'Write shell commands...'
        : placeholder
  const label =
    (blockType && getBlock(blockType)?.subBlocks.find((sub) => sub.id === subBlockId)?.title) ||
    'Code'
  const showWandButton =
    wandConfig.enabled && !isStreaming && !isPreview && !readOnly && !hideInternalWand
  const pickersAllowed = !isStreaming && !readOnly
  const acceptsDrop = !isPreview && !readOnly && !disabled

  return (
    <div className={styles.code}>
      {!hideInternalWand && (
        <WandPromptBar
          isVisible={wand.isPromptVisible}
          isLoading={wand.isLoading}
          isStreaming={isStreaming}
          promptValue={wand.promptInputValue}
          onSubmit={(prompt) => wand.generateStream({ prompt })}
          onCancel={isStreaming ? wand.cancelGeneration : wand.hidePromptInline}
          onChange={wand.updatePromptValue}
          placeholder={dynamicWandConfig.placeholder || promptPlaceholderFor(generationType)}
        />
      )}
      <CodeField
        value={code}
        onValueChange={handleValueChange}
        highlight={highlight}
        label={label}
        placeholder={fieldPlaceholder}
        disabled={isPreview || disabled}
        readOnly={readOnly}
        streaming={isStreaming}
        textareaRef={textareaRef}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onDrop={acceptsDrop ? handleDrop : undefined}
        actions={
          (showCopyButton && code) || showWandButton ? (
            <>
              {showCopyButton && code && (
                <CopyButton label='Copy code' text={code} size='compact' />
              )}
              {showWandButton && (
                <WandButton
                  onClick={wand.isPromptVisible ? wand.hidePromptInline : wand.showPromptInline}
                  disabled={wand.isLoading || isStreaming}
                />
              )}
            </>
          ) : undefined
        }
      >
        {showEnvVars && pickersAllowed && (
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
            inputRef={textareaRef}
          />
        )}
        {showTags && pickersAllowed && (
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
            inputRef={textareaRef}
          />
        )}
      </CodeField>
    </div>
  )
})
