import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  buildFindRegex,
  findMatches,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/find/find-matches'
import type { FindFlags } from '@/app/workspace/[workspaceId]/files/components/file-viewer/find/types'

const MATCH_CLASS = 'file-find-match'
const CURRENT_MATCH_CLASS = 'file-find-match-current'

export const findPluginKey = new PluginKey<FindPluginState>('fileFind')

export interface FindMatchRange {
  from: number
  to: number
  groups: (string | undefined)[]
}

export interface FindPluginState {
  query: string
  flags: FindFlags
  matches: FindMatchRange[]
  currentIndex: number
  truncated: boolean
  decorations: DecorationSet
}

const EMPTY_FLAGS: FindFlags = { caseSensitive: false, wholeWord: false, regex: false }

const INITIAL_STATE: FindPluginState = {
  query: '',
  flags: EMPTY_FLAGS,
  matches: [],
  currentIndex: -1,
  truncated: false,
  decorations: DecorationSet.empty,
}

/** A `setMeta(findPluginKey, …)` payload. `query`/`flags` re-run the search; `currentIndex` just re-decorates. */
export interface FindMeta {
  query?: string
  flags?: FindFlags
  currentIndex?: number
}

interface DocText {
  text: string
  /** `map[i]` is the document position of character `i`; block separators map to -1. */
  map: number[]
}

/**
 * Flattens the document to a searchable string with a position map. Characters within a block
 * (across mark boundaries) stay contiguous; a newline separator is inserted between non-adjacent
 * text runs so a query never matches across block boundaries. Separator characters map to -1 and are
 * excluded from match ranges.
 */
function buildDocText(doc: PMNode): DocText {
  let text = ''
  const map: number[] = []
  let lastEnd = -1

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      if (lastEnd !== -1 && pos !== lastEnd) {
        text += '\n'
        map.push(-1)
      }
      for (let i = 0; i < node.text.length; i++) {
        text += node.text[i]
        map.push(pos + i)
      }
      lastEnd = pos + node.text.length
      return false
    }
    return true
  })

  return { text, map }
}

function buildDecorations(
  doc: PMNode,
  matches: FindMatchRange[],
  currentIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === currentIndex ? CURRENT_MATCH_CLASS : MATCH_CLASS,
    })
  )
  return DecorationSet.create(doc, decorations)
}

/** Recomputes matches + decorations for `query`/`flags` over `doc`, preserving `currentIndex` when asked. */
export function computeFindState(
  doc: PMNode,
  query: string,
  flags: FindFlags,
  currentIndex: number,
  keepIndex: boolean
): FindPluginState {
  const regex = buildFindRegex(query, flags)
  if (!regex) {
    return {
      query,
      flags,
      matches: [],
      currentIndex: -1,
      truncated: false,
      decorations: DecorationSet.empty,
    }
  }

  const { text, map } = buildDocText(doc)
  const { ranges, total, capped } = findMatches(text, regex)
  const matches: FindMatchRange[] = []
  for (const range of ranges) {
    const from = map[range.start]
    const to = map[range.end - 1]
    if (from === -1 || to === -1 || from === undefined || to === undefined) continue
    matches.push({ from, to: to + 1, groups: range.groups })
  }

  const nextIndex =
    matches.length === 0
      ? -1
      : keepIndex
        ? Math.min(Math.max(currentIndex, 0), matches.length - 1)
        : 0

  return {
    query,
    flags,
    matches,
    currentIndex: nextIndex,
    truncated: capped || total > matches.length,
    decorations: buildDecorations(doc, matches, nextIndex),
  }
}

/** Reads the find plugin state from an editor state. */
export function getFindState(state: Parameters<typeof findPluginKey.getState>[0]): FindPluginState {
  return findPluginKey.getState(state) ?? INITIAL_STATE
}

function createFindPlugin(): Plugin<FindPluginState> {
  return new Plugin<FindPluginState>({
    key: findPluginKey,
    state: {
      init: () => INITIAL_STATE,
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(findPluginKey) as FindMeta | undefined

        if (meta) {
          const query = meta.query ?? prev.query
          const flags = meta.flags ?? prev.flags
          // A currentIndex-only meta (stepping) keeps the match set and just re-decorates.
          if (
            meta.query === undefined &&
            meta.flags === undefined &&
            meta.currentIndex !== undefined
          ) {
            return {
              ...prev,
              currentIndex: meta.currentIndex,
              decorations: buildDecorations(newState.doc, prev.matches, meta.currentIndex),
            }
          }
          return computeFindState(newState.doc, query, flags, meta.currentIndex ?? 0, false)
        }

        if (tr.docChanged) {
          if (!prev.query) {
            return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) }
          }
          // Recompute against the new doc (local OR remote edit), keeping the active match index.
          return computeFindState(newState.doc, prev.query, prev.flags, prev.currentIndex, true)
        }

        return prev
      },
    },
    props: {
      decorations(state) {
        return findPluginKey.getState(state)?.decorations
      },
    },
  })
}

/** TipTap extension that hosts the find/replace ProseMirror plugin. Inert until a query is set. */
export const FileFindHighlight = Extension.create({
  name: 'fileFindHighlight',
  addProseMirrorPlugins() {
    return [createFindPlugin()]
  },
})
