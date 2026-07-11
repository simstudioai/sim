/**
 * @vitest-environment jsdom
 *
 * The post-stream reconcile must poll the content query until a fetch shows the server content
 * advanced past the pre-stream baseline — its exit is data-driven, and without the poll a single
 * refetch racing the agent's write (or an invalidation that never reaches this surface) wedged the
 * editor read-only until a window refocus or full reload. These drive the real
 * `useEditableFileContent` engine through stream → settle → advance and assert the
 * `refetchInterval` handed to the content query flips on and off with the `reconciling` phase.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryState } = vi.hoisted(() => ({
  queryState: {
    fetched: undefined as string | undefined,
    lastOptions: undefined as
      | { refetchInterval?: number | false | (() => number | false) }
      | undefined,
  },
}))

vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFileContent: (
    _workspaceId: string,
    _fileId: string,
    _key: string,
    _raw?: boolean,
    options?: { refetchInterval?: number | false | (() => number | false) }
  ) => {
    queryState.lastOptions = options
    return { data: queryState.fetched, isLoading: queryState.fetched === undefined, error: null }
  },
  useUpdateWorkspaceFileContent: () => ({ mutateAsync: vi.fn(async () => ({ success: true })) }),
}))

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  del: vi.fn(async () => {}),
}))

import {
  RECONCILING_REFETCH_INTERVAL_MS,
  RECONCILING_REFETCH_WINDOW_MS,
  useEditableFileContent,
} from './use-editable-file-content'

const FILE = {
  id: 'f1',
  key: 'workspace/ws-1/123-abc-doc.md',
  name: 'doc.md',
  type: 'text/markdown',
  folderId: null,
} as any

interface ProbeProps {
  streamingContent?: string
  isAgentEditing?: boolean
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let latest: ReturnType<typeof useEditableFileContent> | null = null

function Probe(props: ProbeProps) {
  latest = useEditableFileContent({
    file: FILE,
    workspaceId: 'ws-1',
    canEdit: true,
    streamingContent: props.streamingContent,
    isAgentEditing: props.isAgentEditing,
  })
  return null
}

function render(props: ProbeProps) {
  act(() => {
    root?.render(<Probe {...props} />)
  })
}

/** The interval value react-query would currently be using (resolving the function form). */
function currentInterval(): number | false {
  const raw = queryState.lastOptions?.refetchInterval
  return typeof raw === 'function' ? raw() : (raw ?? false)
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryState.fetched = undefined
  queryState.lastOptions = undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  latest = null
  vi.useRealTimers()
})

describe('reconcile refetch polling', () => {
  it('polls only while reconciling, and stops the moment the fetched content advances', () => {
    const BASELINE = '# Doc\n\nstart\n'
    const STREAMED = '# Doc\n\nstart\n\n![img](/api/files/view/wf_x)\n'

    // Mount mid-stream (fetch not resolved yet): no polling.
    render({ streamingContent: '', isAgentEditing: true })
    expect(currentInterval()).toBe(false)

    // Baseline fetch resolves during the stream; chunks arrive: still no polling.
    queryState.fetched = BASELINE
    render({ streamingContent: '# Doc\n\nstart\n\n![img](', isAgentEditing: true })
    render({ streamingContent: STREAMED, isAgentEditing: true })
    expect(currentInterval()).toBe(false)
    expect(latest?.isStreamInteractionLocked).toBe(true)

    // Stream settles but the cached fetch still shows the pre-stream baseline: reconciling → poll.
    render({ streamingContent: undefined, isAgentEditing: false })
    expect(latest?.isStreamInteractionLocked).toBe(true)
    expect(currentInterval()).toBe(RECONCILING_REFETCH_INTERVAL_MS)

    // A poll returns the advanced server content: finalize, unlock, polling off.
    queryState.fetched = STREAMED
    render({ streamingContent: undefined, isAgentEditing: false })
    expect(latest?.isStreamInteractionLocked).toBe(false)
    expect(latest?.content).toBe(STREAMED)
    expect(currentInterval()).toBe(false)
  })

  it('stops polling after the bounded window even if the write never lands', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const BASELINE = '# Doc\n\nstart\n'

    render({ streamingContent: '', isAgentEditing: true })
    queryState.fetched = BASELINE
    render({ streamingContent: `${BASELINE}\nmore`, isAgentEditing: true })
    render({ streamingContent: undefined, isAgentEditing: false })
    expect(currentInterval()).toBe(RECONCILING_REFETCH_INTERVAL_MS)

    vi.setSystemTime(1_000_000 + RECONCILING_REFETCH_WINDOW_MS - 1)
    expect(currentInterval()).toBe(RECONCILING_REFETCH_INTERVAL_MS)

    vi.setSystemTime(1_000_000 + RECONCILING_REFETCH_WINDOW_MS)
    expect(currentInterval()).toBe(false)
  })

  it('never polls during plain at-rest editing (no stream involved)', () => {
    queryState.fetched = '# Plain\n\ndoc\n'
    render({})
    expect(latest?.isStreamInteractionLocked).toBe(false)
    expect(currentInterval()).toBe(false)
    act(() => latest?.setDraftContent('# Plain\n\ndoc edited\n'))
    render({})
    expect(currentInterval()).toBe(false)
  })
})
