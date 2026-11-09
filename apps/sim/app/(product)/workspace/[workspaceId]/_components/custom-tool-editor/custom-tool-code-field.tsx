'use client'

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from 'react'
import { StatusTag } from '@sim/emcn/status'
import { CodeField } from '@/app/(product)/workspace/[workspaceId]/_components/code-field/code-field'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-editor.module.css'
import { highlightCustomToolCode } from '@/app/(product)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-highlight'
import { EnvVarDropdown } from '@/app/(product)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import {
  FieldPopover,
  FieldPopoverHeading,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/app/(product)/workspace/[workspaceId]/_components/field-popover/field-popover'
import { checkTagTrigger } from '@/platform/lib/data/workflow-editor'
import {
  CODE_PLACEHOLDER,
  checkEnvVarTrigger,
  type SchemaParameter,
} from '@/platform/lib/data/workflow-editor/tool-input'

/** The identifier under the caret, which both the parameter trigger and its completion act on. */
const SCHEMA_PARAM_WORD = /[a-zA-Z_]\w*$/

function schemaParamTriggered(
  text: string,
  cursorPosition: number,
  parameters: readonly SchemaParameter[]
): boolean {
  if (parameters.length === 0) return false
  const currentWord = text.slice(0, cursorPosition).match(SCHEMA_PARAM_WORD)?.[0] ?? ''
  if (!currentWord) return false
  const lower = currentWord.toLowerCase()
  return parameters.some((param) => param.name.toLowerCase().startsWith(lower))
}

/** What the `<` reference picker hangs from the code field's caret. */
interface ReferencePickerProps {
  visible: boolean
  inputValue: string
  cursorPosition: number
  onSelect: (newValue: string, newCursorPosition: number) => void
  onClose: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}

interface CustomToolCodeFieldProps {
  value: string
  onChange: (value: string) => void
  isLoading: boolean
  isStreaming: boolean
  schemaParameters: readonly SchemaParameter[]
  workspaceId: string
  /** Shows the code without accepting edits, for a viewer who may not change the tool. */
  disabled?: boolean
  /** A tool inside a block: the picker for its upstream outputs, opened by typing `<`. */
  renderReferencePicker?: (picker: ReferencePickerProps) => ReactNode
}

/**
 * The code half of the custom tool editor: the schema's parameters, the JavaScript body, and its
 * caret pickers for secrets, schema parameters and, inside a block, upstream block outputs.
 */
export function CustomToolCodeField({
  value,
  onChange,
  isLoading,
  isStreaming,
  schemaParameters,
  workspaceId,
  disabled = false,
  renderReferencePicker,
}: CustomToolCodeFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [showSchemaParams, setShowSchemaParams] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [schemaParamIndex, setSchemaParamIndex] = useState(0)
  const busy = disabled || isLoading || isStreaming

  const [wasBusy, setWasBusy] = useState(busy)
  if (wasBusy !== busy) {
    setWasBusy(busy)
    if (busy) {
      setShowEnvVars(false)
      setShowTags(false)
      setShowSchemaParams(false)
    }
  }

  useActiveRowIntoView(showSchemaParams, schemaParamIndex)

  const placeCaret = (caret: number) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  const handleChange = (next: string) => {
    onChange(next)
    if (busy) return
    const textarea = textareaRef.current
    if (!textarea) return

    const position = textarea.selectionStart
    setCursorPosition(position)

    const envVarTrigger = checkEnvVarTrigger(next, position)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

    if (renderReferencePicker) setShowTags(checkTagTrigger(next, position).show)

    if (schemaParameters.length > 0) {
      const triggered = schemaParamTriggered(next, position, schemaParameters)
      if (triggered && !showSchemaParams) {
        setShowSchemaParams(true)
        setSchemaParamIndex(0)
      } else if (!triggered && showSchemaParams) {
        setShowSchemaParams(false)
      }
    }
  }

  const selectSchemaParam = (paramName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const position = textarea.selectionStart
    const beforeCursor = value.slice(0, position)
    const currentWord = beforeCursor.match(SCHEMA_PARAM_WORD)?.[0] ?? ''
    const wordStart = position - currentWord.length
    onChange(beforeCursor.slice(0, wordStart) + paramName + value.slice(position))
    setShowSchemaParams(false)
    placeCaret(wordStart + paramName.length)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && (showEnvVars || showTags || showSchemaParams)) {
      event.preventDefault()
      event.stopPropagation()
      setShowEnvVars(false)
      setShowTags(false)
      setShowSchemaParams(false)
      return
    }

    if (isStreaming) {
      event.preventDefault()
      return
    }

    if (showSchemaParams && schemaParameters.length > 0) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          setSchemaParamIndex((index) => Math.min(index + 1, schemaParameters.length - 1))
          return
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          setSchemaParamIndex((index) => Math.max(index - 1, 0))
          return
        case 'Enter': {
          event.preventDefault()
          event.stopPropagation()
          const selected = schemaParameters[schemaParamIndex]
          if (selected) selectSchemaParam(selected.name)
          return
        }
        case ' ':
        case 'Tab':
          setShowSchemaParams(false)
          return
      }
    }

    if ((showEnvVars || showTags) && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const focusEditor = (event: MouseEvent<HTMLDivElement>) => {
    const textarea = textareaRef.current
    if (!textarea || busy || event.target === textarea) return
    if (event.target instanceof Element && event.target.closest('button, [role="listbox"]')) return
    event.preventDefault()
    textarea.focus()
  }

  return (
    <div className={styles.panel}>
      {schemaParameters.length > 0 && (
        <div className={styles.parameters} data-type='T052'>
          <span>Available parameters:</span>
          {schemaParameters.map((param) => (
            <StatusTag key={param.name} label={param.name} />
          ))}
          <span>Start typing a parameter name for autocomplete.</span>
        </div>
      )}
      <div
        role='presentation'
        className={styles.editor}
        data-with-parameters={schemaParameters.length > 0 || undefined}
        onMouseDown={focusEditor}
      >
        <CodeField
          value={value}
          onValueChange={handleChange}
          highlight={(code) => highlightCustomToolCode(code, schemaParameters)}
          label='Tool code'
          placeholder={CODE_PLACEHOLDER}
          disabled={busy}
          streaming={isStreaming}
          textareaRef={textareaRef}
          onKeyDown={handleKeyDown}
        >
          <EnvVarDropdown
            visible={showEnvVars}
            onSelect={(next, caret) => {
              onChange(next)
              setShowEnvVars(false)
              placeCaret(caret)
            }}
            searchTerm={searchTerm}
            inputValue={value}
            cursorPosition={cursorPosition}
            workspaceId={workspaceId}
            onClose={() => {
              setShowEnvVars(false)
              setSearchTerm('')
            }}
            inputRef={textareaRef}
          />
          {renderReferencePicker?.({
            visible: showTags,
            inputValue: value,
            cursorPosition,
            onSelect: (next, caret) => {
              onChange(next)
              setShowTags(false)
              placeCaret(caret)
            },
            onClose: () => setShowTags(false),
            inputRef: textareaRef,
          })}
          <FieldPopover
            label='Available parameters'
            open={showSchemaParams && schemaParameters.length > 0}
            anchor={textareaRef}
            caretIndex={cursorPosition}
            onDismiss={() => setShowSchemaParams(false)}
          >
            <FieldPopoverHeading>Available Parameters</FieldPopoverHeading>
            {schemaParameters.map((param, index) => (
              <FieldPopoverRow
                key={param.name}
                index={index}
                active={index === schemaParamIndex}
                trailing={
                  param.type && param.type !== 'any' ? (
                    <span className={styles.paramType} data-type='T052'>
                      {param.type}
                    </span>
                  ) : undefined
                }
                onHover={() => setSchemaParamIndex(index)}
                onSelect={() => selectSchemaParam(param.name)}
              >
                {param.name}
              </FieldPopoverRow>
            ))}
          </FieldPopover>
        </CodeField>
      </div>
    </div>
  )
}
