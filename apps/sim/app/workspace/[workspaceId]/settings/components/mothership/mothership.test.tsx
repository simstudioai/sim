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
  Chip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
  ChipModalTabs: ({
    tabs,
    onChange,
  }: {
    tabs: Array<{ label: string; value: string }>
    onChange: (value: string) => void
  }) => (
    <div>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type='button'
          data-tab={tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  ChipSelect: ({
    options,
    onChange,
  }: {
    options: Array<{ label: string; value: string }>
    onChange: (value: string) => void
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          data-env={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
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
let urlSearch: string

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
  urlSearch = '?tab=licenses'
  act(() =>
    root.render(
      <NuqsTestingAdapter
        searchParams={urlSearch}
        onUrlUpdate={(event) => {
          urlSearch = event.queryString
        }}
      >
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
    (button) => !button.dataset.tab && !button.dataset.env && !button.disabled
  )
  act(() => generate?.click())
}

function licenseKey() {
  return container.querySelector<HTMLInputElement>('[data-testid="license-key"]')?.value
}

function switchToByok() {
  act(() => container.querySelector<HTMLButtonElement>('[data-tab="byok"]')?.click())
}

describe('Mothership license generation', () => {
  it('stays on the tab while the shown-once license key is on screen', () => {
    generateKey()

    switchToByok()

    expect(licenseKey()).toBe('sim_license_once')
    expect(urlSearch).not.toContain('byok')
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
  })

  it('drops the license key when the admin confirms switching environments', async () => {
    generateKey()
    act(() => container.querySelector<HTMLButtonElement>('[data-env="prod"]')?.click())

    await act(async () => useSettingsDirtyStore.getState().confirmLeave())

    await vi.waitFor(() => expect(urlSearch).toContain('env=prod'))
    expect(licenseKey()).toBeUndefined()
    expect(useSettingsDirtyStore.getState().isDirty).toBe(false)
  })
})
