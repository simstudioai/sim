/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type TableLocks, UNLOCKED_TABLE_LOCKS } from '@/lib/table/types'
import { LockSettingsModal } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/lock-settings-modal/lock-settings-modal'
import { useTableSecurityStore } from '@/stores/table/security/store'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('@/hooks/queries/tables', () => ({
  useUpdateTableLocks: () => ({ mutateAsync, isPending: false }),
}))

const LABELS = ['Inserting Rows', 'Updating Rows', 'Deleting Rows', 'Changing Table Schema']
let container: HTMLDivElement
let root: Root
const onClose = vi.fn()

function render(locks: TableLocks = UNLOCKED_TABLE_LOCKS, isOpen = true) {
  act(() => {
    root.render(
      <LockSettingsModal
        isOpen={isOpen}
        onClose={onClose}
        workspaceId='workspace-1'
        tableId='table-1'
        locks={locks}
      />
    )
  })
}

function getSwitch(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    `button[role="switch"][aria-label="${label}"]`
  )
  if (!element) throw new Error(`Missing switch: ${label}`)
  return element
}

function clickSwitch(label: string) {
  act(() => getSwitch(label).click())
}

function getPermission(label: string, choice: 'Deny' | 'Allow'): HTMLButtonElement {
  const group = document.querySelector(`[role="radiogroup"][aria-label="${label}"]`)
  const button = [
    ...(group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? []),
  ].find((element) => element.textContent === choice)
  if (!button) throw new Error(`Missing permission: ${label} ${choice}`)
  return button
}

function selectPermission(label: string, choice: 'Deny' | 'Allow') {
  act(() => getPermission(label, choice).click())
}

function save() {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === 'Save'
  )
  if (!button) throw new Error('Missing Save button')
  act(() => button.click())
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mutateAsync.mockReturnValue(new Promise(() => {}))
  useTableSecurityStore.getState().reset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Table Security', () => {
  it('hides permissions while disabled and enables all four backend locks by default', () => {
    render()
    expect(getSwitch('Enable Table Security').getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()

    clickSwitch('Enable Table Security')
    for (const label of LABELS) {
      expect(getPermission(label, 'Deny').disabled).toBe(false)
      expect(getPermission(label, 'Allow').disabled).toBe(false)
      expect(getPermission(label, 'Deny').getAttribute('aria-checked')).toBe('true')
      expect(getPermission(label, 'Allow').getAttribute('aria-checked')).toBe('false')
    }
    save()

    expect(mutateAsync.mock.calls[0][0]).toEqual({
      tableId: 'table-1',
      locks: { insertLocked: true, updateLocked: true, deleteLocked: true, schemaLocked: true },
    })
  })

  it('inverts existing locks and remembers permissions after disabling, saving, and reopening', async () => {
    render({ insertLocked: true, updateLocked: true, deleteLocked: false, schemaLocked: true })
    expect(getSwitch('Enable Table Security').getAttribute('aria-checked')).toBe('true')
    expect(getPermission('Deleting Rows', 'Allow').getAttribute('aria-checked')).toBe('true')
    expect(getPermission('Updating Rows', 'Deny').getAttribute('aria-checked')).toBe('true')

    selectPermission('Inserting Rows', 'Allow')
    clickSwitch('Enable Table Security')
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    let resolveSave!: () => void
    mutateAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSave = resolve
      })
    )
    save()
    expect(mutateAsync.mock.calls[0][0]).toEqual({
      tableId: 'table-1',
      locks: UNLOCKED_TABLE_LOCKS,
    })
    await act(async () => resolveSave())

    render(UNLOCKED_TABLE_LOCKS, false)
    render()
    expect(getSwitch('Enable Table Security').getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    clickSwitch('Enable Table Security')
    expect(getPermission('Inserting Rows', 'Allow').getAttribute('aria-checked')).toBe('true')
    expect(getPermission('Updating Rows', 'Deny').getAttribute('aria-checked')).toBe('true')
    save()
    expect(mutateAsync.mock.calls[1][0]).toEqual({
      tableId: 'table-1',
      locks: { insertLocked: false, updateLocked: true, deleteLocked: false, schemaLocked: true },
    })
  })

  it('does not remember unsuccessful changes and discards them on reopen', () => {
    render()
    clickSwitch('Enable Table Security')
    selectPermission('Inserting Rows', 'Allow')
    save()
    expect(useTableSecurityStore.getState().preferences['table-1']).toBeUndefined()
    expect(onClose).not.toHaveBeenCalled()

    render(UNLOCKED_TABLE_LOCKS, false)
    render()
    expect(getSwitch('Enable Table Security').getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    clickSwitch('Enable Table Security')
    expect(getPermission('Inserting Rows', 'Deny').getAttribute('aria-checked')).toBe('true')
  })
})
