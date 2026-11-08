'use client'

import { type KeyboardEvent, type MouseEvent, useRef, useState } from 'react'
import { StatusTag } from '@sim/emcn/status'
import { EnvVarDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import {
  FieldPopover,
  FieldPopoverHeading,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/field-popover/field-popover'
import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/code-field/code-field'
import { TagDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import { highlightCustomToolCode } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tool-input/custom-tool-highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tool-input/custom-tool-modal.module.css'
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

interface CustomToolCodeFieldProps {
  value: string
  onChange: (value: string) => void
  isLoading: boolean
  isStreaming: boolean
  schemaParameters: readonly SchemaParameter[]
  workspaceId: string
  /** The block the tool belongs to: its upstream outputs feed the `<` reference picker. */
  blockId?: string
}

/**
 * The code half of the custom tool editor: the schema's parameters, the JavaScript body, and its
 * three caret pickers for secrets, upstream block outputs and schema parameters.
 */
export function CustomToolCodeField({
  value,
  onChange,
  isLoading,
  isStreaming,
  schemaParameters,
  workspaceId,
  blockId,
}: CustomToolCodeFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [showSchemaParams, setShowSchemaParams] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [schemaParamIndex, setSchemaParamIndex] = useState(0)
  const busy = isLoading || isStreaming

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

    if (blockId) setShowTags(checkTagTrigger(next, position).show)

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
          {blockId && (
            <TagDropdown
              visible={showTags}
              onSelect={(next, caret) => {
                onChange(next)
                setShowTags(false)
                placeCaret(caret)
              }}
              blockId={blockId}
              activeSourceBlockId={null}
              inputValue={value}
              cursorPosition={cursorPosition}
              onClose={() => setShowTags(false)}
              inputRef={textareaRef}
            />
          )}
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
