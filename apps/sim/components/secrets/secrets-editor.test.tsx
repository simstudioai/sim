/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react'
import { ToastProvider } from '@sim/emcn'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretsEditor } from '@/components/secrets/secrets-editor'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

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
  it.each([
    { scope: 'workspace', kind: 'key', prefix: 'new_workspace_key_' },
    { scope: 'workspace', kind: 'value', prefix: 'new_workspace_value_' },
    { scope: 'personal', kind: 'key', prefix: 'env_variable_name_' },
    { scope: 'personal', kind: 'value', prefix: 'env_variable_value_' },
  ])('protects a partially entered $scope secret $kind', async ({ scope, kind, prefix }) => {
    await render(scope === 'personal' ? { personal: { variables: {}, save: mocks.save } } : {})
    const input = container.querySelector<HTMLInputElement>(`input[name^="${prefix}"]`)
    if (!input) throw new Error('Missing new secret input')
    await change(input, kind === 'key' ? 'DRAFT_KEY' : 'draft-value')
    let left = false
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        left = true
      })
    )
    expect(left).toBe(false)
    const save = button('Save')
    if (!save) throw new Error('Missing Save button')
    await act(async () => save.click())
    const retainedInput = container.querySelector<HTMLInputElement>(`input[name^="${prefix}"]`)
    if (!retainedInput) throw new Error('Missing retained secret draft')
    expect(retainedInput.value).toBe(kind === 'key' ? 'DRAFT_KEY' : 'draft-value')
    await change(retainedInput, '')
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        left = true
      })
    )
    expect(left).toBe(true)
  })

  it('keeps an edited personal secret and its navigation protection through a refresh', async () => {
    const personal = { variables: { TOKEN: { key: 'TOKEN', value: 'original' } }, save: mocks.save }
    await render({ personal })
    const input = container.querySelector<HTMLInputElement>('input[name^="env_variable_value_"]')
    if (!input) throw new Error('Missing personal secret input')
    await change(input, 'draft-value')
    await render({
      personal: {
        ...personal,
        variables: {
          TOKEN: { key: 'TOKEN', value: 'server-refresh' },
          REMOTE: { key: 'REMOTE', value: 'new' },
        },
      },
    })
    expect(
      container.querySelector<HTMLInputElement>('input[name^="env_variable_value_"]')?.value
    ).toBe('draft-value')
    let left = false
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        left = true
      })
    )
    expect(left).toBe(false)
    await act(async () => button('Save').click())
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({ TOKEN: 'draft-value', REMOTE: 'new' })
  })

  it('rebases later personal edits onto remotely added keys after a pending save', async () => {
    const request = createDeferred<void>()
    mocks.save.mockReturnValueOnce(request.promise)
    const personal = { variables: { TOKEN: { key: 'TOKEN', value: 'original' } }, save: mocks.save }
    await render({ personal })
    const selector = 'input[name^="env_variable_value_"]'
    const first = container.querySelector<HTMLInputElement>(selector)
    if (!first) throw new Error('Missing personal value')
    await change(first, 'submitted')
    await render({
      personal: {
        ...personal,
        variables: {
          TOKEN: { key: 'TOKEN', value: 'original' },
          REMOTE: { key: 'REMOTE', value: 'keep' },
        },
      },
    })
    act(() => button('Save').click())
    const pending = container.querySelector<HTMLInputElement>(selector)
    if (!pending) throw new Error('Missing pending personal value')
    await change(pending, 'later')
    await act(async () => request.resolve())
    expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe('later')
    await act(async () => button('Save').click())
    expect(mocks.save.mock.calls[1]?.[0]).toEqual({ TOKEN: 'later', REMOTE: 'keep' })
  })

  it('keeps an incomplete later row unique when a remotely added key is acknowledged', async () => {
    const request = createDeferred<void>()
    mocks.save.mockReturnValueOnce(request.promise)
    const personal = { variables: { TOKEN: { key: 'TOKEN', value: 'original' } }, save: mocks.save }
    await render({ personal })
    const value = container.querySelector<HTMLInputElement>('input[name^="env_variable_value_"]')
    if (!value) throw new Error('Missing personal value')
    await change(value, 'submitted')
    await render({
      personal: {
        ...personal,
        variables: {
          TOKEN: { key: 'TOKEN', value: 'original' },
          REMOTE: { key: 'REMOTE', value: 'keep' },
        },
      },
    })
    act(() => button('Save').click())
    const emptyKey = [
      ...container.querySelectorAll<HTMLInputElement>('input[name^="env_variable_name_"]'),
    ].find((field) => field.value === '')
    if (!emptyKey) throw new Error('Missing empty row')
    await change(emptyKey, 'REMOTE')
    await act(async () => request.resolve())
    const keys = [
      ...container.querySelectorAll<HTMLInputElement>('input[name^="env_variable_name_"]'),
    ].filter((field) => field.value === 'REMOTE')
    expect(keys).toHaveLength(1)
    const key = keys[0]
    if (!key) throw new Error('Missing retained incomplete key')
    const rowValue = container.querySelector<HTMLInputElement>(
      `input[name="${key.name.replace('env_variable_name_', 'env_variable_value_')}"]`
    )
    expect(rowValue?.value).toBe('')
  })

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
