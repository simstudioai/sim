'use client'

import {
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import Editor from 'react-simple-code-editor'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/code-field/code-field.module.css'

/** Line-number digits the gutter has room for, beyond which it stops widening. */
const MAX_GUTTER_DIGITS = 6

interface CodeFieldProps {
  value: string
  onValueChange: (code: string) => void
  /** Markup the editor paints over its transparent text. */
  highlight: (code: string) => string
  /** Names the editor for assistive technology. */
  label: string
  placeholder?: string
  /** Dims the code and refuses edits, as a preview or a gated field does. */
  disabled?: boolean
  /** Editable caret and selection, no edits: a value the block computes. */
  readOnly?: boolean
  /** An AI stream is writing the value; edits wait for it. */
  streaming?: boolean
  /** Paints the frame as an error, for a value the caller rejects. */
  invalid?: boolean
  /** Number each line in a gutter, marking the caret's line. */
  lineNumbers?: boolean
  /** The editor's own textarea, for a caller that places the caret or anchors a picker. */
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  onDrop?: (event: DragEvent<HTMLDivElement>) => void
  /** Actions in the field's top corner, such as Generate or copy. */
  actions?: ReactNode
  /** Pickers the field hangs from its caret. */
  children?: ReactNode
}

/**
 * The editor's code surface: react-simple-code-editor over Prism markup, in the field frame with
 * Geist Mono, wrapped lines, an optional line-number gutter that follows wrapping, and a
 * placeholder.
 */
export function CodeField({
  value,
  onValueChange,
  highlight,
  label,
  placeholder,
  disabled = false,
  readOnly = false,
  streaming = false,
  invalid = false,
  lineNumbers = true,
  textareaRef,
  onKeyDown,
  onFocus,
  onBlur,
  onDrop,
  actions,
  children,
}: CodeFieldProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [lineUnits, setLineUnits] = useState<number[]>([1])
  const [activeLine, setActiveLine] = useState(1)

  const attachTextarea = useCallback(() => {
    const textarea = contentRef.current?.querySelector('textarea') ?? null
    if (textarea) {
      textarea.readOnly = readOnly
      textarea.setAttribute('aria-label', label)
      textarea.spellcheck = false
    }
    if (textareaRef) textareaRef.current = textarea
    return textarea
  }, [label, readOnly, textareaRef])

  useEffect(() => {
    attachTextarea()
  })

  useEffect(() => {
    if (!lineNumbers) return
    const textarea = attachTextarea()
    if (!textarea) return
    const update = () => {
      setActiveLine(value.slice(0, textarea.selectionStart).split('\n').length)
    }
    update()
    textarea.addEventListener('click', update)
    textarea.addEventListener('keyup', update)
    textarea.addEventListener('focus', update)
    return () => {
      textarea.removeEventListener('click', update)
      textarea.removeEventListener('keyup', update)
      textarea.removeEventListener('focus', update)
    }
  }, [value, lineNumbers, attachTextarea])

  useEffect(() => {
    if (!lineNumbers) return
    const content = contentRef.current
    const pre = content?.querySelector('pre')
    if (!content || !pre) return
    const measure = () => {
      const computed = window.getComputedStyle(pre)
      const lineHeight = Number.parseFloat(computed.lineHeight) || 1
      const probe = document.createElement('div')
      Object.assign(probe.style, {
        position: 'absolute',
        visibility: 'hidden',
        width: `${pre.clientWidth}px`,
        font: computed.font,
        padding: computed.padding,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        boxSizing: 'border-box',
      })
      document.body.appendChild(probe)
      const units = value.split('\n').map((line) => {
        const row = document.createElement('div')
        row.textContent = line || ' '
        probe.appendChild(row)
        const height = row.getBoundingClientRect().height
        probe.removeChild(row)
        return Math.max(1, Math.round(height / lineHeight))
      })
      document.body.removeChild(probe)
      setLineUnits(units)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [value, lineNumbers])

  const digits = Math.min(String(value.split('\n').length).length, MAX_GUTTER_DIGITS)
  const inert = disabled || streaming

  return (
    <div
      className={styles.field}
      data-disabled={inert || undefined}
      data-invalid={invalid || undefined}
      onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
      onDrop={onDrop}
    >
      {lineNumbers && (
        <div className={styles.gutter} data-digits={digits} data-type='T009' aria-hidden='true'>
          {lineUnits.flatMap((units, index) => {
            const line = index + 1
            return Array.from({ length: units }, (_, unit) => (
              <span
                key={`${line}-${unit}`}
                className={styles.lineNumber}
                data-active={line === activeLine || undefined}
                data-continued={unit > 0 || undefined}
              >
                {line}
              </span>
            ))
          })}
        </div>
      )}
      <div ref={contentRef} className={styles.content} data-type='T014'>
        {value.length === 0 && placeholder && (
          <span className={styles.placeholder} aria-hidden='true'>
            {placeholder}
          </span>
        )}
        <Editor
          value={value}
          onValueChange={onValueChange}
          highlight={highlight}
          padding={8}
          disabled={disabled}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {children}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}
