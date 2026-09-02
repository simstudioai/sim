/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, mockSyncTheme } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockSyncTheme: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/core/utils/theme', () => ({
  syncThemeToNextThemes: mockSyncTheme,
}))

import { type GeneralSettings, generalSettingsKeys } from '@/hooks/queries/current-user-data'
import { useGeneralSettings } from '@/hooks/queries/general-settings'

const HYDRATED_SETTINGS: GeneralSettings = {
  autoConnect: true,
  superUserModeEnabled: false,
  mothershipEnvironment: 'prod',
  theme: 'dark',
  telemetryEnabled: true,
  billingUsageNotificationsEnabled: true,
  errorNotificationsEnabled: true,
  snapToGridSize: 0,
  showActionBar: true,
  autoFocusOnClick: true,
  copilotAutoAllowedTools: [],
  timezone: null,
}

function Probe() {
  useGeneralSettings()
  return null
}

describe('useGeneralSettings', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
  })

  it('synchronizes the browser theme from server-hydrated settings without refetching', () => {
    queryClient.setQueryData(generalSettingsKeys.settings(), HYDRATED_SETTINGS)

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    })

    expect(mockSyncTheme).toHaveBeenCalledWith('dark')
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
