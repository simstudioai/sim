'use client'

import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from 'react'
import type { ComposerController } from '@/app/(product)/_components/composer/model'
import {
  type ComposerOption,
  filterOptions,
  prefixFor,
  referenceKey,
  referenceOptions,
  selectedOptions,
  uniqueOption,
} from '@/app/(product)/_components/composer/reference-options'
import {
  matchReferences,
  SLASH_TOKEN,
  triggerAt,
} from '@/app/(product)/_components/composer/reference-text'

export function useComposerReferences(composer: ComposerController) {
  const editor = useRef<HTMLTextAreaElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const pending = useRef<ComposerOption | null>(null)
  const removedReferences = useRef<ComposerOption[]>([])
  const listId = useId()
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [highlight, setHighlight] = useState({ key: '', index: 0 })
  const { text, attachments } = composer.draft
  const { references, tools, skills } = composer
  const options = useMemo(
    () => referenceOptions({ references, tools, skills }),
    [references, tools, skills]
  )
  const browseOptions = useMemo(
    () => referenceOptions({ references: composer.browse, tools }),
    [composer.browse, tools]
  )
  const selected = useMemo(() => selectedOptions(attachments, options), [attachments, options])
  const picked = selected.map(({ item }) => item)
  const matches = matchReferences(text, picked, options)
  const marks = matches.map(({ start, end, item }) => ({
    start,
    end,
    icon: item.icon,
    providerId: item.providerId,
  }))
  const candidate =
    focused && caret !== null && !composer.referencesDisabled
      ? triggerAt(text, caret, matches)
      : null
  const trigger = candidate && candidate.start !== dismissed ? candidate : null
  const loading = trigger?.prefix === '/' ? composer.skillsLoading : composer.referencesLoading
  const rows = trigger ? filterOptions(options, trigger.prefix, trigger.query) : []
  const key = trigger ? `${trigger.start}:${trigger.prefix}${trigger.query}` : ''
  const active = highlight.key === key && highlight.index < rows.length ? highlight.index : 0
  const inlineIds = new Set(matches.map(({ item }) => referenceKey(item)))
  const attachedIds = new Set(
    selected.filter(({ item }) => inlineIds.has(referenceKey(item))).map((row) => row.attachmentId)
  )

  function update(value: string, inputType?: string) {
    const known = pending.current ? [...picked, pending.current] : [...picked]
    if (inputType === 'historyUndo' || inputType === 'historyRedo') {
      const names = new Set(known.map((item) => prefixFor(item.group) + item.name))
      for (const item of removedReferences.current) {
        const token = prefixFor(item.group) + item.name
        if (!names.has(token)) {
          known.push(item)
          names.add(token)
        }
      }
    }
    const nextMatches = matchReferences(value, known, options)
    const nextKeys = new Set(nextMatches.map(({ item }) => referenceKey(item)))
    const removed = selected.filter(
      ({ item, attachmentId }) => attachedIds.has(attachmentId) && !nextKeys.has(referenceKey(item))
    )
    if (removed.length) {
      const lost = removed.map(({ item }) => item)
      removedReferences.current = [...lost, ...removedReferences.current].slice(0, 100)
    }
    const remove = removed.map(({ attachmentId }) => attachmentId)
    const additions = new Map(nextMatches.map(({ item }) => [referenceKey(item), item]))
    for (const item of picked) additions.delete(referenceKey(item))

    // Completed names use the catalog spelling, without changing the surrounding prose or offsets.
    let canonical = value
    for (const { start, end, item } of nextMatches) {
      if (value.slice(start + 1, end) !== item.name)
        canonical = canonical.slice(0, start + 1) + item.name + canonical.slice(end)
    }
    const input = editor.current
    if (input && canonical !== value) {
      const { selectionStart, selectionEnd, selectionDirection } = input
      input.setRangeText(canonical, 0, value.length, 'preserve')
      input.setSelectionRange(selectionStart, selectionEnd, selectionDirection)
    }
    composer.setText(
      canonical,
      additions.size || remove.length ? { add: [...additions.values()], remove } : undefined
    )
    const position = editor.current?.selectionStart ?? canonical.length
    const next = triggerAt(canonical, position, nextMatches)
    if (SLASH_TOKEN.test(canonical)) composer.onSkillIntent?.()
    if (dismissed !== null && next?.start !== dismissed) setDismissed(null)
    if (next?.prefix === '@') {
      composer.onPickerOpen?.()
      composer.onReferenceSearch?.(next.query)
    }
  }

  function replace(start: number, end: number, insertion: string, item?: ComposerOption) {
    const input = editor.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(start, end)
    pending.current = item ?? null
    // Native insertion keeps accepting a suggestion in the same undo history as typing.
    if (!document.execCommand('insertText', false, insertion)) {
      input.setRangeText(insertion, start, end, 'end')
      update(input.value)
    }
    pending.current = null
    setCaret(input.selectionEnd)
  }

  function choose(option: ComposerOption, fromTrigger: boolean) {
    const input = editor.current
    if (!input) return
    const start = fromTrigger && trigger ? trigger.start : input.selectionStart
    const end = fromTrigger && trigger ? trigger.end : input.selectionEnd
    const item = uniqueOption(option, selected)
    const prefix = start > 0 && !/\s/.test(text[start - 1]) ? ' ' : ''
    // Reuse the existing separator when inserting in the middle of a sentence.
    const replaceEnd = text[end] === ' ' ? end + 1 : end
    replace(start, replaceEnd, `${prefix}${prefixFor(item.group)}${item.name} `, item)
    setDismissed(null)
    if (!fromTrigger) {
      // The browse menu restores its trigger on close; continue typing at the accepted token.
      requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }))
    }
  }

  function insertSlash() {
    const input = editor.current
    if (!input) return
    setDismissed(null)
    const start = input.selectionStart
    replace(start, input.selectionEnd, start && !/\s/.test(text[start - 1]) ? ' /' : '/')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!trigger || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(trigger.start)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length)
        setHighlight({
          key,
          index: (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length,
        })
    } else if (
      (event.key === 'Enter' || event.key === 'Tab') &&
      (rows[active] || (loading && trigger.prefix === '@'))
    ) {
      // A `/name` typed while skills load is sent and held until they land, so Enter falls through.
      event.preventDefault()
      if (rows[active]) choose(rows[active], true)
    }
  }

  return {
    editor,
    anchor,
    listId,
    trigger,
    rows,
    active,
    marks,
    insertSlash,
    loading,
    update,
    onKeyDown,
    browse: composer.referencesDisabled
      ? []
      : browseOptions.filter(
          (item) => prefixFor(item.group) === '@' && item.group !== 'Integrations'
        ),
    attachments: attachments.filter((attachment) => !attachedIds.has(attachment.id)),
    selectRow: (index: number) => {
      if (rows[index]) choose(rows[index], true)
    },
    selectResource: (item: ComposerOption) => choose(item, false),
    highlight: (index: number) => setHighlight({ key, index }),
    dismiss: () => setDismissed(trigger?.start ?? null),
    cursor: (start: number, end: number) => {
      setCaret(start === end ? start : null)
      if (start === end && triggerAt(text, start, matches)?.prefix === '@')
        composer.onPickerOpen?.()
    },
    /** Pressing the field reaches for a resource, as legacy's field did; focus alone does not. */
    pointerDown: (event: PointerEvent) => {
      if (event.target === editor.current) composer.onPickerOpen?.()
    },
    focus: () => setFocused(true),
    blur: () => setFocused(false),
  }
}
