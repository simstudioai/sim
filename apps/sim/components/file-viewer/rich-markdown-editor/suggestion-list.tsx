'use client'

import { type ComponentType, createContext, type ReactNode, useContext } from 'react'
import type { IconName } from '@sim/emcn/icon'
import type { Editor } from '@tiptap/core'
import type { SuggestionPlacement } from '@/components/file-viewer/rich-markdown-editor/suggestion-popup'

interface SuggestionRow {
  name: string
  group: string
  icon?: IconName
  providerId?: string
  /** A keyboard shortcut, shown at the row's end as a menu shows one. */
  shortcut?: string
}

export interface SuggestionListProps extends SuggestionPlacement {
  /** The editor keeps focus while the menu is open, so it is wired as the ARIA combobox. */
  editor: Editor
  label: string
  /** What the list says with nothing to offer; `null` while its rows are still arriving. */
  empty: string | null
  /** The rows in display order, grouped by their `group`. */
  rows: readonly SuggestionRow[]
  active: number
  onHighlight: (index: number) => void
  onSelect: (index: number) => void
}

const SuggestionListContext = createContext<ComponentType<SuggestionListProps> | null>(null)

/**
 * Supplies the listbox the `/` and `@` menus draw. The product provides the composer's
 * suggestions; the public share page renders the editor read-only and provides none, so it never
 * loads the Platform package.
 */
export function SuggestionListProvider({
  list,
  children,
}: {
  list: ComponentType<SuggestionListProps>
  children: ReactNode
}) {
  return <SuggestionListContext.Provider value={list}>{children}</SuggestionListContext.Provider>
}

/** The `/` and `@` menus' listbox, as the surrounding host supplies it; nothing without one. */
export function SuggestionList(props: SuggestionListProps) {
  const List = useContext(SuggestionListContext)
  return List ? <List {...props} /> : null
}
