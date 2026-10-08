/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestJson } = vi.hoisted(() => ({
  requestJson: vi.fn(async () => ({ chats: [] })),
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson }))

import { useDesktopActivity, watchesDesktopActivity } from '@/hooks/queries/desktop-activity'

function ActivityWatcher({ registered }: { registered: boolean }) {
  useDesktopActivity('ws-1', watchesDesktopActivity({ available: true, registered }))
  return null
}

let root: Root | undefined

async function mount(registered: boolean) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityWatcher registered={registered} />
      </QueryClientProvider>
    )
  })
}

/** Long enough for several idle polls. */
async function waitTwoMinutes() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
  })
}

describe('desktop activity polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    requestJson.mockClear()
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'simDesktop')
  })

  it('never asks for a user without a desktop in a browser tab', async () => {
    await mount(false)
    await waitTwoMinutes()

    expect(requestJson).not.toHaveBeenCalled()
  })

  it('polls for a user with a registered desktop', async () => {
    await mount(true)
    await waitTwoMinutes()

    expect(requestJson.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('polls in the desktop app before its first registration reaches the page', async () => {
    Object.defineProperty(window, 'simDesktop', { value: {}, configurable: true })
    await mount(false)
    await waitTwoMinutes()

    expect(requestJson.mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})
