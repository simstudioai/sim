/**
 * @vitest-environment jsdom
 */
import { act, createRef, StrictMode, Suspense, startTransition, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useEditableFileContent } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-editable-file-content'

const mocks = vi.hoisted(() => ({
  query: { content: 'original' as string | undefined },
  save: vi.fn(),
  reload: vi.fn(),
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  deleteDraft: vi.fn(),
}))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFileContent: () => ({ data: mocks.query.content, isLoading: false, error: null }),
  useUpdateWorkspaceFileContent: () => ({ mutateAsync: mocks.save }),
  useReloadWorkspaceFileContent: () => ({ mutateAsync: mocks.reload, isPending: false }),
}))
vi.mock('idb-keyval', () => ({
  get: mocks.readDraft,
  set: mocks.writeDraft,
  del: mocks.deleteDraft,
}))

const V1 = '2026-09-03T20:00:00.000Z'
const V2 = '2026-09-03T20:00:01.000Z'
const V3 = '2026-09-03T20:00:02.000Z'
const FILE: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'notes.txt',
  type: 'text/plain',
  key: 'immutable-v1',
  path: '/file',
  size: 8,
  uploadedBy: 'user-1',
  uploadedAt: new Date(V1),
  updatedAt: new Date(V1),
  contentUpdatedAt: new Date(V1),
}
let latest: ReturnType<typeof useEditableFileContent>
let root: Root
let container: HTMLDivElement
let file = FILE
let streamingContent: string | undefined
let isAgentEditing = false
const discardRef = createRef<(() => void) | null>()

function Probe() {
  latest = useEditableFileContent({
    file,
    workspaceId: FILE.workspaceId,
    canEdit: true,
    discardRef,
    streamingContent,
    isAgentEditing,
  })
  return null
}
async function render() {
  await act(async () => root.render(<Probe />))
}
async function edit(content: string) {
  await act(async () => latest.setDraftContent(content))
}
async function advance(ms = 2000) {
  await act(async () => vi.advanceTimersByTimeAsync(ms))
}

interface TransitionProbeProps {
  streamingContent?: string
  isAgentEditing?: boolean
}

function TransitionProbe(options: TransitionProbeProps) {
  const state = useEditableFileContent({
    file,
    workspaceId: FILE.workspaceId,
    canEdit: true,
    discardRef,
    ...options,
  })
  useLayoutEffect(() => {
    latest = state
  })
  return <div>{state.content}</div>
}

/** Suspend after the hook finishes its render-phase reconciliation, without committing the tree. */
const pendingTransition = new Promise<void>(() => {})
function SuspendTransition(): never {
  throw pendingTransition
}

async function renderTransition(options: TransitionProbeProps = {}, suspend = false) {
  const view = (
    <Suspense fallback={<div>Loading</div>}>
      <TransitionProbe {...options} />
      {suspend && <SuspendTransition />}
    </Suspense>
  )
  await act(async () => {
    if (suspend) startTransition(() => root.render(view))
    else root.render(view)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  file = FILE
  streamingContent = undefined
  isAgentEditing = false
  mocks.query.content = 'original'
  mocks.readDraft.mockResolvedValue(undefined)
  mocks.writeDraft.mockResolvedValue(undefined)
  mocks.deleteDraft.mockResolvedValue(undefined)
  mocks.save.mockResolvedValue({ success: true, file: { ...FILE, contentUpdatedAt: new Date(V2) } })
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('versioned solo-file editing', () => {
  it('does not block a committed save when an abandoned render observes an agent stream', async () => {
    await renderTransition()
    await edit('committed local draft')
    const committed = latest
    await renderTransition(
      { streamingContent: 'abandoned agent frame', isAgentEditing: true },
      true
    )
    expect(container.textContent).toBe('committed local draft')
    expect(latest.hasConflict).toBe(false)
    await act(async () => committed.saveImmediately())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'committed local draft', expectedUpdatedAt: V1 })
    )
  })

  it('keeps the committed agent reload lock when a suspended render removes it', async () => {
    await renderTransition({ isAgentEditing: true })
    const committed = latest
    await renderTransition({}, true)
    expect(latest.isStreamInteractionLocked).toBe(true)
    await act(async () => {
      await expect(committed.reloadLatestContent()).rejects.toThrow('Wait for the agent edit')
    })
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('discards to the committed baseline after a suspended remote-baseline render', async () => {
    await renderTransition()
    await edit('local draft')
    const committedDiscard = discardRef.current
    file = { ...FILE, key: 'immutable-v2', contentUpdatedAt: new Date(V2) }
    mocks.query.content = 'abandoned remote baseline'
    await renderTransition({}, true)
    expect(container.textContent).toBe('local draft')
    file = FILE
    mocks.query.content = 'original'
    await act(async () => committedDiscard?.())
    expect(latest.content).toBe('original')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('exports the visible committed content rather than a suspended stream snapshot', async () => {
    const OriginalBlob = Blob
    const createBlob = vi.fn(class extends OriginalBlob {})
    const createObjectURL = vi.fn(() => 'blob:local-draft')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('Blob', createBlob)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    try {
      await renderTransition()
      const committed = latest
      await renderTransition({ streamingContent: 'abandoned agent frame' }, true)
      expect(container.textContent).toBe('original')
      act(() => committed.downloadDraft())
      expect(createBlob).toHaveBeenCalledWith(['original'], {
        type: 'text/plain;charset=utf-8',
      })
      expect(click).toHaveBeenCalledOnce()
      await advance(0)
    } finally {
      click.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('keeps a stream conflict and trailing draft when an earlier save finishes during the stream', async () => {
    const pending = Promise.withResolvers<{ success: boolean; file: WorkspaceFileRecord }>()
    mocks.save.mockReturnValueOnce(pending.promise)
    await render()
    await edit('first draft')
    let saving: Promise<void> | undefined
    act(() => {
      saving = latest.saveImmediately()
    })
    await edit('trailing draft')
    streamingContent = 'agent partial'
    await render()
    await act(async () => {
      pending.resolve({ success: true, file: { ...FILE, contentUpdatedAt: new Date(V2) } })
      await saving
    })
    expect(latest.content).toBe('trailing draft')
    expect(latest.hasConflict).toBe(true)
    expect(latest.isStreamInteractionLocked).toBe(true)
    await act(async () => root.unmount())
    root = createRoot(container)
    expect(mocks.writeDraft).toHaveBeenCalledWith(expect.any(String), {
      content: 'trailing draft',
      savedContent: 'first draft',
    })
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('persists a dirty draft on unmount when the agent lock arrives before the first stream chunk', async () => {
    await render()
    await edit('local not yet persisted')
    isAgentEditing = true
    await render()
    expect(latest.isStreamInteractionLocked).toBe(true)
    await act(async () => root.unmount())
    root = createRoot(container)
    expect(mocks.writeDraft).toHaveBeenCalledWith(expect.any(String), {
      content: 'local not yet persisted',
      savedContent: 'original',
    })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it.each(['original', 'older server'])(
    'recovers a draft through StrictMode effect replay (baseline=%s)',
    async (savedContent) => {
      mocks.readDraft.mockResolvedValue({ content: 'recovered local', savedContent })
      await act(async () =>
        root.render(
          <StrictMode>
            <Probe />
          </StrictMode>
        )
      )
      expect(latest.content).toBe('recovered local')
      expect(latest.hasConflict).toBe(savedContent !== 'original')
    }
  )

  it('preserves and persists a dirty local draft when an agent stream starts', async () => {
    await render()
    await edit('local unsaved')
    streamingContent = 'agent partial'
    await render()
    expect(latest.content).toBe('local unsaved')
    expect(latest.hasConflict).toBe(true)
    expect(latest.isStreamInteractionLocked).toBe(true)
    await advance()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.writeDraft).toHaveBeenCalledWith(expect.any(String), {
      content: 'local unsaved',
      savedContent: 'original',
    })
    await act(async () => {
      await expect(latest.reloadLatestContent()).rejects.toThrow('Wait for the agent edit')
    })
    expect(mocks.reload).not.toHaveBeenCalled()
    file = { ...FILE, key: 'immutable-v2', contentUpdatedAt: new Date(V2) }
    mocks.query.content = 'agent final'
    streamingContent = undefined
    await render()
    expect(latest.content).toBe('local unsaved')
    expect(latest.hasConflict).toBe(true)
    expect(latest.isStreamInteractionLocked).toBe(false)
    mocks.reload.mockResolvedValueOnce({ content: 'agent final', file })
    await act(async () => latest.reloadLatestContent())
    expect(latest.content).toBe('agent final')
    expect(latest.hasConflict).toBe(false)
  })

  it('sends the original content version even when metadata advances before bytes arrive', async () => {
    await render()
    await edit('local')
    file = { ...FILE, key: 'immutable-v2', contentUpdatedAt: new Date(V2) }
    mocks.query.content = undefined
    await render()
    await act(async () => latest.saveImmediately())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'local', expectedUpdatedAt: V1 })
    )
  })

  it('retains both versions and pauses saves when dirty content receives a remote update', async () => {
    await render()
    await edit('local')
    file = { ...FILE, key: 'immutable-v2', contentUpdatedAt: new Date(V2) }
    mocks.query.content = 'remote'
    await render()
    expect(latest.content).toBe('local')
    expect(latest.hasConflict).toBe(true)
    expect(latest.isDirty).toBe(true)
    expect(latest.saveStatus).toBe('error')
    await edit('local continuing')
    await advance()
    await act(async () => latest.saveImmediately())
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.writeDraft).toHaveBeenCalledWith(expect.any(String), {
      content: 'local continuing',
      savedContent: 'original',
    })
  })

  it('does not retry a rejected CAS on typing, manual save, or unmount', async () => {
    mocks.save.mockRejectedValue(
      new ApiClientError({ status: 409, message: 'File changed', body: {} })
    )
    await render()
    await edit('local')
    await act(async () => latest.saveImmediately())
    expect(latest.hasConflict).toBe(true)
    await edit('local newer')
    await advance(5000)
    await act(async () => latest.saveImmediately())
    await act(async () => root.unmount())
    root = createRoot(container)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.writeDraft).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ content: 'local newer' })
    )
  })

  it('keeps an unversioned remote conflict paused after an in-flight save succeeds', async () => {
    const pending = Promise.withResolvers<{ success: boolean; file: WorkspaceFileRecord }>()
    mocks.save.mockReturnValueOnce(pending.promise)
    await render()
    await edit('local saved')
    let saving: Promise<void> | undefined
    act(() => {
      saving = latest.saveImmediately()
    })
    await edit('local trailing')
    file = { ...FILE, key: 'unknown-version', contentUpdatedAt: null }
    mocks.query.content = 'remote'
    await render()
    expect(latest.hasConflict).toBe(true)
    await act(async () => {
      pending.resolve({ success: true, file: { ...FILE, contentUpdatedAt: new Date(V2) } })
      await saving
    })
    expect(latest.hasConflict).toBe(true)
    expect(latest.content).toBe('local trailing')
    await advance()
    await act(async () => latest.saveImmediately())
    expect(mocks.save).toHaveBeenCalledTimes(1)
    file = { ...FILE, key: 'immutable-v3', contentUpdatedAt: new Date(V3) }
    mocks.reload.mockResolvedValueOnce({ content: 'latest remote', file })
    await act(async () => latest.reloadLatestContent())
    expect(latest.hasConflict).toBe(false)
    await edit('resolved')
    await act(async () => latest.saveImmediately())
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: V3 }))
  })

  it('uses the successful response token for trailing edits before the file-list refetch', async () => {
    const pending = Promise.withResolvers<{ success: boolean; file: WorkspaceFileRecord }>()
    mocks.save.mockReturnValueOnce(pending.promise)
    await render()
    await edit('first')
    let saving: Promise<void> | undefined
    act(() => {
      saving = latest.saveImmediately()
    })
    await edit('second')
    await act(async () => {
      pending.resolve({ success: true, file: { ...FILE, contentUpdatedAt: new Date(V2) } })
      await saving
    })
    await advance(700)
    expect(mocks.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ content: 'second', expectedUpdatedAt: V2 })
    )
    expect(latest.content).toBe('second')
  })

  it('keeps a recovered local draft when its former baseline differs from the server', async () => {
    mocks.readDraft.mockResolvedValue({ content: 'recovered local', savedContent: 'older server' })
    await render()
    expect(latest.content).toBe('recovered local')
    expect(latest.hasConflict).toBe(true)
    await advance()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.deleteDraft).not.toHaveBeenCalled()
  })

  it('preserves the draft on reload failure, then accepts explicitly reloaded bytes and their token', async () => {
    await render()
    await edit('local')
    file = { ...FILE, key: 'immutable-v2', contentUpdatedAt: new Date(V2) }
    mocks.query.content = 'remote'
    await render()
    mocks.reload.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await expect(latest.reloadLatestContent()).rejects.toThrow('offline')
    })
    expect(latest.content).toBe('local')
    expect(latest.hasConflict).toBe(true)
    mocks.reload.mockResolvedValueOnce({
      content: 'latest remote',
      file: { ...FILE, key: 'immutable-v3', contentUpdatedAt: new Date(V3) },
    })
    await act(async () => latest.reloadLatestContent())
    expect(latest.content).toBe('latest remote')
    expect(latest.hasConflict).toBe(false)
    expect(latest.isDirty).toBe(false)
    expect(latest.acceptedBaselineContent).toBe('latest remote')
    await edit('resolved')
    await act(async () => latest.saveImmediately())
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: V3 }))
  })

  it('does not undo a deliberate reload when an older save acknowledgement arrives afterward', async () => {
    const pending = Promise.withResolvers<{ success: boolean; file: WorkspaceFileRecord }>()
    mocks.save.mockReturnValueOnce(pending.promise)
    await render()
    await edit('local saved')
    let saving: Promise<void> | undefined
    act(() => {
      saving = latest.saveImmediately()
    })
    file = { ...FILE, key: 'immutable-v3', contentUpdatedAt: new Date(V3) }
    mocks.query.content = 'latest remote'
    await render()
    expect(latest.hasConflict).toBe(true)
    mocks.reload.mockResolvedValueOnce({ content: 'latest remote', file })
    await act(async () => latest.reloadLatestContent())
    await act(async () => {
      pending.resolve({ success: true, file: { ...FILE, contentUpdatedAt: new Date(V2) } })
      await saving
    })
    await advance(5000)
    expect(latest.content).toBe('latest remote')
    expect(latest.isDirty).toBe(false)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    await edit('resolved')
    await act(async () => latest.saveImmediately())
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: V3 }))
  })

  it('preserves edits made while a conflict reload is pending', async () => {
    await render()
    await edit('local')
    file = { ...FILE, key: 'immutable-v2', contentUpdatedAt: new Date(V2) }
    mocks.query.content = 'remote'
    await render()
    const pending = Promise.withResolvers<{ content: string; file: WorkspaceFileRecord }>()
    mocks.reload.mockReturnValueOnce(pending.promise)
    let reloading: Promise<void> | undefined
    act(() => {
      reloading = latest.reloadLatestContent()
    })
    await edit('local newer')
    await act(async () => {
      pending.resolve({ content: 'remote', file })
      await expect(reloading).rejects.toThrow('Your draft changed')
    })
    expect(latest.content).toBe('local newer')
    expect(latest.hasConflict).toBe(true)
  })

  it('does not re-enter conflict when a rejected older save arrives after explicit reload', async () => {
    const pending = Promise.withResolvers<{ success: boolean; file: WorkspaceFileRecord }>()
    mocks.save.mockReturnValueOnce(pending.promise)
    await render()
    await edit('local')
    let saving: Promise<void> | undefined
    act(() => {
      saving = latest.saveImmediately()
    })
    file = { ...FILE, key: 'immutable-v3', contentUpdatedAt: new Date(V3) }
    mocks.query.content = 'latest remote'
    await render()
    mocks.reload.mockResolvedValueOnce({ content: 'latest remote', file })
    await act(async () => latest.reloadLatestContent())
    await act(async () => {
      pending.reject(new ApiClientError({ status: 409, message: 'File changed', body: {} }))
      await saving
    })
    expect(latest.content).toBe('latest remote')
    expect(latest.hasConflict).toBe(false)
    expect(latest.isDirty).toBe(false)
    await edit('resolved')
    await act(async () => latest.saveImmediately())
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: V3 }))
  })
})
