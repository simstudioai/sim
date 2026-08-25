/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseConsentManager, mockSaveConsents, mockToastError, mockRevert, lastProps } =
  vi.hoisted(() => ({
    mockUseConsentManager: vi.fn(),
    mockSaveConsents: vi.fn(),
    mockToastError: vi.fn(),
    mockRevert: vi.fn(),
    lastProps: vi.fn(),
  }))

vi.mock('@sim/emcn', () => ({ toast: { success: vi.fn(), error: mockToastError } }))
vi.mock('@c15t/nextjs/headless', () => ({ useConsentManager: mockUseConsentManager }))
vi.mock('@/app/_shell/consent/consent-preferences', () => ({
  CONSENT_LINK_CLASS: 'link',
  ConsentPreferences: (props: {
    onChange?: (change: { name: string; revert: () => void }) => void
    disabled?: boolean
  }) => {
    lastProps(props)
    return (
      <button
        type='button'
        data-testid='toggle'
        disabled={props.disabled}
        onClick={() => props.onChange?.({ name: 'measurement', revert: mockRevert })}
      />
    )
  },
}))

import { CookiePreferences } from '@/app/workspace/[workspaceId]/settings/components/general/components/cookie-preferences'

let root: Root | null = null

/** The props the switch list was last rendered with. */
function props() {
  return lastProps.mock.calls.at(-1)?.[0] as { disabled?: boolean }
}

function render() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<CookiePreferences />))
  return container
}

/** Resolves the pending save on demand, so the in-flight state is observable. */
function deferredSave() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  mockSaveConsents.mockReturnValue(
    new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
  )
  return { resolve, reject }
}

beforeEach(() => {
  mockUseConsentManager.mockReturnValue({ saveConsents: mockSaveConsents })
  mockSaveConsents.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('CookiePreferences', () => {
  it('commits on every toggle, matching the telemetry switch beside it', async () => {
    const container = render()

    expect(mockSaveConsents).not.toHaveBeenCalled()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')?.click()
    })

    // `saveConsents('custom')` reads `selectedConsents` from the store at call
    // time and the switch's `setSelectedConsent` write is synchronous, so the
    // value this toggle staged is the one committed.
    expect(mockSaveConsents).toHaveBeenCalledWith('custom', { uiSource: 'settings' })
  })

  it('locks the switches while a commit is in flight, so two toggles cannot race', async () => {
    const pending = deferredSave()
    const container = render()

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')?.click()
    })
    expect(props().disabled).toBe(true)

    await act(async () => {
      pending.resolve()
    })
    expect(props().disabled).toBe(false)
  })

  it('puts the switch back when the commit fails', async () => {
    mockSaveConsents.mockRejectedValue(new Error('network down'))
    const container = render()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')?.click()
    })

    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalled()
    expect(props().disabled).toBe(false)
  })
})
