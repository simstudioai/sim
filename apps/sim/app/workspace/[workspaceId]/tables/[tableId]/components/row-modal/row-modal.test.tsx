/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableInfo, TableRow } from '@/lib/table'
import { RowModal } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/row-modal/row-modal'

const {
  mockToastError,
  mockUseTimezoneState,
  mockCreateRow,
  mockUpdateRow,
  mockDeleteRow,
  mockDeleteRows,
} = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUseTimezoneState: vi.fn(),
  mockCreateRow: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockDeleteRow: vi.fn(),
  mockDeleteRows: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('@/hooks/queries/general-settings', () => ({
  useTimezoneState: mockUseTimezoneState,
}))
vi.mock('@/hooks/queries/tables', () => ({
  useCreateTableRow: () => ({ mutateAsync: mockCreateRow, isPending: false }),
  useUpdateTableRow: () => ({ mutateAsync: mockUpdateRow, isPending: false }),
  useDeleteTableRow: () => ({ mutateAsync: mockDeleteRow, isPending: false }),
  useDeleteTableRows: () => ({ mutateAsync: mockDeleteRows, isPending: false }),
}))
vi.mock('@sim/emcn', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null
  return {
    Checkbox: () => null,
    Chip: ({ children, ...props }: { children?: ReactNode }) =>
      createElement('button', { type: 'button', ...props }, children),
    ChipConfirmModal: passthrough,
    ChipDatePicker: ({ value, onChange }: { value?: string; onChange: (value: string) => void }) =>
      createElement('input', {
        'data-testid': 'date',
        value: value ?? '',
        onChange: (event: { currentTarget: { value: string } }) =>
          onChange(event.currentTarget.value),
      }),
    ChipModal: passthrough,
    ChipModalBody: passthrough,
    ChipModalError: passthrough,
    ChipModalField: ({
      type,
      value,
      onChange,
      children,
    }: {
      type?: string
      value?: string
      onChange?: (value: string) => void
      children?: ReactNode | ((aria: Record<string, string>) => ReactNode)
    }) =>
      type === 'input'
        ? createElement('input', {
            'data-testid': 'modal-input',
            value: value ?? '',
            onChange: (event: { currentTarget: { value: string } }) =>
              onChange?.(event.currentTarget.value),
          })
        : typeof children === 'function'
          ? children({ 'aria-describedby': 'field-hint' })
          : (children ?? null),
    ChipModalFooter: ({
      primaryAction,
    }: {
      primaryAction: { disabled?: boolean; onClick?: () => void }
    }) =>
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'submit',
          disabled: primaryAction.disabled,
          onClick: primaryAction.onClick,
        },
        'Update Row'
      ),
    ChipModalHeader: passthrough,
    Label: passthrough,
    toast: { error: mockToastError },
  }
})

const table: TableInfo = {
  id: 'table-1',
  name: 'Expiring rows',
  schema: { columns: [{ name: 'expires_at', type: 'ttl' }] },
}

const row: TableRow = {
  id: 'row-1',
  data: { expires_at: '2026-11-01T01:00:00-07:00' },
  executions: {},
  position: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('RowModal add mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateRow.mockResolvedValue(undefined)
    mockUseTimezoneState.mockReturnValue({ timezone: 'America/Los_Angeles', status: 'ready' })
  })

  it('inserts the complete row under column ids in one request without updating', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'add' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-3',
        name: 'People',
        schema: { columns: [{ id: 'col_name', name: 'Name', type: 'string' as const }] },
      },
      onSuccess: vi.fn(),
    }

    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    act(() => root.render(createElement(RowModal, props)))

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="modal-input"]')
    expect(nameInput?.value).toBe('')
    act(() => changeInput(nameInput as HTMLInputElement, 'Ada'))
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    expect(mockCreateRow).toHaveBeenCalledWith({ data: { col_name: 'Ada' } })
    expect(mockUpdateRow).not.toHaveBeenCalled()
    expect(props.onSuccess).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it('inserts the row at the requested position', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'add' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-3',
        name: 'People',
        schema: {
          columns: [{ id: 'col_name', name: 'Name', type: 'string' as const, required: true }],
        },
      },
      insertAt: { afterRowId: 'row-1' },
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="modal-input"]')
    act(() => changeInput(nameInput as HTMLInputElement, 'Ada'))
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    expect(mockCreateRow).toHaveBeenCalledWith({ data: { col_name: 'Ada' }, afterRowId: 'row-1' })
    act(() => root.unmount())
    container.remove()
  })

  it('keeps Add Row disabled until every required field has a value', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'add' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-3',
        name: 'People',
        schema: {
          columns: [
            { id: 'col_name', name: 'Name', type: 'string' as const, required: true },
            { id: 'col_notes', name: 'Notes', type: 'string' as const },
            { id: 'col_active', name: 'Active', type: 'boolean' as const, required: true },
          ],
        },
      },
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))

    const submit = () => container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    const nameInput = container.querySelectorAll<HTMLInputElement>('[data-testid="modal-input"]')[0]
    expect(submit()?.disabled).toBe(true)

    act(() => changeInput(nameInput, 'Ada'))
    expect(submit()?.disabled).toBe(false)

    act(() => changeInput(nameInput, ''))
    expect(submit()?.disabled).toBe(true)

    act(() => root.unmount())
    container.remove()
  })
})

describe('RowModal column ids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateRow.mockResolvedValue(undefined)
    mockUseTimezoneState.mockReturnValue({ timezone: 'America/Los_Angeles', status: 'ready' })
  })

  it('shows and saves edit values stored under the column id', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'edit' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-4',
        name: 'People',
        schema: { columns: [{ id: 'col_name', name: 'Name', type: 'string' as const }] },
      },
      row: { ...row, data: { col_name: 'Ada' } },
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="modal-input"]')
    expect(nameInput?.value).toBe('Ada')
    act(() => changeInput(nameInput as HTMLInputElement, 'Grace'))
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    expect(mockUpdateRow).toHaveBeenCalledWith({ rowId: 'row-1', data: { col_name: 'Grace' } })
    act(() => root.unmount())
    container.remove()
  })
})

describe('RowModal expiration editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateRow.mockResolvedValue(undefined)
  })

  it('preserves expiration offsets while timezone settings load or change', async () => {
    mockUseTimezoneState.mockReturnValue({ timezone: 'Asia/Tokyo', status: 'loading' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'edit' as const,
      isOpen: true,
      onClose: vi.fn(),
      table,
      row,
      onSuccess: vi.fn(),
    }

    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    act(() => root.render(createElement(RowModal, props)))

    expect(container.querySelector<HTMLInputElement>('[data-testid="date"]')?.value).toBe(
      '2026-11-01T01:00:00'
    )
    expect(container.querySelector<HTMLButtonElement>('[data-testid="submit"]')?.disabled).toBe(
      false
    )

    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
    act(() => root.render(createElement(RowModal, props)))

    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/New_York',
      status: 'ready',
    })
    act(() => root.render(createElement(RowModal, props)))

    const dateInput = container.querySelector<HTMLInputElement>('[data-testid="date"]')
    expect(dateInput?.value).toBe('2026-11-01T01:00:00')
    act(() => changeInput(dateInput as HTMLInputElement, '2026-11-01T01:30'))

    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    expect(mockUpdateRow).toHaveBeenCalledWith({
      rowId: 'row-1',
      data: { expires_at: '2026-11-01T01:30:00-07:00' },
    })
    expect(props.onSuccess).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it('also waits for timezone settings on an ordinary Date column', () => {
    mockUseTimezoneState.mockReturnValue({ timezone: 'Asia/Tokyo', status: 'loading' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'edit' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-2',
        name: 'Dates',
        schema: { columns: [{ name: 'starts_at', type: 'date' as const }] },
      },
      row: { ...row, data: { starts_at: '2026-06-15T09:00:00+09:00' } },
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))

    expect(container.querySelector('[aria-label="Edit starts_at"]')?.textContent).toBe(
      'Loading timezone…'
    )
    expect(container.querySelector<HTMLInputElement>('[data-testid="date"]')).toBeNull()

    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
    act(() => root.render(createElement(RowModal, props)))

    expect(container.querySelector<HTMLInputElement>('[data-testid="date"]')).not.toBeNull()
    act(() => root.unmount())
    container.remove()
  })

  it('allows expiration edits even when the saved timezone is invalid', () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      savedTimezone: 'Mars/Olympus',
      status: 'invalid',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'edit' as const,
      isOpen: true,
      onClose: vi.fn(),
      table,
      row,
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))

    expect(container.querySelector<HTMLInputElement>('[data-testid="date"]')?.value).toBe(
      '2026-11-01T01:00:00'
    )
    expect(container.querySelector<HTMLButtonElement>('[data-testid="submit"]')?.disabled).toBe(
      false
    )
    expect(mockToastError).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()
  })

  it('sends only the edited field and omits blocked date values from the update', async () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      savedTimezone: 'Mars/Olympus',
      status: 'invalid',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const mixedTable: TableInfo = {
      ...table,
      schema: {
        columns: [
          { name: 'name', type: 'string' },
          { name: 'starts_at', type: 'date' },
          { name: 'expires_at', type: 'ttl' },
        ],
      },
    }
    const mixedRow = {
      ...row,
      data: {
        name: 'Ada',
        expires_at: row.data.expires_at,
        starts_at: '2026-09-07T12:00:00-07:00',
      },
    }
    const props = {
      mode: 'edit' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: mixedTable,
      row: mixedRow,
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="modal-input"]')
    const blockedField = container.querySelector<HTMLButtonElement>('[aria-label="Edit starts_at"]')
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    expect(nameInput?.value).toBe('Ada')
    expect(blockedField?.textContent).toBe(mixedRow.data.starts_at)
    expect(submit?.disabled).toBe(false)

    act(() => changeInput(nameInput as HTMLInputElement, 'Grace'))
    await act(async () => submit?.click())

    // Only the edited field is sent: the untouched TTL would otherwise be
    // rewritten with the same value (and re-stamped through the picker), and the
    // timezone-blocked date is dropped entirely.
    expect(mockUpdateRow).toHaveBeenCalledWith({ rowId: 'row-1', data: { name: 'Grace' } })
    expect(props.onSuccess).toHaveBeenCalledTimes(1)
    expect(mockToastError).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })
})

describe('RowModal payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateRow.mockResolvedValue(undefined)
    mockUpdateRow.mockResolvedValue(undefined)
    mockUseTimezoneState.mockReturnValue({ timezone: 'America/Los_Angeles', status: 'ready' })
  })

  it('closes without a write when the edit changes nothing', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'edit' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-5',
        name: 'People',
        schema: { columns: [{ id: 'col_name', name: 'Name', type: 'string' as const }] },
      },
      row: { ...row, data: { col_name: 'Ada' } },
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    expect(mockUpdateRow).not.toHaveBeenCalled()
    expect(props.onSuccess).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it('omits untouched columns on insert but still sends toggles', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      mode: 'add' as const,
      isOpen: true,
      onClose: vi.fn(),
      table: {
        id: 'table-6',
        name: 'People',
        schema: {
          columns: [
            { id: 'col_name', name: 'Name', type: 'string' as const },
            { id: 'col_notes', name: 'Notes', type: 'string' as const },
            { id: 'col_done', name: 'Done', type: 'boolean' as const },
          ],
        },
      },
      onSuccess: vi.fn(),
    }

    act(() => root.render(createElement(RowModal, props)))
    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="modal-input"]')
    act(() => changeInput(nameInput as HTMLInputElement, 'Ada'))
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    // `col_notes` was never touched, so it stays absent instead of being written
    // as null; a checkbox always carries a concrete boolean.
    expect(mockCreateRow).toHaveBeenCalledWith({ data: { col_name: 'Ada', col_done: false } })

    act(() => root.unmount())
    container.remove()
  })
})
