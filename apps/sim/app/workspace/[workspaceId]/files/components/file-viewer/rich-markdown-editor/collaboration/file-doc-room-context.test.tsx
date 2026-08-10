/**
 * @vitest-environment jsdom
 *
 * The flush hand-off between the editor (which owns the realtime provider) and the file-detail
 * header (which acts on it). The header renders the provider, so it owns the ref rather than
 * reading it through context — these cover that the published flush is actually reachable from
 * there, and stays reachable.
 */
import { act, type ReactNode, useRef } from 'react'
import type { FlushFileDocResult } from '@sim/realtime-protocol/file-doc'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type FileDocFlush,
  FileDocRoomProvider,
  flushFileDocRef,
  useReportFileDocFlush,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-doc-room-context'

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const PERSISTED: FlushFileDocResult = { fileId: 'file-1', status: 'persisted', version: 1 }

/**
 * Mounts an owner that passes its own ref into the provider — the shape `files.tsx` uses — with a
 * publisher underneath standing in for the editor. `read()` is what the header's retype handler does.
 */
function renderOwner(initialFlush: FileDocFlush | null) {
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let read: (() => Promise<FlushFileDocResult>) | null = null

  function Publisher({ flush }: { flush: FileDocFlush | null }) {
    useReportFileDocFlush(flush)
    return null
  }

  function Owner({ flush, children }: { flush: FileDocFlush | null; children?: ReactNode }) {
    const flushRef = useRef<FileDocFlush | null>(null)
    read = () => flushFileDocRef(flushRef)
    return (
      <FileDocRoomProvider flushRef={flushRef}>
        <Publisher flush={flush} />
        {children}
      </FileDocRoomProvider>
    )
  }

  const render = (flush: FileDocFlush | null) => {
    act(() => {
      root.render(<Owner flush={flush} />)
    })
  }
  render(initialFlush)

  return {
    render,
    read: () => {
      if (!read) throw new Error('owner did not render')
      return read()
    },
    unmount: () => act(() => root.unmount()),
  }
}

describe('file-doc flush hand-off', () => {
  it('reaches the ancestor-owned ref, not just descendants', async () => {
    const flush = vi.fn(async () => PERSISTED)
    const owner = renderOwner(flush)

    await expect(owner.read()).resolves.toEqual(PERSISTED)
    expect(flush).toHaveBeenCalledTimes(1)
    owner.unmount()
  })

  it('resolves skipped when nothing collaborative is mounted', async () => {
    const owner = renderOwner(null)

    // The caller needs no null check: a non-collaborative file must cost nothing and never throw.
    await expect(owner.read()).resolves.toMatchObject({ status: 'skipped' })
    owner.unmount()
  })

  /**
   * The regression that motivated the stable-publish design. A flush bound to the provider's
   * identity republished on every socket churn, and a churn ending on `null` silently left the
   * header with nothing to call — degrading a retype back to reading pre-edit bytes.
   */
  it('survives publisher churn that ends on a live flush', async () => {
    const first = vi.fn(async () => PERSISTED)
    const second = vi.fn(async () => PERSISTED)
    const owner = renderOwner(first)

    owner.render(null)
    owner.render(second)

    await expect(owner.read()).resolves.toEqual(PERSISTED)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    owner.unmount()
  })

  it('goes quiet once the publisher reports no flush', async () => {
    const flush = vi.fn(async () => PERSISTED)
    const owner = renderOwner(flush)

    owner.render(null)

    await expect(owner.read()).resolves.toMatchObject({ status: 'skipped' })
    expect(flush).not.toHaveBeenCalled()
    owner.unmount()
  })

  it('stops resolving a torn-down publisher', async () => {
    const flush = vi.fn(async () => PERSISTED)
    const owner = renderOwner(flush)
    owner.unmount()

    // Nothing to assert against the ref after unmount, but the published function must not be
    // retained by a later mount — a fresh owner starts empty.
    const next = renderOwner(null)
    await expect(next.read()).resolves.toMatchObject({ status: 'skipped' })
    expect(flush).not.toHaveBeenCalled()
    next.unmount()
  })
})
