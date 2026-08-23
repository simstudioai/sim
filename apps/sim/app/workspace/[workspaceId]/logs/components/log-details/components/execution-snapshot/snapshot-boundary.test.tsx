/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  toast: { error: mockToastError },
}))

import { SnapshotBoundary } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/execution-snapshot/snapshot-boundary'

const LOAD_ERROR = new Error('snapshot chunk failed')

function ThrowingSnapshot() {
  throw LOAD_ERROR
}

describe('SnapshotBoundary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    act(() => {
      root = createRoot(container)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('contains a background pre-warm failure without notifying or closing', () => {
    const onLoadError = vi.fn()

    act(() => {
      root.render(
        <SnapshotBoundary isOpen={false} onLoadError={onLoadError}>
          <ThrowingSnapshot />
        </SnapshotBoundary>
      )
    })

    expect(container.childNodes).toHaveLength(0)
    expect(mockToastError).not.toHaveBeenCalled()
    expect(onLoadError).not.toHaveBeenCalled()
  })

  it('notifies and closes an explicitly opened snapshot after a load failure', () => {
    const onLoadError = vi.fn()

    act(() => {
      root.render(
        <SnapshotBoundary isOpen onLoadError={onLoadError}>
          <ThrowingSnapshot />
        </SnapshotBoundary>
      )
    })

    expect(container.childNodes).toHaveLength(0)
    expect(mockToastError).toHaveBeenCalledWith(
      'Could not load the workflow snapshot. Refresh and try again.'
    )
    expect(onLoadError).toHaveBeenCalledOnce()
  })
})
