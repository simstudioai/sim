/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

const requestJson = apiClientRequestMockFns.mockRequestJson

import { useDesktopActivity, watchesDesktopActivity } from '@/hooks/queries/desktop-activity'

interface ActivityWatcherProps {
  registered: boolean
}

/** What the page last saw from the hook. */
let shown: unknown

function ActivityWatcher({ registered }: ActivityWatcherProps) {
  shown = useDesktopActivity('ws-1', watchesDesktopActivity({ available: true, registered }))
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
    requestJson.mockReset()
    requestJson.mockResolvedValue({ chats: [] })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'simDesktop')
  })

  it('shows nothing once the page stops watching, though the query kept its last result', async () => {
    const activity = [{ chatId: 'chat-1' }]
    requestJson.mockResolvedValueOnce({ chats: activity })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const client = new QueryClient()
    const render = (registered: boolean) =>
      act(async () => {
        root?.render(
          <QueryClientProvider client={client}>
            <ActivityWatcher registered={registered} />
          </QueryClientProvider>
        )
      })

    await render(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(shown).toEqual(activity)

    await render(false)
    expect(shown).toBeUndefined()
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
