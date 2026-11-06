'use client'

import { useReducer } from 'react'

interface UseServerDraftOptions<T> {
  /** The latest value the server is known to hold. */
  server: T
  /** Equal values never read as an edit or as a change on the server. */
  isEqual: (left: T, right: T) => boolean
  /** A save is underway: its own refetch settles before the draft reacts to the server. */
  saving?: boolean
  /** Lays the edits between `base` and `mine` over `theirs`. By default an edited draft stands whole. */
  merge?: (mine: T, base: T, theirs: T) => T
  /** Edits the draft does not hold yet, such as a rename still being typed. */
  uncommitted?: boolean
}

interface DraftState<T> {
  draft: T
  baseline: T
  /** The server value last reacted to, so only a change on the server is ever treated as one. */
  seen: T
  /** A newer server value held back because adopting it would overwrite an edit. */
  incoming: T | null
}

type DraftAction<T> =
  | { type: 'edit'; update: (current: T) => T }
  | { type: 'server'; server: T; dirty: boolean }
  | { type: 'keep-mine' }
  | { type: 'take-latest' }
  | { type: 'saved'; saved: T; rebase: (current: T) => T }

/**
 * An editing buffer over a value another tab or admin can change. A newer server value is adopted
 * while the draft is clean. While it is dirty the edits stay and `conflict` holds the choice, so a
 * refetch can neither overwrite an edit nor let a save overwrite a change the editor never saw.
 */
export function useServerDraft<T>({
  server,
  isEqual,
  saving = false,
  merge,
  uncommitted = false,
}: UseServerDraftOptions<T>) {
  const threeWay = (mine: T, base: T, theirs: T) =>
    merge ? merge(mine, base, theirs) : isEqual(mine, base) ? theirs : mine

  const [state, dispatch] = useReducer(
    (current: DraftState<T>, action: DraftAction<T>): DraftState<T> => {
      switch (action.type) {
        case 'edit':
          return { ...current, draft: action.update(current.draft) }
        case 'server': {
          const next = { ...current, seen: action.server }
          if (isEqual(action.server, current.baseline)) return { ...next, incoming: null }
          if (!action.dirty) {
            return {
              ...next,
              draft: threeWay(current.draft, current.baseline, action.server),
              baseline: action.server,
              incoming: null,
            }
          }
          if (isEqual(action.server, current.draft)) {
            return { ...next, baseline: action.server, incoming: null }
          }
          return { ...next, incoming: action.server }
        }
        case 'keep-mine': {
          if (current.incoming === null) return current
          return {
            ...current,
            draft: threeWay(current.draft, current.baseline, current.incoming),
            baseline: current.incoming,
            incoming: null,
          }
        }
        case 'take-latest': {
          const latest = current.incoming ?? current.baseline
          return { ...current, draft: latest, baseline: latest, incoming: null }
        }
        case 'saved':
          return {
            ...current,
            draft: action.rebase(current.draft),
            baseline: action.saved,
            incoming: null,
          }
      }
    },
    { draft: server, baseline: server, seen: server, incoming: null }
  )

  const dirty = uncommitted || !isEqual(state.draft, state.baseline)

  if (!saving && state.seen !== server && !isEqual(state.seen, server)) {
    dispatch({ type: 'server', server, dirty })
  }

  return {
    draft: state.draft,
    baseline: state.baseline,
    dirty,
    /** A newer server value is waiting on the editor's choice; a save must not run until it is made. */
    conflict: state.incoming !== null,
    edit: (update: (current: T) => T) => dispatch({ type: 'edit', update }),
    /** Keeps the edits, now on top of the newer value. */
    keepMine: () => dispatch({ type: 'keep-mine' }),
    /** Drops the edits for the newest value known: Discard, and the other side of a conflict. */
    takeLatest: () => dispatch({ type: 'take-latest' }),
    /** A write landed. Whatever was typed after `submitted` stays on top of `saved`. */
    markSaved: (submitted: T, saved: T, rebase?: (current: T) => T) =>
      dispatch({
        type: 'saved',
        saved,
        rebase: rebase ?? ((current) => threeWay(current, submitted, saved)),
      }),
  }
}
