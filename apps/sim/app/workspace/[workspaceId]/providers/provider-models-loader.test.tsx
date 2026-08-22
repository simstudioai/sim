/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathname: '/workspace/workspace-1/tables',
  workspaceId: 'workspace-1' as string | undefined,
  searchOpen: false,
  useProviderModels: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  })),
  setProviderModels: vi.fn(),
  setProviderLoading: vi.fn(),
  setOpenRouterModelInfo: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: mocks.workspaceId }),
  usePathname: () => mocks.pathname,
}))

vi.mock('@/hooks/queries/providers', () => ({
  useProviderModels: mocks.useProviderModels,
}))

vi.mock('@/providers/utils', () => ({
  updateBasetenProviderModels: vi.fn(),
  updateFireworksProviderModels: vi.fn(),
  updateLiteLLMProviderModels: vi.fn(),
  updateOllamaCloudProviderModels: vi.fn(),
  updateOllamaProviderModels: vi.fn(),
  updateOpenRouterProviderModels: vi.fn(),
  updateTogetherProviderModels: vi.fn(),
  updateVLLMProviderModels: vi.fn(),
}))

vi.mock('@/stores/modals/search/store', () => ({
  useSearchModalStore: (selector: (state: { isOpen: boolean }) => unknown) =>
    selector({ isOpen: mocks.searchOpen }),
}))

vi.mock('@/stores/providers', () => ({
  useProvidersStore: (
    selector: (state: {
      setProviderModels: typeof mocks.setProviderModels
      setProviderLoading: typeof mocks.setProviderLoading
      setOpenRouterModelInfo: typeof mocks.setOpenRouterModelInfo
    }) => unknown
  ) =>
    selector({
      setProviderModels: mocks.setProviderModels,
      setProviderLoading: mocks.setProviderLoading,
      setOpenRouterModelInfo: mocks.setOpenRouterModelInfo,
    }),
}))

import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'

let root: Root

function renderLoader() {
  act(() => {
    root.render(<ProviderModelsLoader />)
  })
}

function expectEveryProviderEnabled(enabled: boolean) {
  expect(mocks.useProviderModels).toHaveBeenCalledTimes(9)
  for (const call of mocks.useProviderModels.mock.calls) {
    expect(call[2]).toEqual({ enabled })
  }
}

describe('ProviderModelsLoader request gating', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    root = createRoot(document.createElement('div'))
    mocks.pathname = '/workspace/workspace-1/tables'
    mocks.workspaceId = 'workspace-1'
    mocks.searchOpen = false
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
  })

  it.each(['tables', 'knowledge', 'files', 'logs', 'settings'])(
    'defers every provider catalog on the %s route',
    (route) => {
      mocks.pathname = `/workspace/workspace-1/${route}`
      renderLoader()

      expectEveryProviderEnabled(false)
    }
  )

  it.each(['home', 'w/workflow-1', 'chat/chat-1'])(
    'loads every provider catalog on the %s route',
    (route) => {
      mocks.pathname = `/workspace/workspace-1/${route}`
      renderLoader()

      expectEveryProviderEnabled(true)
    }
  )

  it('loads every provider catalog when global search opens on a resource route', () => {
    mocks.searchOpen = true
    renderLoader()

    expectEveryProviderEnabled(true)
  })

  it('does not create an empty-workspace route prefix', () => {
    mocks.workspaceId = undefined
    mocks.searchOpen = true
    renderLoader()

    expectEveryProviderEnabled(false)
  })
})
