/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEventHandler, type ReactNode } from 'react'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }))

vi.mock('@sim/emcn', () => ({
  ...emcnMock,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  ChipCopyInput: ({ value }: { value?: string }) => (
    <input data-testid='license-key' readOnly value={value ?? ''} />
  ),
  ChipInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange?: ChangeEventHandler<HTMLInputElement>
    placeholder?: string
  }) => <input placeholder={placeholder} value={value ?? ''} onChange={onChange} />,
  ChipModalTabs: () => <div />,
  ChipSelect: () => <div />,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Skeleton: () => <div />,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: () => null,
}))

vi.mock('@/hooks/queries/mothership-admin', () => ({
  useGenerateLicense: () => ({ mutate: mockGenerate, isPending: false, error: null }),
  useMothershipLicenses: () => ({ data: undefined, isLoading: false }),
  useMothershipRequests: () => ({ data: undefined, isLoading: false }),
  useMothershipUserBreakdown: () => ({ data: undefined, isLoading: false }),
}))

import { Mothership } from '@/app/workspace/[workspaceId]/settings/components/mothership/mothership'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSettingsDirtyStore.getState().reset()
  mockGenerate.mockImplementation(
    (_input: unknown, options: { onSuccess: (result: { license_key: string }) => void }) =>
      options.onSuccess({ license_key: 'sim_license_once' })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <NuqsTestingAdapter searchParams='?tab=licenses'>
        <Mothership />
      </NuqsTestingAdapter>
    )
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function type(placeholder: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  expect(input).not.toBeNull()
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      value
    )
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function generateKey() {
  type('e.g. Acme Corp', 'Acme')
  type('Signed order form or written approval', 'order-1')
  const generate = Array.from(container.querySelectorAll('button')).find(
    (button) => !button.disabled
  )
  act(() => generate?.click())
}

function licenseKey() {
  return container.querySelector<HTMLInputElement>('[data-testid="license-key"]')?.value
}

describe('Mothership license generation', () => {
  it('asks before leaving while the shown-once license key is on screen', () => {
    generateKey()
    const leave = vi.fn()

    const left = useSettingsDirtyStore.getState().requestLeave(leave)

    expect(licenseKey()).toBe('sim_license_once')
    expect(left).toBe(false)
    expect(leave).not.toHaveBeenCalled()
  })

  it('drops the license key when the admin confirms leaving', () => {
    generateKey()
    const leave = vi.fn()
    useSettingsDirtyStore.getState().requestLeave(leave)

    act(() => useSettingsDirtyStore.getState().confirmLeave())

    expect(leave).toHaveBeenCalledOnce()
    expect(licenseKey()).toBeUndefined()
    expect(useSettingsDirtyStore.getState().isDirty).toBe(false)
  })
})
