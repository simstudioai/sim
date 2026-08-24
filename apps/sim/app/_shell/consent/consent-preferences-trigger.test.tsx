/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockOpenDialog } = vi.hoisted(() => ({ mockOpenDialog: vi.fn() }))

vi.mock('@c15t/nextjs/headless', () => ({
  useHeadlessConsentUI: () => ({ openDialog: mockOpenDialog }),
}))
vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  cn: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' '),
}))

import { ConsentPreferencesTrigger } from '@/app/_shell/consent/consent-preferences-trigger'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentPreferencesTrigger', () => {
  it('opens c15t preferences from an accessible button', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => root?.render(<ConsentPreferencesTrigger>Cookie settings</ConsentPreferencesTrigger>))
    const button = container.querySelector('button')
    act(() => button?.click())

    expect(button?.type).toBe('button')
    expect(button?.textContent).toBe('Cookie settings')
    expect(mockOpenDialog).toHaveBeenCalledTimes(1)
  })
})
