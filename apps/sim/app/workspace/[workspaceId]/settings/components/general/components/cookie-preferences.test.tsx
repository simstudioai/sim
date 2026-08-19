/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseConsentManager, mockSaveConsents } = vi.hoisted(() => ({
  mockUseConsentManager: vi.fn(),
  mockSaveConsents: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@c15t/nextjs/headless', () => ({ useConsentManager: mockUseConsentManager }))
vi.mock('@/app/_shell/consent/consent-store-provider', () => ({
  ConsentStoreProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/app/_shell/consent/consent-preferences', () => ({
  CONSENT_LINK_CLASS: 'link',
  ConsentPreferences: ({ onChange }: { onChange?: () => void }) => (
    <button type='button' data-testid='toggle' onClick={onChange} />
  ),
}))

import { CookiePreferences } from '@/app/workspace/[workspaceId]/settings/components/general/components/cookie-preferences'

let root: Root | null = null

beforeEach(() => {
  mockUseConsentManager.mockReturnValue({
    saveConsents: mockSaveConsents.mockResolvedValue(undefined),
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('CookiePreferences', () => {
  it('commits on every toggle, matching the telemetry switch beside it', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<CookiePreferences />))

    expect(mockSaveConsents).not.toHaveBeenCalled()
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')?.click())

    // `saveConsents('custom')` reads `selectedConsents` from the store at call
    // time and the switch's `setSelectedConsent` write is synchronous, so the
    // value this toggle staged is the one committed.
    expect(mockSaveConsents).toHaveBeenCalledWith('custom', { uiSource: 'settings' })
  })
})
