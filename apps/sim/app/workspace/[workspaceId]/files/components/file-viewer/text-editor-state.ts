export type TextEditorContentPhase = 'uninitialized' | 'ready' | 'streaming' | 'reconciling'

export interface TextEditorContentState {
  phase: TextEditorContentPhase
  content: string
  savedContent: string
  lastStreamedContent: string | null
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
}

function finalizeTextEditorContentState(
  state: TextEditorContentState,
  nextContent: string
): TextEditorContentState {
  if (
    state.phase === 'ready' &&
    state.content === nextContent &&
    state.savedContent === nextContent &&
    state.lastStreamedContent === null
  ) {
    return state
  }

  return {
    phase: 'ready',
    content: nextContent,
    savedContent: nextContent,
    lastStreamedContent: null,
  }
}

function moveTextEditorContentStateToStreaming(
  state: TextEditorContentState,
  nextContent: string
): TextEditorContentState {
  if (
    state.phase === 'streaming' &&
    state.content === nextContent &&
    state.lastStreamedContent === nextContent
  ) {
    return state
  }

  return {
    ...state,
    phase: 'streaming',
    content: nextContent,
    lastStreamedContent: nextContent,
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
    const hasFetchedAdvanced = fetchedContent !== undefined && fetchedContent !== state.savedContent

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

    return moveTextEditorContentStateToStreaming(state, nextContent)
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
      }
    default:
      return state
  }
}
