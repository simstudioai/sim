/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUseConsentManager,
  mockSaveConsents,
  mockSetSelectedConsent,
  mockActions,
  mockGuard,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockUseConsentManager: vi.fn(),
  mockSaveConsents: vi.fn(),
  mockSetSelectedConsent: vi.fn(),
  mockActions: vi.fn(),
  mockGuard: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  toast: { success: mockToastSuccess, error: vi.fn() },
}))

vi.mock('@c15t/nextjs/headless', () => ({ useConsentManager: mockUseConsentManager }))

vi.mock('@/app/_shell/consent/consent-store-provider', () => ({
  ConsentStoreProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/_shell/consent/consent-preferences', () => ({
  CONSENT_LINK_CLASS: 'link',
  ConsentPreferences: () => <span data-testid='preferences' />,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ actions, children }: { actions: unknown; children: ReactNode }) => {
    mockActions(actions)
    return <div>{children}</div>
  },
}))

vi.mock('@/components/settings/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: mockGuard,
}))

import { Privacy } from '@/app/workspace/[workspaceId]/settings/components/privacy/privacy'

let root: Root | null = null

function render() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Privacy />))
  return container
}

/** The Save action the shell was handed on the latest render. */
function actionById(id: string) {
  const actions = (mockActions.mock.calls.at(-1)?.[0] ?? []) as {
    id: string
    disabled?: boolean
    onSelect: () => void
  }[]
  return actions.find((action) => action.id === id)
}

beforeEach(() => {
  mockUseConsentManager.mockReturnValue({
    consents: { necessary: true, measurement: false, marketing: false },
    selectedConsents: { necessary: true, measurement: false, marketing: false },
    setSelectedConsent: mockSetSelectedConsent,
    saveConsents: mockSaveConsents,
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('Privacy settings', () => {
  it('disables Save and reports clean while the staged consents match the saved ones', () => {
    render()

    expect(actionById('save')?.disabled).toBe(true)
    expect(actionById('discard')).toBeUndefined()
    expect(mockGuard).toHaveBeenLastCalledWith({ isDirty: false })
  })

  it('enables Save and reports dirty once a category is staged differently', () => {
    mockUseConsentManager.mockReturnValue({
      consents: { necessary: true, measurement: false, marketing: false },
      selectedConsents: { necessary: true, measurement: true, marketing: false },
      setSelectedConsent: mockSetSelectedConsent,
      saveConsents: mockSaveConsents,
    })
    render()

    expect(actionById('save')?.disabled).toBe(false)
    expect(actionById('discard')).toBeDefined()
    expect(mockGuard).toHaveBeenLastCalledWith({ isDirty: true })
  })

  it('saves the staged selection as a custom choice', async () => {
    mockUseConsentManager.mockReturnValue({
      consents: { necessary: true, measurement: false, marketing: false },
      selectedConsents: { necessary: true, measurement: true, marketing: false },
      setSelectedConsent: mockSetSelectedConsent,
      saveConsents: mockSaveConsents.mockResolvedValue(undefined),
    })
    render()

    const save = actionById('save')
    // Awaited inside `act` so the save's own state updates settle here rather
    // than leaking a render into the next test.
    await act(async () => {
      await save?.onSelect()
    })

    expect(mockSaveConsents).toHaveBeenCalledWith('custom', { uiSource: 'settings' })
  })

  it('discards by replaying the saved value onto only the changed categories', () => {
    mockUseConsentManager.mockReturnValue({
      consents: { necessary: true, measurement: false, marketing: false },
      selectedConsents: { necessary: true, measurement: true, marketing: false },
      setSelectedConsent: mockSetSelectedConsent,
      saveConsents: mockSaveConsents,
    })
    render()

    const discard = actionById('discard')
    act(() => discard?.onSelect())

    expect(mockSetSelectedConsent).toHaveBeenCalledTimes(1)
    expect(mockSetSelectedConsent).toHaveBeenCalledWith('measurement', false)
  })
})
