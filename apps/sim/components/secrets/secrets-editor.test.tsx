/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react'
import { ToastProvider } from '@sim/emcn'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretsEditor } from '@/components/secrets/secrets-editor'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mocks.save.mockResolvedValue(undefined)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollTo = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function render(props: Partial<ComponentProps<typeof SecretsEditor>> = {}) {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <ToastProvider>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <SecretsEditor
                sectionLabel='Organization'
                variables={{}}
                canCreate
                save={mocks.save}
                isLoading={false}
                isSaving={false}
                {...props}
              />
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </ToastProvider>
      </NuqsTestingAdapter>
    )
  )
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((node) => node.textContent === label)!
function paste(input: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  input.dispatchEvent(event)
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('shared secrets editor', () => {
  it('uses the existing masked .env paste and save flow for organization secrets', async () => {
    await render()
    expect(container.textContent).toContain('Organization')
    expect(container.textContent).not.toContain('Personal')
    await act(async () =>
      paste(
        container.querySelector('input[data-input-type="key"]')!,
        'TOKEN=test-only-value\nSECOND=another-value'
      )
    )
    const value = container.querySelector<HTMLInputElement>('input[data-input-type="value"]')!
    expect(value.className).toContain('[-webkit-text-security:disc]')
    await act(async () => button('Save')!.click())
    expect(mocks.save).toHaveBeenCalledWith({
      upsert: { TOKEN: 'test-only-value', SECOND: 'another-value' },
      remove: [],
    })
  })
  it('keeps unsaved edits on query refresh and saves only changed keys', async () => {
    await render({ variables: { TOKEN: 'original', UNCHANGED: 'keep' } })
    await change(
      container.querySelector<HTMLInputElement>('input[name^="workspace_env_value_TOKEN"]')!,
      'edited'
    )
    await render({ variables: { TOKEN: 'server-refresh', UNCHANGED: 'keep' } })
    expect(
      container.querySelector<HTMLInputElement>('input[name^="workspace_env_value_TOKEN"]')!.value
    ).toBe('edited')
    await act(async () => button('Save')!.click())
    expect(mocks.save).toHaveBeenCalledWith({ upsert: { TOKEN: 'edited' }, remove: [] })
  })
})
