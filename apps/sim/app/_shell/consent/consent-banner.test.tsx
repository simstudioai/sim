/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseConsentManager, mockUseHeadlessConsentUI } = vi.hoisted(() => ({
  mockUseConsentManager: vi.fn(),
  mockUseHeadlessConsentUI: vi.fn(),
}))

vi.mock('@c15t/nextjs/headless', () => ({
  useConsentManager: mockUseConsentManager,
  useHeadlessConsentUI: mockUseHeadlessConsentUI,
}))

vi.mock('@/app/_shell/consent/consent-preferences', () => ({
  CONSENT_LINK_CLASS: 'link',
  ConsentPreferences: () => <span data-testid='preferences' />,
}))

import { ConsentBanner } from '@/app/_shell/consent/consent-banner'

let root: Root | null = null

function render(): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConsentBanner />))
  return container
}

function isBannerShown(container: HTMLDivElement): boolean {
  return container.querySelector('section[aria-label="Cookie preferences"]') !== null
}

beforeEach(() => {
  mockUseHeadlessConsentUI.mockReturnValue({
    banner: { isVisible: true, allowedActions: ['accept', 'reject', 'customize'] },
    dialog: { isVisible: false, allowedActions: [] },
    openDialog: vi.fn(),
    performAction: vi.fn(),
    saveCustomPreferences: vi.fn(),
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentBanner', () => {
  it.each(['backend', 'backend-cache-hit', 'ssr'])(
    'asks for consent when the policy came from %s',
    (initDataSource) => {
      mockUseConsentManager.mockReturnValue({ initDataSource })

      expect(isBannerShown(render())).toBe(true)
    }
  )

  it('asks nothing when the policy lookup fell back', () => {
    // A bot challenge on the third-party `/init` makes the runtime substitute a
    // generic opt-in policy, which would otherwise re-prompt visitors who had
    // already consented under the real one.
    mockUseConsentManager.mockReturnValue({ initDataSource: 'offline-fallback' })

    expect(isBannerShown(render())).toBe(false)
  })
})
