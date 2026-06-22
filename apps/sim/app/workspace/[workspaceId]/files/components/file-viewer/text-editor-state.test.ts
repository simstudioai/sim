/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  INITIAL_TEXT_EDITOR_CONTENT_STATE,
  syncTextEditorContentState,
  type TextEditorContentState,
  textEditorContentReducer,
} from './text-editor-state'

function ready(content: string, savedContent = content): TextEditorContentState {
  return { phase: 'ready', content, savedContent, lastStreamedContent: null, hasBaseline: true }
}

function streaming(
  content: string,
  lastStreamedContent: string,
  savedContent = '',
  hasBaseline = true
): TextEditorContentState {
  return { phase: 'streaming', content, savedContent, lastStreamedContent, hasBaseline }
}

function reconciling(
  content: string,
  savedContent = '',
  hasBaseline = true
): TextEditorContentState {
  return { phase: 'reconciling', content, savedContent, lastStreamedContent: null, hasBaseline }
}

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

  it('does not revert a keystroke typed while the save was in flight', () => {
    const state = ready('ABC', 'old')
    const next = textEditorContentReducer(state, { type: 'save-success', content: 'AB' })
    expect(next.content).toBe('ABC')
    expect(next.savedContent).toBe('AB')
    expect(next.content === next.savedContent).toBe(false)
  })
})

describe('syncTextEditorContentState — initialization', () => {
  it('transitions from uninitialized to ready when fetchedContent arrives', () => {
    const next = syncTextEditorContentState(INITIAL_TEXT_EDITOR_CONTENT_STATE, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'loaded',
      streamingContent: undefined,
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
    })
    expect(next).toBe(state)
  })

  it('updates content when fetched advances and no local edits', () => {
    const state = ready('v1')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: undefined,
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
      hasBaseline: true,
    }
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: undefined,
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
    })
    expect(next.phase).toBe('streaming')
    expect(next.content).toBe('streamed chunk')
    expect(next.lastStreamedContent).toBe('streamed chunk')
  })

  it('returns same reference when streaming state is already current', () => {
    const state = streaming('addition', 'addition', 'base')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: 'base',
      streamingContent: 'addition',
    })
    expect(next).toBe(state)
  })

  it('finalizes to ready when fetched matches lastStreamedContent', () => {
    const state = streaming('base\nchunk', 'base\nchunk', '')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'base\nchunk',
      streamingContent: undefined,
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
    })
    expect(next.phase).toBe('reconciling')
  })

  it('finalizes immediately when streaming ends and canReconcile is false', () => {
    const state = streaming('streamed', 'streamed', '')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: undefined,
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
    })
    expect(next.phase).toBe('reconciling')
  })

  it('returns same reconciling reference when already reconciling', () => {
    const state = reconciling('x')
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: undefined,
      streamingContent: undefined,
    })
    expect(next).toBe(state)
  })

  it('finalizes when fetchedContent has advanced during reconciling', () => {
    const state: TextEditorContentState = {
      phase: 'reconciling',
      content: 'streamed',
      savedContent: 'v1',
      lastStreamedContent: null,
      hasBaseline: true,
    }
    const next = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: undefined,
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
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('v2')
  })
})

describe('syncTextEditorContentState — inter-session content shrink (replace mode)', () => {
  it('replaces long linger content with a short first chunk from a new session', () => {
    const lingerState = streaming(
      'a very long document with many paragraphs',
      'a very long document with many paragraphs',
      ''
    )
    const next = syncTextEditorContentState(lingerState, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: 'short',
    })
    expect(next.phase).toBe('streaming')
    expect(next.content).toBe('short')
    expect(next.lastStreamedContent).toBe('short')
  })

  it('correctly transitions to the new chunk even when it is a single character', () => {
    const lingerState = streaming(
      'full document\nmany lines\nof content',
      'full document\nmany lines\nof content',
      ''
    )
    const next = syncTextEditorContentState(lingerState, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: '#',
    })
    expect(next.phase).toBe('streaming')
    expect(next.content).toBe('#')
  })

  it('does not finalize early when the new short chunk happens to equal savedContent', () => {
    const lingerState = streaming('long content', 'long content', 'old saved')
    const next = syncTextEditorContentState(lingerState, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: '',
    })
    expect(next.phase).toBe('streaming')
    expect(next.content).toBe('')
  })

  it('stays streaming across multiple growing chunks after the shrink', () => {
    const lingerState = streaming('final long document', 'final long document', '')

    const chunk1 = syncTextEditorContentState(lingerState, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: '# New',
    })
    expect(chunk1.phase).toBe('streaming')
    expect(chunk1.content).toBe('# New')

    const chunk2 = syncTextEditorContentState(chunk1, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: '# New Section\n\nSome text',
    })
    expect(chunk2.phase).toBe('streaming')
    expect(chunk2.content).toBe('# New Section\n\nSome text')

    const chunk3 = syncTextEditorContentState(chunk2, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: '# New Section\n\nSome text that is now longer than the original',
    })
    expect(chunk3.phase).toBe('streaming')
    expect(chunk3.content).toBe('# New Section\n\nSome text that is now longer than the original')
  })

  it('synthetic file (canReconcile=false) finalizes with current content when streaming ends', () => {
    const finalChunk = streaming(
      '# Complete Document\n\nAll done.',
      '# Complete Document\n\nAll done.',
      ''
    )
    const next = syncTextEditorContentState(finalChunk, {
      canReconcileToFetchedContent: false,
      fetchedContent: undefined,
      streamingContent: undefined,
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('# Complete Document\n\nAll done.')
    expect(next.savedContent).toBe('# Complete Document\n\nAll done.')
    expect(next.lastStreamedContent).toBeNull()
  })
})

/**
 * The chat resource view (mothership) streams agent output into an existing, initially-empty file
 * (the agent's `create_file` writes an empty buffer, then `edit_content` persists the real content
 * server-side). The editor must never autosave during this handoff — a save would race the agent's
 * server write and could clobber it with empty/stale content. The engine guarantees this by staying
 * stream-locked (phase `streaming`/`reconciling`, where autosave is disabled) from the first chunk
 * until fetched content reconciles to the agent's saved write — at which point `content` and
 * `savedContent` both equal that write, so the now-enabled autosave sees a clean doc and never fires.
 */
describe('syncTextEditorContentState — mothership streamed-file lifecycle (replace mode)', () => {
  const isStreamLocked = (s: TextEditorContentState) =>
    s.phase === 'streaming' || s.phase === 'reconciling'

  it('stays locked through streaming + reconcile, then finalizes to the agent write with no empty save', () => {
    const opts = (fetchedContent: string | undefined, streamingContent: string | undefined) => ({
      canReconcileToFetchedContent: true,
      fetchedContent,
      streamingContent,
    })

    // 1. Empty file (create_file wrote an empty buffer); first streamed chunk arrives.
    let state = syncTextEditorContentState(
      INITIAL_TEXT_EDITOR_CONTENT_STATE,
      opts('', '# Story\n\nOnce')
    )
    expect(state.phase).toBe('streaming')
    expect(isStreamLocked(state)).toBe(true)

    // 2. More chunks stream in (replace mode → content tracks the latest snapshot).
    state = syncTextEditorContentState(state, opts('', '# Story\n\nOnce upon a time'))
    expect(state.content).toBe('# Story\n\nOnce upon a time')
    expect(isStreamLocked(state)).toBe(true)

    // 3. Stream completes (streamingContent cleared) but the agent's server write hasn't been
    //    refetched yet — must hold in reconciling (still locked, autosave still disabled).
    state = syncTextEditorContentState(state, opts('', undefined))
    expect(state.phase).toBe('reconciling')
    expect(isStreamLocked(state)).toBe(true)
    expect(state.savedContent).toBe('')

    // 4. The agent's `edit_content` write lands in the refetched content → finalize to ready with
    //    content === savedContent === the agent write. Never an empty savedContent.
    const agentWrite = '# Story\n\nOnce upon a time, the end.'
    state = syncTextEditorContentState(state, opts(agentWrite, undefined))
    expect(state.phase).toBe('ready')
    expect(isStreamLocked(state)).toBe(false)
    expect(state.content).toBe(agentWrite)
    expect(state.savedContent).toBe(agentWrite)
    expect(state.lastStreamedContent).toBeNull()

    // 5. Now-enabled autosave compares content vs savedContent: equal → it never fires a save.
    expect(state.content).toBe(state.savedContent)
  })
})

/**
 * When the user opens an existing, non-empty file's tab while the agent is already mid-stream on it,
 * streaming begins from `uninitialized` before the content fetch resolves — so `savedContent` is the
 * placeholder `''`. The first fetched value to arrive is the file's PRE-EDIT content, not the agent's
 * write; it must be adopted as the baseline, never finalized to (which would flash stale content and,
 * if the agent had stopped, let the user edit over the agent's write).
 */
describe('syncTextEditorContentState — stream begins before fetch on an existing file', () => {
  it('adopts the first fetched content as the baseline instead of finalizing to it mid-stream', () => {
    const preEdit = '# Original\n\nold content'
    const agentWrite = '# Original\n\nold content, plus a new section.'

    // 1. Editor mounts mid-stream: chunk arrives before the fetch resolves.
    let state = syncTextEditorContentState(INITIAL_TEXT_EDITOR_CONTENT_STATE, {
      canReconcileToFetchedContent: true,
      fetchedContent: undefined,
      streamingContent: '# Original\n\nold',
    })
    expect(state.phase).toBe('streaming')
    expect(state.savedContent).toBe('')
    expect(state.hasBaseline).toBe(false)

    // 2. The fetch resolves to the file's pre-edit content WHILE streaming. Adopt it as the baseline;
    //    do NOT finalize (the agent hasn't persisted its write yet).
    state = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: preEdit,
      streamingContent: '# Original\n\nold content, plus',
    })
    expect(state.phase).toBe('streaming')
    expect(state.content).toBe('# Original\n\nold content, plus')
    expect(state.savedContent).toBe(preEdit)
    expect(state.hasBaseline).toBe(true)

    // 3. Stream ends; the refetch is still the pre-edit content → hold in reconciling, never finalize
    //    to stale (savedContent === fetched, so it has not "advanced").
    state = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: preEdit,
      streamingContent: undefined,
    })
    expect(state.phase).toBe('reconciling')

    // 4. The agent's write lands (advanced past the adopted baseline) → finalize to it.
    state = syncTextEditorContentState(state, {
      canReconcileToFetchedContent: true,
      fetchedContent: agentWrite,
      streamingContent: undefined,
    })
    expect(state.phase).toBe('ready')
    expect(state.content).toBe(agentWrite)
    expect(state.savedContent).toBe(agentWrite)
  })

  it('still finalizes mid-stream once a real baseline is established (no regression)', () => {
    // With hasBaseline=true, an advancing fetch finalizes immediately — the established-baseline path.
    const next = syncTextEditorContentState(streaming('v1 chunk', 'v1 chunk', 'v1'), {
      canReconcileToFetchedContent: true,
      fetchedContent: 'v2',
      streamingContent: 'chunk',
    })
    expect(next.phase).toBe('ready')
    expect(next.content).toBe('v2')
  })
})
