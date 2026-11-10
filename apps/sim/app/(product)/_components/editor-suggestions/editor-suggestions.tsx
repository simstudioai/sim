'use client'

import { useEffect, useId, useMemo } from 'react'
import { ComposerSuggestions } from '@sim/emcn-platform/composer-input/suggestions'
import type { SuggestionListProps } from '@/components/file-viewer/rich-markdown-editor/suggestion-list'

/**
 * The rich editor's `/` and `@` menus on the composer's suggestion list. Focus stays in the
 * document while the reader arrows through the rows, so the editor carries the combobox attributes
 * for the list.
 */
export function EditorSuggestions({
  editor,
  label,
  empty,
  rows,
  active,
  onHighlight,
  onSelect,
  anchor,
  onDismiss,
}: SuggestionListProps) {
  const listId = `suggestions-${useId().replace(/:/g, '')}`
  const activeId = rows.length > 0 ? `${listId}-${active}` : null
  const input = useMemo(() => ({ current: editor.view.dom }), [editor])

  useEffect(() => {
    const dom = editor.view.dom
    dom.setAttribute('aria-haspopup', 'listbox')
    dom.setAttribute('aria-expanded', 'true')
    return () => {
      dom.removeAttribute('aria-haspopup')
      dom.removeAttribute('aria-expanded')
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor])

  useEffect(() => {
    const dom = editor.view.dom
    if (activeId) {
      dom.setAttribute('aria-controls', listId)
      dom.setAttribute('aria-activedescendant', activeId)
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, listId, activeId])

  if (rows.length === 0 && empty === null) return null
  return (
    <ComposerSuggestions
      id={listId}
      label={label}
      empty={empty ?? ''}
      items={rows}
      active={active}
      onHighlight={onHighlight}
      onSelect={onSelect}
      onDismiss={onDismiss}
      anchor={anchor}
      input={input}
      grouped
      side='bottom'
    />
  )
}
