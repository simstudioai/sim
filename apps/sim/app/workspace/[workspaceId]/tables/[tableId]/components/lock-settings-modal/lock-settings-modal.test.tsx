/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type TableLocks, UNLOCKED_TABLE_LOCKS } from '@/lib/table/types'
import { LockSettingsModal } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/lock-settings-modal/lock-settings-modal'

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

function getSave(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === 'Save'
  )
  if (!button) throw new Error('Missing Save button')
  return button
}

function save() {
  act(() => getSave().click())
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mutateAsync.mockReturnValue(new Promise(() => {}))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Table Security', () => {
  it('always shows the four rows and starts an unconfigured table on Allow', () => {
    render()
    for (const label of LABELS) {
      expect(getPermission(label, 'Allow').getAttribute('aria-checked')).toBe('true')
      expect(getPermission(label, 'Deny').getAttribute('aria-checked')).toBe('false')
    }
    // Nothing staged yet, so there is nothing to save.
    expect(getSave().disabled).toBe(true)
  })

  it('mirrors the server locks, with Deny meaning a set lock', () => {
    render({ insertLocked: true, updateLocked: false, deleteLocked: true, schemaLocked: false })
    expect(getPermission('Inserting Rows', 'Deny').getAttribute('aria-checked')).toBe('true')
    expect(getPermission('Deleting Rows', 'Deny').getAttribute('aria-checked')).toBe('true')
    expect(getPermission('Updating Rows', 'Allow').getAttribute('aria-checked')).toBe('true')
    expect(getPermission('Changing Table Schema', 'Allow').getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('saves the denied actions as locks', () => {
    render()
    selectPermission('Inserting Rows', 'Deny')
    selectPermission('Changing Table Schema', 'Deny')
    expect(getSave().disabled).toBe(false)
    save()

    expect(mutateAsync.mock.calls[0][0]).toEqual({
      tableId: 'table-1',
      locks: { insertLocked: true, updateLocked: false, deleteLocked: false, schemaLocked: true },
    })
  })

  it('keeps the modal open when the save fails and discards the draft on reopen', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('Admin access required to change table locks'))
    render()
    selectPermission('Updating Rows', 'Deny')
    await act(async () => {
      getSave().click()
    })
    expect(onClose).not.toHaveBeenCalled()

    render(UNLOCKED_TABLE_LOCKS, false)
    render()
    expect(getPermission('Updating Rows', 'Allow').getAttribute('aria-checked')).toBe('true')
    expect(getSave().disabled).toBe(true)
  })
})
