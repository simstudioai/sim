/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  INITIAL_TEXT_EDITOR_CONTENT_STATE,
  resolveStreamingEditorContent,
  syncTextEditorContentState,
  type TextEditorContentState,
  textEditorContentReducer,
} from './text-editor-state'

function ready(content: string, savedContent = content): TextEditorContentState {
  return { phase: 'ready', content, savedContent, lastStreamedContent: null }
}

function streaming(
  content: string,
  lastStreamedContent: string,
  savedContent = ''
): TextEditorContentState {
  return { phase: 'streaming', content, savedContent, lastStreamedContent }
}

function reconciling(content: string, savedContent = ''): TextEditorContentState {
  return { phase: 'reconciling', content, savedContent, lastStreamedContent: null }
}

describe('resolveStreamingEditorContent', () => {
  it('returns streamingContent when mode is replace', () => {
    expect(resolveStreamingEditorContent('existing', 'new chunk', 'replace')).toBe('new chunk')
  })

  it('returns streamingContent when fetchedContent is undefined', () => {
    expect(resolveStreamingEditorContent(undefined, 'chunk', 'append')).toBe('chunk')
  })

  it('returns fetchedContent when it already ends with streamingContent', () => {
    expect(resolveStreamingEditorContent('base\nchunk', 'chunk', 'append')).toBe('base\nchunk')
  })

  it('returns fetchedContent when it ends with newline + streamingContent', () => {
    expect(resolveStreamingEditorContent('base\nchunk', 'chunk', 'append')).toBe('base\nchunk')
  })

  it('appends with newline separator when fetched does not end with chunk', () => {
    expect(resolveStreamingEditorContent('base', 'new stuff', 'append')).toBe('base\nnew stuff')
  })

  it('handles empty streamingContent in append mode', () => {
    expect(resolveStreamingEditorContent('base', '', 'append')).toBe('base')
  })

  it('handles empty fetchedContent in append mode (prepends newline separator)', () => {
    expect(resolveStreamingEditorContent('', 'chunk', 'append')).toBe('\nchunk')
  })
})

describe("reducer 'edit' action", () => {
  it('updates content when phase is ready and content differs', () => {
    const state = ready('old')
    const next = textEditorContentReducer(state, { type: 'edit', content: 'new' })
    expect(next.content).toBe('new')
    expect(next.savedContent).toBe('old')
    expect(next.phase).toBe('ready')
  })

  it('returns same reference when content is unchanged', () => {
    const state = ready('same')
    const next = textEditorContentReducer(state, { type: 'edit', content: 'same' })
    expect(next).toBe(state)
  })

  it('ignores edit when phase is streaming', () => {
    const state = streaming('streamed', 'streamed')
    const next = textEditorContentReducer(state, { type: 'edit', content: 'edited' })
    expect(next).toBe(state)
  })

  it('ignores edit when phase is reconciling', () => {
    const state = reconciling('current')
    const next = textEditorContentReducer(state, { type: 'edit', content: 'edited' })
    expect(next).toBe(state)
  })

  it('ignores edit when phase is uninitialized', () => {
    const next = textEditorContentReducer(INITIAL_TEXT_EDITOR_CONTENT_STATE, {
      type: 'edit',
      content: 'anything',
    })
    expect(next).toBe(INITIAL_TEXT_EDITOR_CONTENT_STATE)
  })
})

describe("reducer 'save-success' action", () => {
  it('marks content as saved', () => {
    const state = ready('new content', 'old saved')
    const next = textEditorContentReducer(state, { type: 'save-success', content: 'new content' })
    expect(next.savedContent).toBe('new content')
    expect(next.content).toBe('new content')
    expect(next.phase).toBe('ready')
    expect(next.lastStreamedContent).toBeNull()
  })

  it('returns same reference when already clean', () => {
    const state = ready('x')
    const next = textEditorContentReducer(state, { type: 'save-success', content: 'x' })
    expect(next).toBe(state)
  })

  it('clears lastStreamedContent after save', () => {
    const state = streaming('content', 'content')
    const next = textEditorContentReducer(state, { type: 'save-success', content: 'content' })
    expect(next.lastStreamedContent).toBeNull()
    expect(next.phase).toBe('ready')
  })
})

describe('syncTextEditorContentState — initialization', () => {
  it('transitions from uninitialized to ready when fetchedContent arrives', () => {
    const next = syncTextEditorContentState(INITIAL_TEXT_EDITOR_CONTENT_STATE, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'loaded',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('loaded')
    expect(next.savedContent).toBe('loaded')
  })

  it('stays uninitialized when fetchedContent is undefined', () => {
    const next = syncTextEditorContentState(INITIAL_TEXT_EDITOR_CONTENT_STATE, {
      canReconcileToFetchedContent: true,
      fetchedContent: undefined,
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next).toBe(INITIAL_TEXT_EDITOR_CONTENT_STATE)
  })
})

describe('syncTextEditorContentState — static fetch updates', () => {
  it('does not update content if fetchedContent matches savedContent', () => {
    const state = ready('v1')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v1',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next).toBe(state)
  })

  it('updates content when fetched advances and no local edits', () => {
    const state = ready('v1')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.content).toBe('v2')
    expect(next.savedContent).toBe('v2')
  })

  it('preserves local edits when fetchedContent advances but user has changes', () => {
    // User edited to 'user edit', but savedContent was 'v1' and fetched is 'v2'
    const state: TextEditorContentState = {
      phase: 'ready',
      content: 'user edit',
      savedContent: 'v1',
      lastStreamedContent: null,
    }
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    // Local edits take precedence — content should remain 'user edit'
    expect(next.content).toBe('user edit')
    expect(next.phase).toBe('ready')
  })
})

describe('syncTextEditorContentState — streaming', () => {
  it('enters streaming phase when streamingContent arrives (replace mode)', () => {
    const state = ready('existing')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: 'existing',
      streamingContent: 'streamed chunk',
      streamingMode: 'replace',
    })
    expect(next.phase).toBe('streaming')
    expect(next.content).toBe('streamed chunk')
    expect(next.lastStreamedContent).toBe('streamed chunk')
  })

  it('appends streaming content to fetched in append mode', () => {
    const next = syncTextEditorContentState(INITIAL_TEXT_EDITOR_CONTENT_STATE, {
      canReconcileToFetchedContent: false,
      fetchedContent: 'base',
      streamingContent: 'addition',
      streamingMode: 'append',
    })
    expect(next.phase).toBe('streaming')
    expect(next.content).toBe('base\naddition')
  })

  it('returns same reference when streaming state is already current', () => {
    const state = streaming('base\naddition', 'base\naddition', 'base')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: 'base',
      streamingContent: 'addition',
      streamingMode: 'append',
    })
    expect(next).toBe(state)
  })

  it('finalizes to ready when fetched matches lastStreamedContent', () => {
    const state = streaming('base\nchunk', 'base\nchunk', '')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'base\nchunk',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('base\nchunk')
    expect(next.savedContent).toBe('base\nchunk')
    expect(next.lastStreamedContent).toBeNull()
  })

  it('moves to reconciling when streaming ends but fetched has not caught up', () => {
    const state = streaming('streamed', 'streamed', '')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: undefined,
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('reconciling')
  })

  it('finalizes immediately when streaming ends and canReconcile is false', () => {
    const state = streaming('streamed', 'streamed', '')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('streamed')
  })
})

describe('syncTextEditorContentState — reconciling', () => {
  it('stays reconciling when fetchedContent has not advanced', () => {
    const state = reconciling('streamed', '')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: '',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('reconciling')
  })

  it('returns same reconciling reference when already reconciling', () => {
    const state = reconciling('x')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: undefined,
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next).toBe(state)
  })

  it('finalizes when fetchedContent has advanced during reconciling', () => {
    const state: TextEditorContentState = {
      phase: 'reconciling',
      content: 'streamed',
      savedContent: 'v1',
      lastStreamedContent: null,
    }
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('v2')
  })

  it('finalizes immediately when canReconcile is false', () => {
    const state = reconciling('streamed')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: 'v99',
      streamingContent: undefined,
      streamingMode: 'append',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('streamed')
  })
})

describe('syncTextEditorContentState — streaming finalize shortcuts', () => {
  it('finalizes immediately when fetched already equals resolved streaming content', () => {
    // ready + user hasn't edited + fetched === what streaming would produce
    const state = ready('v1')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: 'v2',
      streamingContent: 'v2',
      streamingMode: 'replace',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('v2')
  })

  it('finalizes from streaming when fetched has advanced beyond saved', () => {
    const state = streaming('v1 chunk', 'v1 chunk', 'v1')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: 'chunk',
      streamingMode: 'append',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('v2')
  })
})
