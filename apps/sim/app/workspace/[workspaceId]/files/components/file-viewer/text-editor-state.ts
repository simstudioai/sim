export type StreamingMode = 'append' | 'replace'

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
  streamingMode: StreamingMode
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

export function resolveStreamingEditorContent(
  fetchedContent: string | undefined,
  streamingContent: string,
  streamingMode: StreamingMode
): string {
  if (streamingMode === 'replace' || fetchedContent === undefined) {
    return streamingContent
  }

  if (
    fetchedContent.endsWith(streamingContent) ||
    fetchedContent.endsWith(`\n${streamingContent}`)
  ) {
    return fetchedContent
  }

  return `${fetchedContent}\n${streamingContent}`
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
  const { canReconcileToFetchedContent, fetchedContent, streamingContent, streamingMode } = options

  if (streamingContent !== undefined) {
    const nextContent = resolveStreamingEditorContent(
      fetchedContent,
      streamingContent,
      streamingMode
    )
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
      if (
        state.phase === 'ready' &&
        state.content === action.content &&
        state.savedContent === action.content &&
        state.lastStreamedContent === null
      ) {
        return state
      }
      return {
        ...state,
        phase: 'ready',
        content: action.content,
        savedContent: action.content,
        lastStreamedContent: null,
      }
    default:
      return state
  }
}
