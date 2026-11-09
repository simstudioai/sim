'use client'

import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/condition-input/condition-input.module.css'
import {
  formatDisplayText,
  type WorkflowSearchTextHighlight,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'

interface RouteDescriptionProps {
  value: string
  /** Names the field for assistive technology. */
  label: string
  disabled: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  accessiblePrefixes: Set<string> | undefined
  search: WorkflowSearchTextHighlight | null
  onChange: (value: string, caret: number) => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onDrop: (event: DragEvent<HTMLTextAreaElement>) => void
  /** The reference and secret pickers the field hangs from its caret. */
  children?: ReactNode
}

/**
 * A Router route's description: the text the model reads to choose the route, with references
 * and secrets highlighted over what is typed. It rests five lines tall and grows with its text.
 */
export function RouteDescription({
  value,
  label,
  disabled,
  textareaRef,
  accessiblePrefixes,
  search,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onDrop,
  children,
}: RouteDescriptionProps) {
  return (
    <div className={styles.route} data-disabled={disabled || undefined}>
      <div className={styles.routeMirror} data-type='T043' aria-hidden='true'>
        {formatDisplayText(value, {
          accessiblePrefixes,
          highlightAll: !accessiblePrefixes,
          workflowSearchHighlight: search,
        })}
        {'​'}
      </div>
      <textarea
        ref={textareaRef}
        className={styles.routeTextarea}
        data-type='T043'
        aria-label={label}
        placeholder='Describe when this route should be taken…'
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value, event.target.selectionStart ?? 0)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      />
      {children}
    </div>
  )
}
