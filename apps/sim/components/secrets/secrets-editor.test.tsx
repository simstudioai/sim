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
  it.each(['existing value', 'remove new row'])(
    'preserves the surviving shared secret when a submitted duplicate changes: %s',
    async (changeKind) => {
      const request = createDeferred<void>()
      const persisted: Record<string, string> = { TOKEN: 'original' }
      let first = true
      await render({
        variables: { TOKEN: 'original' },
        save: async ({ upsert, remove }) => {
          if (first) {
            first = false
            await request.promise
          }
          for (const key of remove) delete persisted[key]
          Object.assign(persisted, upsert)
        },
      })
      const key = container.querySelector<HTMLInputElement>('input[name^="new_workspace_key_"]')
      const value = container.querySelector<HTMLInputElement>('input[name^="new_workspace_value_"]')
      const existing = container.querySelector<HTMLInputElement>(
        'input[name^="workspace_env_value_TOKEN"]'
      )
      if (!key || !value || !existing) throw new Error('Missing shared secret rows')
      await change(key, 'TOKEN')
      await change(value, 'submitted')
      act(() => button('Save').click())
      if (changeKind === 'existing value') await change(existing, 'later')
      else {
        await change(key, '')
        await change(value, '')
      }
      await act(async () => request.resolve())
      await act(async () => button('Save').click())
      expect(persisted).toEqual({ TOKEN: changeKind === 'existing value' ? 'later' : 'original' })
    }
  )

  it.each(['rename', 'value', 'delete'])(
    'rebases a new shared secret row changed during Save: %s',
    async (changeKind) => {
      const request = createDeferred<void>()
      const persisted: Record<string, string> = {}
      let first = true
      await render({
        save: async ({ upsert, remove }) => {
          if (first) {
            first = false
            await request.promise
          }
          for (const key of remove) delete persisted[key]
          Object.assign(persisted, upsert)
        },
      })
      const key = container.querySelector<HTMLInputElement>('input[name^="new_workspace_key_"]')
      const value = container.querySelector<HTMLInputElement>('input[name^="new_workspace_value_"]')
      if (!key || !value) throw new Error('Missing new shared secret row')
      await change(key, 'TOKEN')
      await change(value, 'submitted')
      act(() => button('Save').click())
      if (changeKind === 'rename') await change(key, 'RENAMED')
      else if (changeKind === 'value') await change(value, 'later')
      else {
        await change(key, '')
        await change(value, '')
      }
      await act(async () => request.resolve())
      const populated = [
        ...container.querySelectorAll<HTMLInputElement>('input[name*="value"]'),
      ].filter((field) => field.value)
      expect(populated).toHaveLength(changeKind === 'delete' ? 0 : 1)
      await act(async () => button('Save').click())
      expect(persisted).toEqual(
        changeKind === 'delete'
          ? {}
          : changeKind === 'rename'
            ? { RENAMED: 'submitted' }
            : { TOKEN: 'later' }
      )
    }
  )

  it.each(['', 'remotely-populated'])(
    'preserves a saved empty personal secret refreshed to %s while saving another edited secret',
    async (remoteValue) => {
      let persisted: unknown
      const personal = {
        variables: {
          EMPTY: { key: 'EMPTY', value: '' },
          TOKEN: { key: 'TOKEN', value: 'original' },
        },
        save: async (variables: Record<string, string>) => {
          persisted = variables
        },
      }
      await render({ personal })
      const fields = [
        ...container.querySelectorAll<HTMLInputElement>('input[name^="env_variable_value_"]'),
      ]
      const token = fields.find((field) => field.value === 'original')
      if (!token) throw new Error('Missing saved token')
      await change(token, 'updated')
      await render({
        personal: {
          ...personal,
          variables: { ...personal.variables, EMPTY: { key: 'EMPTY', value: remoteValue } },
        },
      })
      await act(async () => button('Save').click())
      expect(persisted).toEqual({ EMPTY: remoteValue, TOKEN: 'updated' })
      let left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      expect(left).toBe(true)
    }
  )

  it('persists deletion of a saved empty personal secret', async () => {
    let persisted: unknown
    await render({
      personal: {
        variables: {
          EMPTY: { key: 'EMPTY', value: '' },
          TOKEN: { key: 'TOKEN', value: 'original' },
        },
        save: async (variables) => {
          persisted = variables
        },
      },
    })
    const empty = [
      ...container.querySelectorAll<HTMLInputElement>('input[name^="env_variable_name_"]'),
    ].find((field) => field.value === 'EMPTY')
    if (!empty) throw new Error('Missing empty secret')
    await change(empty, '')
    await act(async () => button('Save').click())
    expect(persisted).toEqual({ TOKEN: 'original' })
  })

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

  it.each(['personal', 'shared'])(
    'resumes a skipped %s refresh after reverting the draft',
    async (scope) => {
      const original = { TOKEN: 'original' }
      const refreshed = { TOKEN: 'remote', REMOTE: 'new' }
      const props = (variables: Record<string, string>) =>
        scope === 'shared'
          ? { variables }
          : {
              personal: {
                variables: Object.fromEntries(
                  Object.entries(variables).map(([key, value]) => [key, { key, value }])
                ),
                save: mocks.save,
              },
            }
      const selector =
        scope === 'shared'
          ? 'input[name^="workspace_env_value_TOKEN"]'
          : 'input[name^="env_variable_value_"]'
      await render(props(original))
      const field = container.querySelector<HTMLInputElement>(selector)
      if (!field) throw new Error('Missing secret value')
      await change(field, 'draft')
      await render(props(refreshed))
      const retained = container.querySelector<HTMLInputElement>(selector)
      if (!retained) throw new Error('Missing retained draft')
      expect(retained.value).toBe('draft')
      await change(retained, 'original')
      const values = [...container.querySelectorAll<HTMLInputElement>('input[name*="value"]')].map(
        (input) => input.value
      )
      expect(values).toContain('remote')
      expect(values).toContain('new')
      let left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      expect(left).toBe(true)
    }
  )

  it.each(['personal', 'shared'])(
    'consumes a fresh %s snapshot received before Save without hiding remote keys',
    async (scope) => {
      const empty = {}
      const original = { TOKEN: 'original' }
      const refreshed = { TOKEN: 'remote', REMOTE: 'new' }
      const personalOriginal = { TOKEN: { key: 'TOKEN', value: 'original' } }
      const personalRefreshed = {
        TOKEN: { key: 'TOKEN', value: 'remote' },
        REMOTE: { key: 'REMOTE', value: 'new' },
      }
      const props = (fresh: boolean) =>
        scope === 'shared'
          ? { variables: fresh ? refreshed : original }
          : {
              variables: empty,
              personal: {
                variables: fresh ? personalRefreshed : personalOriginal,
                save: mocks.save,
              },
            }
      const selector =
        scope === 'shared'
          ? 'input[name^="workspace_env_value_TOKEN"]'
          : 'input[name^="env_variable_value_"]'
      await render(props(false))
      const field = container.querySelector<HTMLInputElement>(selector)
      if (!field) throw new Error('Missing secret value')
      await change(field, 'submitted')
      await render(props(true))
      await act(async () => button('Save').click())
      expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe('submitted')
      const values = [...container.querySelectorAll<HTMLInputElement>('input[name*="value"]')].map(
        (input) => input.value
      )
      expect(values).toContain('new')
      let left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      expect(left).toBe(true)
    }
  )

  it.each([
    { scope: 'personal', refresh: 'during Save' },
    { scope: 'shared', refresh: 'during Save' },
    { scope: 'personal', refresh: 'after Save' },
    { scope: 'shared', refresh: 'after Save' },
  ])(
    'acknowledges fresh $scope values received $refresh without rolling back the save',
    async ({ scope, refresh }) => {
      const request = createDeferred<void>()
      const original = { TOKEN: 'original' }
      const canonical = { TOKEN: 'submitted', REMOTE: 'canonical' }
      const emptyShared = {}
      const personalOriginal = { TOKEN: { key: 'TOKEN', value: 'original' } }
      const personalCanonical = {
        TOKEN: { key: 'TOKEN', value: 'submitted' },
        REMOTE: { key: 'REMOTE', value: 'canonical' },
      }
      const props = (fresh: boolean, isSaving: boolean) =>
        scope === 'shared'
          ? { variables: fresh ? canonical : original, isSaving, save: () => request.promise }
          : {
              variables: emptyShared,
              isSaving,
              personal: {
                variables: fresh ? personalCanonical : personalOriginal,
                save: () => request.promise,
              },
            }
      const selector =
        scope === 'shared'
          ? 'input[name^="workspace_env_value_TOKEN"]'
          : 'input[name^="env_variable_value_"]'
      await render(props(false, false))
      const field = container.querySelector<HTMLInputElement>(selector)
      if (!field) throw new Error('Missing secret value')
      await change(field, 'submitted')
      act(() => button('Save').click())
      await render(props(refresh === 'during Save', true))
      await act(async () => request.resolve())
      await render(props(refresh === 'during Save', false))
      expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe('submitted')
      if (refresh === 'after Save') await render(props(true, false))
      const values = [...container.querySelectorAll<HTMLInputElement>('input[name*="value"]')].map(
        (input) => input.value
      )
      expect(values).toContain('canonical')
      let left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      expect(left).toBe(true)
    }
  )

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
