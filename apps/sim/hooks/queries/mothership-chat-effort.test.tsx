/** @vitest-environment jsdom */

import { act, useEffect } from 'react'
import { jsonResponse } from '@sim/testing/helpers/http'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { ToastProvider } from '@sim/emcn'
import type { MothershipEffort } from '@/lib/mothership/model-options'
import { useSetMothershipChatEffort } from '@/hooks/queries/mothership-chats'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

const FAILURE_NOTICE = "Couldn't change reasoning effort"

interface EffortPickerProps {
  onReady: (pick: (effort: MothershipEffort) => Promise<void>) => void
}

function EffortPicker({ onReady }: EffortPickerProps) {
  const { mutateAsync } = useSetMothershipChatEffort('chat-1')
  useEffect(
    () => onReady((effort) => mutateAsync(effort).catch(() => undefined)),
    [onReady, mutateAsync]
  )
  return null
}

let root: Root
let pick: (effort: MothershipEffort) => Promise<void>

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('fetch', vi.fn())
  useMothershipEffortStore.getState().reset()
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <EffortPicker
            onReady={(next) => {
              pick = next
            }}
          />
        </ToastProvider>
      </QueryClientProvider>
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('chat effort save failures', () => {
  it('tells the user when a failed save rolls their pick back', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('save failed', { status: 500 }))

    await act(() => pick('xhigh'))

    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']).toBeUndefined()
    expect(document.body.textContent).toContain(FAILURE_NOTICE)
  })

  it('stays quiet when a newer pick already replaced the one that failed', async () => {
    const saves = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()]
    for (const save of saves) vi.mocked(fetch).mockReturnValueOnce(save.promise)

    let outcomes: Promise<void>[] = []
    await act(async () => {
      outcomes = [pick('low'), pick('high')]
      await sleep(1)
    })
    await act(async () => {
      saves[0].resolve(new Response('save failed', { status: 500 }))
      saves[1].resolve(jsonResponse({ success: true }))
      await Promise.all(outcomes)
    })

    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']?.effort).toBe('high')
    expect(document.body.textContent).not.toContain(FAILURE_NOTICE)
  })
})
