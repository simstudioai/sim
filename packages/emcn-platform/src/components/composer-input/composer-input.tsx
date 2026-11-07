'use client'

import {
  type KeyboardEvent,
  type KeyboardEventHandler,
  type RefObject,
  useLayoutEffect,
  useRef,
} from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import styles from '#platform/components/composer-input/composer-input.module.css'
import { MarkedText } from '#platform/components/composer-input/marked-text'

/** Half-open range of a confirmed inline reference in the native textarea value. */
export interface ComposerMark {
  start: number
  end: number
  icon: IconName
  providerId?: string
}

interface ComposerInputProps {
  inputRef?: RefObject<HTMLTextAreaElement | null>
  value?: string
  onValueChange?: (text: string, inputType?: string) => void
  onSubmit?: () => void
  onPasteFiles?: (items: File[]) => void
  onPasteText?: (text: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onCursorChange?: (start: number, end: number) => void
  onEditorKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
  marks?: readonly ComposerMark[]
  listId?: string
  activeOptionId?: string
  anchorOffset?: number
  caretAnchorRef?: RefObject<HTMLSpanElement | null>
  label: string
  placeholder?: string
  defaultValue?: string
  density?: 'standard' | 'compact'
}

const NO_MARKS: readonly ComposerMark[] = []

export function ComposerInput({
  label,
  inputRef,
  value,
  onValueChange,
  onSubmit,
  onPasteFiles,
  onPasteText,
  onFocus,
  onBlur,
  onCursorChange,
  onEditorKeyDown,
  marks = NO_MARKS,
  listId,
  activeOptionId,
  anchorOffset,
  caretAnchorRef,
  placeholder,
  defaultValue,
  density = 'standard',
}: ComposerInputProps) {
  const fallbackInput = useRef<HTMLTextAreaElement>(null)
  const field = inputRef ?? fallbackInput
  const viewport = useScrollEdges<HTMLDivElement>()
  const previousSelection = useRef({ start: 0, end: 0 })
  useLayoutEffect(() => {
    const input = field.current
    if (!input || !marks.length) return
    function selectDeletion(event: InputEvent) {
      if (!input || input.selectionStart !== input.selectionEnd || event.isComposing) return
      const forward = event.inputType === 'deleteContentForward'
      if (!forward && event.inputType !== 'deleteContentBackward') return
      const at = input.selectionStart
      const mark = marks.find(({ start, end }) =>
        forward ? start <= at && at < end : start < at && at <= end
      )
      // Let native deletion record one undo step, including on software keyboards.
      if (mark) input.setSelectionRange(mark.start, mark.end)
    }
    input.addEventListener('beforeinput', selectDeletion)
    return () => input.removeEventListener('beforeinput', selectDeletion)
  }, [field, marks])

  function reportSelection(input: HTMLTextAreaElement) {
    const { selectionStart: start, selectionEnd: end, selectionDirection } = input
    let nextStart = start
    let nextEnd = end
    if (input.value === value && marks.length) {
      const inside = (offset: number) =>
        marks.find((mark) => mark.start < offset && offset < mark.end)
      const first = inside(start)
      if (start === end && first) {
        nextStart = nextEnd = start - first.start < first.end - end ? first.start : first.end
      } else if (start !== end) {
        const last = inside(end)
        const previous = previousSelection.current
        const oneEdgeMoved = (previous.start === start) !== (previous.end === end)
        if (last) nextEnd = oneEdgeMoved && previous.end > end ? last.start : last.end
        if (first)
          nextStart = Math.min(
            nextEnd,
            oneEdgeMoved && previous.start < start ? first.end : first.start
          )
      }
      if (nextStart !== start || nextEnd !== end) {
        input.setSelectionRange(nextStart, nextEnd, selectionDirection)
      }
    }
    previousSelection.current = { start: nextStart, end: nextEnd }
    onCursorChange?.(nextStart, nextEnd)
  }
  function edit(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.key === 'Process') return
    onEditorKeyDown?.(event)
    if (event.defaultPrevented) return
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      onSubmit &&
      !window.matchMedia('(width < 48rem) and (pointer: coarse)').matches
    ) {
      event.preventDefault()
      onSubmit()
      return
    }
    const input = event.currentTarget
    if (
      input.selectionStart !== input.selectionEnd ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return
    const forward = event.key === 'ArrowRight'
    if (!forward && event.key !== 'ArrowLeft') return
    const at = input.selectionStart
    const mark = marks.find(({ start, end }) =>
      forward ? start <= at && at < end : start < at && at <= end
    )
    if (!mark) return
    event.preventDefault()
    const edge = forward ? mark.end : mark.start
    input.setSelectionRange(edge, edge)
    reportSelection(input)
  }
  return (
    <div ref={viewport} className={styles.viewport}>
      <div className={styles.field}>
        {value !== undefined && (marks.length > 0 || anchorOffset !== undefined) && (
          <MarkedText
            text={value}
            marks={marks}
            anchorOffset={anchorOffset}
            caretAnchorRef={caretAnchorRef}
          />
        )}
        <textarea
          ref={field}
          value={value}
          onChange={
            onValueChange &&
            ((event) => {
              const inputType =
                event.nativeEvent instanceof InputEvent ? event.nativeEvent.inputType : undefined
              onValueChange(event.currentTarget.value, inputType)
              onCursorChange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
            })
          }
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={edit}
          onSelect={(event) => reportSelection(event.currentTarget)}
          onPaste={
            (onPasteFiles || onPasteText) &&
            ((event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length && onPasteFiles) {
                event.preventDefault()
                onPasteFiles(files)
                return
              }
              const text = event.clipboardData.getData('text/plain')
              if (text.length > 2000 && onPasteText) {
                event.preventDefault()
                onPasteText(text)
              }
            })
          }
          aria-label={label}
          aria-autocomplete={listId ? 'list' : undefined}
          aria-controls={listId}
          aria-activedescendant={activeOptionId}
          className={styles.composerInput}
          data-marked={marks.length > 0 || undefined}
          data-density={density}
          data-type='T048'
          rows={1}
          placeholder={placeholder}
          defaultValue={defaultValue}
        />
      </div>
    </div>
  )
}
