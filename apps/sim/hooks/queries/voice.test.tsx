/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { useVoiceSettings, voiceSettingsKeys } from '@/hooks/queries/voice'

/** Trees rendered by a test, torn down in afterEach so observers do not leak across tests. */
const mountedRoots: Root[] = []

function renderHookWithClient<T>(
  useHook: () => T,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
): { getResult: () => T } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  mountedRoots.push(root)
  let result: T | undefined

  function Probe() {
    result = useHook()
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await sleep(1)
    }
  })
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useVoiceSettings', () => {
  it('keys the query under the voiceSettings namespace', () => {
    expect(voiceSettingsKeys.settings()).toEqual(['voiceSettings', 'settings'])
  })

  it('reports availability from the server response', async () => {
    mockRequestJson.mockResolvedValue({ sttAvailable: true })

    const { getResult } = renderHookWithClient(() => useVoiceSettings())
    await flush()

    expect(getResult().data).toBe(true)
    expect(mockRequestJson).toHaveBeenCalledTimes(1)
  })

  /**
   * Consumers gate on a browser capability; a client that cannot stream audio
   * should never issue the request at all.
   */
  it('issues no request when disabled', async () => {
    mockRequestJson.mockResolvedValue({ sttAvailable: true })

    const { getResult } = renderHookWithClient(() => useVoiceSettings({ enabled: false }))
    await flush()

    expect(mockRequestJson).not.toHaveBeenCalled()
    expect(getResult().data).toBeUndefined()
  })

  /** A failed capability probe must read as unavailable, not throw. */
  it('leaves data undefined when the request fails', async () => {
    mockRequestJson.mockRejectedValue(new Error('offline'))

    const { getResult } = renderHookWithClient(() => useVoiceSettings())
    await flush()

    expect(getResult().data).toBeUndefined()
    expect(getResult().isError).toBe(true)
  })

  /**
   * The app's QueryClient sets `retryOnMount: false`, and an infinite staleTime
   * never goes stale, so without an explicit override a single transient
   * failure would cache the error for the life of the client and keep the mic
   * hidden until a full reload.
   */
  it('recovers on a later mount after a failed probe, under the app query defaults', async () => {
    const appDefaults = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: 30 * 1000 } },
    })

    mockRequestJson.mockRejectedValueOnce(new Error('offline'))
    renderHookWithClient(() => useVoiceSettings(), appDefaults)
    await flush()
    expect(mockRequestJson).toHaveBeenCalledTimes(1)

    mockRequestJson.mockResolvedValue({ sttAvailable: true })
    const second = renderHookWithClient(() => useVoiceSettings(), appDefaults)
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(second.getResult().data).toBe(true)
  })

  it('dedupes across simultaneous consumers', async () => {
    mockRequestJson.mockResolvedValue({ sttAvailable: true })

    renderHookWithClient(() => {
      useVoiceSettings()
      useVoiceSettings()
      return null
    })
    await flush()

    expect(mockRequestJson).toHaveBeenCalledTimes(1)
  })
})
