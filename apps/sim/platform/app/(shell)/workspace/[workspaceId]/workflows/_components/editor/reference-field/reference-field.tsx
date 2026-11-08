'use client'

import {
  type ChangeEvent,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from 'react'
import { EnvVarDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import {
  formatDisplayText,
  type WorkflowSearchTextHighlight,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  maskSecretText,
  shouldMaskSecretValue,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/password-mask'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field.module.css'
import { TagDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import type { UseSubBlockInputResult } from '@/platform/lib/data/workflow-editor'

type FieldElement = HTMLInputElement | HTMLTextAreaElement

/** The picker state and handlers every field of one sub-block shares. */
type ReferenceFieldController = Pick<UseSubBlockInputResult, 'fieldHelpers' | 'workspaceId'>

/** Props for {@link ReferenceField}. */
interface ReferenceFieldProps {
  /** Lets a visible `<label htmlFor>` name and focus the field. */
  id?: string
  /** The field's accessible name. */
  label: string
  /** The block that owns the field, whose upstream outputs the reference picker offers. */
  blockId: string
  value: string
  onChange: (value: string) => void
  /** Persists a value with a picked block reference; defaults to `onChange`. */
  onReferenceSelect?: (value: string) => void
  /** The sub-block's shared input controller; without it the field offers no pickers. */
  controller?: ReferenceFieldController
  /** This field's key in the controller's per-field caret and picker state. */
  fieldKey?: string
  /** Also offer `{{SECRET}}` names after `{{`, not only block references after `<`. */
  secrets?: boolean
  /** Wrap onto as many lines as the value holds instead of scrolling one line. */
  multiline?: boolean
  /** A multi-line value in Geist Mono, as JSON is. */
  code?: boolean
  /** Conceal the value while the field is not focused. */
  password?: boolean
  placeholder?: string
  disabled?: boolean
  accessiblePrefixes?: Set<string>
  searchHighlight?: WorkflowSearchTextHighlight | null
  /** Runs before the field's own keys; preventing the default keeps them from seeing the key. */
  onKeyDown?: (event: KeyboardEvent<FieldElement>) => void
  /** Enter on a single-line field with no picker open and no composition, after the field's own keys. */
  onEnter?: (event: KeyboardEvent<HTMLInputElement>) => void
  /** Receives the field element, for a parent that moves focus between its fields. */
  fieldRef?: (element: FieldElement | null) => void
}

/**
 * One reference-aware text field among several in a sub-block: references and secrets highlight
 * over the typed text, `<` opens the block reference picker at the caret (and, with `secrets`, `{{`
 * the secret picker), and a dropped connection inserts a reference. Every field of the sub-block
 * shares one input controller, keyed by `fieldKey`, the way a single field owns its own.
 */
export function ReferenceField({
  id,
  label,
  blockId,
  value,
  onChange,
  onReferenceSelect,
  controller,
  fieldKey,
  secrets = false,
  multiline = false,
  code = false,
  password = false,
  placeholder,
  disabled = false,
  accessiblePrefixes,
  searchHighlight,
  onKeyDown,
  onEnter,
  fieldRef,
}: ReferenceFieldProps) {
  const element = useRef<FieldElement | null>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [focused, setFocused] = useState(false)

  const picker =
    controller && fieldKey !== undefined
      ? {
          state: controller.fieldHelpers.getFieldState(fieldKey),
          handlers: controller.fieldHelpers.createFieldHandlers(fieldKey, value, onChange),
          selectTag: controller.fieldHelpers.createTagSelectHandler(
            fieldKey,
            onReferenceSelect ?? onChange
          ),
          selectEnvVar: controller.fieldHelpers.createEnvVarSelectHandler(fieldKey, onChange),
          close: () => controller.fieldHelpers.hideFieldDropdowns(fieldKey),
          workspaceId: controller.workspaceId,
        }
      : undefined
  const handlers = picker?.handlers
  const envVarsOpen = Boolean(picker && secrets && !disabled && picker.state.showEnvVars)
  const tagsOpen = Boolean(picker && !disabled && picker.state.showTags)

  const attach = (node: FieldElement | null) => {
    element.current = node
    fieldRef?.(node)
  }

  const syncOverlayScroll = () => {
    if (element.current && overlay.current) overlay.current.scrollLeft = element.current.scrollLeft
  }

  const placeCaret = (cursor: number) =>
    requestAnimationFrame(() => {
      const node = element.current
      if (!node) return
      node.focus()
      node.setSelectionRange(cursor, cursor)
      syncOverlayScroll()
    })

  const handleChange = handlers
    ? handlers.onChange
    : (event: ChangeEvent<FieldElement>) => onChange(event.target.value)

  const handleKeyDown = (event: KeyboardEvent<FieldElement>) => {
    onKeyDown?.(event)
    if (!event.defaultPrevented) handlers?.onKeyDown(event)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(event)
    if (
      !onEnter ||
      event.key !== 'Enter' ||
      event.nativeEvent.isComposing ||
      event.defaultPrevented ||
      envVarsOpen ||
      tagsOpen
    )
      return
    onEnter(event)
  }

  const handleFocus = (event: FocusEvent<FieldElement>) => {
    setFocused(true)
    handlers?.onFocus(event)
  }

  const handleDragOver = (event: DragEvent<FieldElement>) => {
    handlers?.onDragOver(event)
    if (event.defaultPrevented && !disabled) setDragging(true)
  }

  const handleDrop = (event: DragEvent<FieldElement>) => {
    setDragging(false)
    handlers?.onDrop(event)
  }

  const masked = shouldMaskSecretValue({ password, isFocused: focused })
  const fieldValue = masked ? maskSecretText(value) : value
  const shown = masked
    ? fieldValue
    : formatDisplayText(value, {
        accessiblePrefixes,
        highlightAll: !accessiblePrefixes,
        workflowSearchHighlight: searchHighlight,
      })

  const pickers = picker && (
    <>
      {envVarsOpen && (
        <EnvVarDropdown
          visible
          onSelect={(next, cursor) => {
            picker.selectEnvVar(next)
            placeCaret(cursor)
          }}
          searchTerm={picker.state.searchTerm}
          inputValue={value}
          cursorPosition={picker.state.cursorPosition}
          onClose={picker.close}
          workspaceId={picker.workspaceId}
          inputRef={element}
        />
      )}
      {tagsOpen && (
        <TagDropdown
          visible
          onSelect={(next, cursor) => {
            picker.selectTag(next)
            placeCaret(cursor)
          }}
          blockId={blockId}
          activeSourceBlockId={picker.state.activeSourceBlockId}
          inputValue={value}
          cursorPosition={picker.state.cursorPosition}
          onClose={picker.close}
          inputRef={element}
        />
      )}
    </>
  )

  if (multiline || code) {
    const typeRole = code ? 'T014' : 'T043'
    return (
      <div
        className={styles.frame}
        data-multiline
        data-code={code || undefined}
        data-disabled={disabled || undefined}
        data-dragging={dragging || undefined}
      >
        <div className={styles.mirror} data-type={typeRole} aria-hidden='true'>
          {shown}
          {'​'}
        </div>
        <textarea
          ref={attach}
          id={id}
          className={styles.textarea}
          data-type={typeRole}
          aria-label={label}
          placeholder={placeholder}
          value={fieldValue}
          disabled={disabled}
          spellCheck={false}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => setFocused(false)}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        />
        {pickers}
      </div>
    )
  }

  return (
    <div
      className={styles.frame}
      data-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
    >
      <input
        ref={attach}
        id={id}
        className={styles.input}
        data-type='T043'
        type='text'
        aria-label={label}
        placeholder={placeholder}
        value={fieldValue}
        disabled={disabled}
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck={false}
        onChange={handleChange}
        onKeyDown={handleInputKeyDown}
        onFocus={handleFocus}
        onBlur={() => setFocused(false)}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onScroll={syncOverlayScroll}
        onPaste={() => requestAnimationFrame(syncOverlayScroll)}
      />
      <div ref={overlay} className={styles.overlay} data-type='T043' aria-hidden='true'>
        <span className={styles.overlayText}>{shown}</span>
      </div>
      {pickers}
    </div>
  )
}
