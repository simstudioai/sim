export type TextEditorContentPhase = 'uninitialized' | 'ready' | 'streaming' | 'reconciling'

export interface TextEditorContentState {
  phase: TextEditorContentPhase
  content: string
  savedContent: string
  lastStreamedContent: string | null
  /**
   * Whether `savedContent` is the file's real baseline (not the initial placeholder). False only
   * before the first fetched content has been observed — e.g. a stream that began before the initial
   * fetch resolved. While false, a fetched value is treated as the baseline to adopt, not as the
   * agent's write advancing past the baseline (which would finalize the editor to stale content).
   */
  hasBaseline: boolean
}

export interface SyncTextEditorContentStateOptions {
  canReconcileToFetchedContent: boolean
  fetchedContent?: string
  streamingContent?: string
}

export type TextEditorContentAction =
  | ({ type: 'sync-external' } & SyncTextEditorContentStateOptions)
  | { type: 'edit'; content: string }
  | { type: 'save-success'; content: string }

export const INITIAL_TEXT_EDITOR_CONTENT_STATE: TextEditorContentState = {
  phase: 'uninitialized',
  content: '',
  savedContent: '',
  lastStreamedContent: null,
  hasBaseline: false,
}

function finalizeTextEditorContentState(
  state: TextEditorContentState,
  nextContent: string
): TextEditorContentState {
  if (
    state.phase === 'ready' &&
    state.content === nextContent &&
    state.savedContent === nextContent &&
    state.lastStreamedContent === null &&
    state.hasBaseline
  ) {
    return state
  }

  return {
    phase: 'ready',
    content: nextContent,
    savedContent: nextContent,
    lastStreamedContent: null,
    hasBaseline: true,
  }
}

function moveTextEditorContentStateToStreaming(
  state: TextEditorContentState,
  nextContent: string,
  fetchedBaseline?: string
): TextEditorContentState {
  // A stream that begins before the initial fetch resolves leaves `savedContent` at its placeholder.
  // The first fetched value to arrive during the stream IS the file's pre-edit baseline (the agent
  // hasn't persisted its write yet), so adopt it. Without this, a later refetch of that same pre-edit
  // content would read as an "advance" past the placeholder and finalize the editor to stale content
  // mid-stream. Empty-file creates are unaffected: their baseline genuinely is ''.
  const adoptBaseline = !state.hasBaseline && fetchedBaseline !== undefined
  const savedContent = adoptBaseline ? fetchedBaseline : state.savedContent
  const hasBaseline = state.hasBaseline || adoptBaseline

  if (
    state.phase === 'streaming' &&
    state.content === nextContent &&
    state.lastStreamedContent === nextContent &&
    state.savedContent === savedContent &&
    state.hasBaseline === hasBaseline
  ) {
    return state
  }

  return {
    ...state,
    phase: 'streaming',
    content: nextContent,
    lastStreamedContent: nextContent,
    savedContent,
    hasBaseline,
  }
}

function moveTextEditorContentStateToReconcile(
  state: TextEditorContentState
): TextEditorContentState {
  if (state.phase === 'reconciling') {
    return state
  }

  return {
    ...state,
    phase: 'reconciling',
  }
}

export function syncTextEditorContentState(
  state: TextEditorContentState,
  options: SyncTextEditorContentStateOptions
): TextEditorContentState {
  const { canReconcileToFetchedContent, fetchedContent, streamingContent } = options

  if (streamingContent !== undefined) {
    const nextContent = streamingContent
    const fetchedMatchesNextContent = fetchedContent !== undefined && fetchedContent === nextContent
    const fetchedMatchesLastStreamedContent =
      fetchedContent !== undefined &&
      state.lastStreamedContent !== null &&
      fetchedContent === state.lastStreamedContent
    // Only an ESTABLISHED baseline makes "fetched differs from savedContent" mean "the agent's write
    // advanced". Before the baseline is established (stream started before the fetch resolved),
    // savedContent is a placeholder, so the file's own pre-edit content would falsely read as an
    // advance and finalize to stale content; instead it is adopted as the baseline in moveToStreaming.
    const hasFetchedAdvanced =
      fetchedContent !== undefined && state.hasBaseline && fetchedContent !== state.savedContent

    if (
      (state.phase === 'streaming' || state.phase === 'reconciling') &&
      (hasFetchedAdvanced || fetchedMatchesLastStreamedContent || fetchedMatchesNextContent)
    ) {
      return finalizeTextEditorContentState(state, fetchedContent)
    }

    if (
      state.phase === 'ready' &&
      state.content === state.savedContent &&
      fetchedMatchesNextContent &&
      fetchedContent !== undefined
    ) {
      return finalizeTextEditorContentState(state, fetchedContent)
    }

    return moveTextEditorContentStateToStreaming(state, nextContent, fetchedContent)
  }

  if (state.phase === 'streaming' || state.phase === 'reconciling') {
    if (!canReconcileToFetchedContent) {
      return finalizeTextEditorContentState(state, state.content)
    }

    if (fetchedContent !== undefined) {
      const hasFetchedAdvanced = fetchedContent !== state.savedContent
      const fetchedMatchesLastStreamedContent =
        state.lastStreamedContent !== null && fetchedContent === state.lastStreamedContent

      if (hasFetchedAdvanced || fetchedMatchesLastStreamedContent) {
        return finalizeTextEditorContentState(state, fetchedContent)
      }
    }

    return moveTextEditorContentStateToReconcile(state)
  }

  if (fetchedContent === undefined) {
    return state
  }

  if (state.phase === 'uninitialized') {
    return finalizeTextEditorContentState(state, fetchedContent)
  }

  if (fetchedContent === state.savedContent) {
    return state
  }

  if (state.content === state.savedContent) {
    return finalizeTextEditorContentState(state, fetchedContent)
  }

  return state
}

export function textEditorContentReducer(
  state: TextEditorContentState,
  action: TextEditorContentAction
): TextEditorContentState {
  switch (action.type) {
    case 'sync-external':
      return syncTextEditorContentState(state, action)
    case 'edit':
      if (state.phase !== 'ready' || action.content === state.content) {
        return state
      }
      return {
        ...state,
        content: action.content,
      }
    case 'save-success':
      // Advance only the saved baseline. Never roll `content` back to the saved snapshot: a
      // keystroke landing while the save was in flight makes `content` newer than `action.content`,
      // and overwriting it would silently drop that edit (and leave the doc looking clean so it's
      // never re-saved). Leaving `content` ahead keeps the doc dirty so the trailing edit autosaves.
      if (
        state.phase === 'ready' &&
        state.savedContent === action.content &&
        state.lastStreamedContent === null
      ) {
        return state
      }
      return {
        ...state,
        phase: 'ready',
        savedContent: action.content,
        lastStreamedContent: null,
        hasBaseline: true,
      }
    default:
      return state
  }
}
