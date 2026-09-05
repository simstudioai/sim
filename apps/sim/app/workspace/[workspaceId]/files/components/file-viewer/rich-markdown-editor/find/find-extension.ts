import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import {
  EMPTY_FIND_RESULT,
  type FindMatch,
  findMatches,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find/find-matches'

/** Class on every match. The active one carries {@link ACTIVE_MATCH_CLASS} as well. */
const MATCH_CLASS = 'rich-find-match'

/** Class on the one match the bar is currently pointing at. Also how the hook finds it to scroll to. */
export const ACTIVE_MATCH_CLASS = 'rich-find-match-active'

interface RichMarkdownFindState {
  query: string
  matches: readonly FindMatch[]
  truncated: boolean
  /** 0-based index into `matches`. Meaningless, but still 0, when there are none. */
  activeIndex: number
  /**
   * The rendered highlights, built here rather than in the `decorations` prop. ProseMirror asks for
   * decorations on every view update — including caret moves and remote cursor traffic — so building
   * them there would rebuild all 500 for transactions that changed nothing about the search.
   */
  decorations: DecorationSet
}

/** What the surface reads back off the plugin. */
export type FindTally = Pick<RichMarkdownFindState, 'matches' | 'truncated' | 'activeIndex'>

/** Transaction meta the surface sets to drive the search. Absent fields keep their current value. */
interface FindMeta {
  query?: string
  /** Any integer; wrapped into range against the match count, so stepping past either end cycles. */
  activeIndex?: number
}

const RICH_FIND_PLUGIN_KEY = new PluginKey<RichMarkdownFindState>('richMarkdownFind')

const INITIAL_STATE: RichMarkdownFindState = {
  query: '',
  matches: EMPTY_FIND_RESULT.matches,
  truncated: false,
  activeIndex: 0,
  decorations: DecorationSet.empty,
}

function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0
  return ((index % length) + length) % length
}

function buildDecorations(
  doc: EditorState['doc'],
  matches: readonly FindMatch[],
  activeIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === activeIndex ? `${MATCH_CLASS} ${ACTIVE_MATCH_CLASS}` : MATCH_CLASS,
      })
    )
  )
}

/**
 * Renders the find highlights over the document, and owns the match set they are built from.
 *
 * The surface never passes matches in — it sets only the term and the active index as transaction
 * meta ({@link setFindQuery}, {@link stepFindMatch}) and reads the resulting state back with
 * {@link getFindTally}. Keeping the search here is what makes it survive editing: the plugin
 * re-searches on any transaction that changed the document, so a highlight can never be left
 * pointing at a position the edit moved or deleted (a stale `Decoration` on a removed range throws).
 *
 * Decorations are inline and add no node to the document, so the search leaves the markdown — and
 * the collaborative Y.Doc behind it — completely untouched. Nothing here dispatches, and with no
 * term set every branch short-circuits to the untouched previous state, so the plugin is inert
 * until a find bar opens.
 */
export const RichMarkdownFind = Extension.create({
  name: 'richMarkdownFind',

  addProseMirrorPlugins() {
    return [
      new Plugin<RichMarkdownFindState>({
        key: RICH_FIND_PLUGIN_KEY,
        state: {
          init: () => INITIAL_STATE,
          apply(transaction, value, _oldState, newState) {
            const meta = transaction.getMeta(RICH_FIND_PLUGIN_KEY) as FindMeta | undefined
            const query = meta?.query ?? value.query
            const requestedIndex = meta?.activeIndex ?? value.activeIndex
            const unsearched = query.trim().length === 0
            if (unsearched && value.matches.length === 0) {
              return query === value.query && value.activeIndex === 0
                ? value
                : { ...INITIAL_STATE, query }
            }
            if (!transaction.docChanged && query === value.query) {
              const activeIndex = wrapIndex(requestedIndex, value.matches.length)
              if (activeIndex === value.activeIndex) return value
              return {
                ...value,
                activeIndex,
                decorations: buildDecorations(newState.doc, value.matches, activeIndex),
              }
            }
            const { matches, truncated } = unsearched
              ? EMPTY_FIND_RESULT
              : findMatches(newState.doc, query)
            const activeIndex = wrapIndex(requestedIndex, matches.length)
            return {
              query,
              matches,
              truncated,
              activeIndex,
              decorations: buildDecorations(newState.doc, matches, activeIndex),
            }
          },
        },
        props: {
          decorations: (state) => RICH_FIND_PLUGIN_KEY.getState(state)?.decorations ?? null,
        },
      }),
    ]
  },
})

/** The match set, cap flag and active index the find bar renders from. */
export function getFindTally(state: EditorState): FindTally {
  return RICH_FIND_PLUGIN_KEY.getState(state) ?? INITIAL_STATE
}

function dispatchFindMeta(editor: Editor, meta: FindMeta): void {
  // `setMeta` alone leaves the transaction with no steps, so this never touches the document,
  // the undo history, or the collaborative document.
  editor.view.dispatch(editor.state.tr.setMeta(RICH_FIND_PLUGIN_KEY, meta))
}

/** Searches for `query` and makes its first match active. An empty term clears the highlights. */
export function setFindQuery(editor: Editor, query: string): void {
  dispatchFindMeta(editor, { query, activeIndex: 0 })
}

/** Moves the active match by `delta`, cycling past either end. */
export function stepFindMatch(editor: Editor, delta: number): void {
  dispatchFindMeta(editor, { activeIndex: getFindTally(editor.state).activeIndex + delta })
}

function stopUndoCapture(editor: Editor): void {
  const state = yUndoPluginKey.getState(editor.state) as
    | { undoManager?: { stopCapturing: () => void } }
    | undefined
  state?.undoManager?.stopCapturing()
}

function isolateReplacement(editor: Editor, transaction: EditorState['tr']): void {
  stopUndoCapture(editor)
  editor.view.dispatch(closeHistory(transaction).scrollIntoView())
  stopUndoCapture(editor)
  editor.view.dispatch(closeHistory(editor.state.tr))
}

/** Bounds aggregate growth before Replace All can materialize hundreds of large insertions. */
function replacementExceedsLimit(
  editor: Editor,
  matches: readonly FindMatch[],
  replacement: string
): boolean {
  const currentSize = editor.state.doc.content.size
  const nextSize = matches.reduce(
    (size, match) => size + replacement.length - (match.to - match.from),
    currentSize
  )
  return nextSize > Math.max(currentSize, PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS)
}

/** Uses the target range's marks, independent of formatting armed at the editor's caret. */
function replaceMatch(transaction: EditorState['tr'], match: FindMatch, replacement: string): void {
  const marks = transaction.doc.resolve(match.from).marksAcross(transaction.doc.resolve(match.to))
  transaction.replaceWith(
    match.from,
    match.to,
    replacement ? transaction.doc.type.schema.text(replacement, marks) : []
  )
}

export function replaceActiveFindMatch(
  editor: Editor,
  replacement: string,
  onLimitExceeded?: () => void
): boolean {
  if (!editor.isEditable) return false
  const findState = RICH_FIND_PLUGIN_KEY.getState(editor.state) ?? INITIAL_STATE
  const { matches, activeIndex } = findState
  const match = matches[activeIndex]
  if (!match) return false
  if (replacementExceedsLimit(editor, [match], replacement)) {
    onLimitExceeded?.()
    return false
  }
  const transaction = editor.state.tr
  replaceMatch(transaction, match, replacement)
  const remaining = findMatches(transaction.doc, findState.query).matches
  const insertionEnd = match.from + replacement.length
  const nextIndex = remaining.findIndex((candidate) => candidate.from >= insertionEnd)
  transaction.setMeta(RICH_FIND_PLUGIN_KEY, { activeIndex: nextIndex === -1 ? 0 : nextIndex })
  isolateReplacement(editor, transaction)
  return true
}

/** Replaces every collected match in one undo step; capped searches must first be narrowed. */
export function replaceAllFindMatches(
  editor: Editor,
  replacement: string,
  onLimitExceeded?: () => void
): number {
  if (!editor.isEditable) return 0
  const { matches, truncated } = getFindTally(editor.state)
  if (truncated || matches.length === 0) return 0
  if (replacementExceedsLimit(editor, matches, replacement)) {
    onLimitExceeded?.()
    return 0
  }
  const transaction = closeHistory(editor.state.tr)
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    replaceMatch(transaction, match, replacement)
  }
  isolateReplacement(editor, transaction)
  return matches.length
}
