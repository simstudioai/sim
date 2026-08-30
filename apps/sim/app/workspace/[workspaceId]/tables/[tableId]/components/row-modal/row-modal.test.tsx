/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableInfo, TableRow } from '@/lib/table'
import { RowModal } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/row-modal/row-modal'

const { mockUseTimezoneState, mockUpdateRow, mockDeleteRow, mockDeleteRows } = vi.hoisted(() => ({
  mockUseTimezoneState: vi.fn(),
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
  useUpdateTableRow: () => ({ mutateAsync: mockUpdateRow, isPending: false }),
  useDeleteTableRow: () => ({ mutateAsync: mockDeleteRow, isPending: false }),
  useDeleteTableRows: () => ({ mutateAsync: mockDeleteRows, isPending: false }),
}))
vi.mock('@sim/emcn', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null
  return {
    Checkbox: () => null,
    ChipConfirmModal: passthrough,
    ChipDatePicker: ({ value, onChange }: { value?: string; onChange: (value: string) => void }) =>
      createElement(
        'button',
        { type: 'button', 'data-testid': 'date', onClick: () => onChange(value ?? '2026-11-01') },
        value
      ),
    ChipModal: passthrough,
    ChipModalBody: passthrough,
    ChipModalError: passthrough,
    ChipModalField: passthrough,
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
    ChipTimePicker: ({ value, onChange }: { value?: string; onChange: (value: string) => void }) =>
      createElement('input', {
        'data-testid': 'time',
        value: value ?? '',
        onChange: (event: { currentTarget: { value: string } }) =>
          onChange(event.currentTarget.value),
      }),
    Label: passthrough,
  }
})

const table: TableInfo = {
  id: 'table-1',
  name: 'Expiring rows',
  schema: { columns: [{ name: 'expires_at', type: 'ttl' }] },
}

const row: TableRow = {
  id: 'row-1',
  data: { expires_at: Date.parse('2026-11-01T08:00:00Z') / 1000 },
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

describe('RowModal expiration editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateRow.mockResolvedValue(undefined)
  })

  it('waits for the saved timezone, freezes it, and chooses the later repeated hour', async () => {
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

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading timezone…')
    expect(container.querySelector<HTMLInputElement>('[data-testid="time"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[data-testid="submit"]')?.disabled).toBe(
      true
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

    const timeInput = container.querySelector<HTMLInputElement>('[data-testid="time"]')
    expect(timeInput?.value).toBe('01:00')
    act(() => changeInput(timeInput as HTMLInputElement, '01:30'))

    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit"]')
    await act(async () => submit?.click())

    expect(mockUpdateRow).toHaveBeenCalledWith({
      rowId: 'row-1',
      data: { expires_at: Date.parse('2026-11-01T09:30:00Z') / 1000 },
    })
    expect(props.onSuccess).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })
})
