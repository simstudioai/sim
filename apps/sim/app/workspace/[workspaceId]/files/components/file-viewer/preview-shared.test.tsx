/**
 * @vitest-environment jsdom
 *
 * `PreviewErrorBoundary` must contain a *rejected dynamic import* — the failure mode
 * introduced by lazy-loading the PDF and PowerPoint renderers. Without it a chunk-load
 * failure unwinds to the route-level `error.tsx` and blanks the whole Files page, the
 * Home resource panel and the public share page, all of which statically import the viewer.
 *
 * It must also recover in place: the boundary's error state only ever cleared via remount,
 * so a tripped boundary stayed on the fallback until the user navigated to another file
 * and back.
 */
import { act, lazy, Suspense } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PreviewError,
  PreviewErrorBoundary,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  vi.restoreAllMocks()
})

async function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(node)
  })
}

function actionLabels(): string[] {
  return Array.from(container?.querySelectorAll('button') ?? []).map((b) => b.textContent ?? '')
}

async function clickAction(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (b) => b.textContent === label
  )
  if (!button)
    throw new Error(`No "${label}" action rendered (found: ${actionLabels().join(', ')})`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('PreviewErrorBoundary', () => {
  it('renders the preview fallback when a lazy chunk fails to load', async () => {
    const Broken = lazy(() => Promise.reject(new Error('Loading chunk 4821 failed')))

    await render(
      <PreviewErrorBoundary label='PowerPoint'>
        <Suspense fallback={<span>loading</span>}>
          <Broken />
        </Suspense>
      </PreviewErrorBoundary>
    )

    expect(container?.textContent).toContain('Failed to preview PowerPoint')
    expect(container?.textContent).toContain('Loading chunk 4821 failed')
  })

  it('offers a page reload — not a retry — for a cached chunk rejection', async () => {
    const Broken = lazy(() => Promise.reject(new Error('Loading chunk 4821 failed')))

    await render(
      <PreviewErrorBoundary label='PowerPoint'>
        <Suspense fallback={<span>loading</span>}>
          <Broken />
        </Suspense>
      </PreviewErrorBoundary>
    )

    expect(actionLabels()).toEqual(['Reload page'])
  })

  it('offers a page reload for a failed CSS chunk, whose message omits "Loading chunk"', async () => {
    const Broken = lazy(() => Promise.reject(new Error('Loading CSS chunk 4821 failed')))

    await render(
      <PreviewErrorBoundary label='PowerPoint'>
        <Suspense fallback={<span>loading</span>}>
          <Broken />
        </Suspense>
      </PreviewErrorBoundary>
    )

    expect(actionLabels()).toEqual(['Reload page'])
  })

  it('renders children when nothing throws', async () => {
    await render(
      <PreviewErrorBoundary label='PowerPoint'>
        <span>preview</span>
      </PreviewErrorBoundary>
    )

    expect(container?.textContent).toBe('preview')
  })

  it('recovers in place when the retried render succeeds', async () => {
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('transient render failure')
      return <span>preview</span>
    }

    await render(
      <PreviewErrorBoundary label='PDF'>
        <Flaky />
      </PreviewErrorBoundary>
    )
    expect(container?.textContent).toContain('transient render failure')

    shouldThrow = false
    await clickAction('Try again')

    expect(container?.textContent).toBe('preview')
  })

  it('settles back on the fallback — never loops — when the retried render throws again', async () => {
    const renderSpy = vi.fn()
    function AlwaysThrows(): never {
      renderSpy()
      throw new Error('still broken')
    }

    await render(
      <PreviewErrorBoundary label='PDF'>
        <AlwaysThrows />
      </PreviewErrorBoundary>
    )
    const attemptsBeforeRetry = renderSpy.mock.calls.length

    await clickAction('Try again')
    const attemptsAfterRetry = renderSpy.mock.calls.length

    expect(attemptsAfterRetry).toBeGreaterThan(attemptsBeforeRetry)

    await act(async () => {
      await sleep(1)
    })

    expect(renderSpy.mock.calls.length).toBe(attemptsAfterRetry)
    expect(container?.textContent).toContain('Failed to preview PDF')
    expect(container?.textContent).toContain('still broken')
    expect(actionLabels()).toEqual(['Try again'])
  })
})

describe('PreviewError', () => {
  it('renders no action when none is supplied', async () => {
    await render(<PreviewError label='CSV' error='Request failed' />)

    expect(container?.textContent).toContain('Failed to preview CSV')
    expect(container?.querySelectorAll('button')).toHaveLength(0)
  })
})
