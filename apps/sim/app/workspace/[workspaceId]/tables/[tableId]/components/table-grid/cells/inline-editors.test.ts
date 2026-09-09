/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition } from '@/lib/table'
import { TTL_FORMAT_ERROR } from '@/lib/table/ttl-values'
import {
  dateEditorRawValue,
  InlineEditor,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/inline-editors'
import { cleanCellValue } from '@/app/workspace/[workspaceId]/tables/[tableId]/utils'

const { mockToastError, mockUseTimezoneState, mockCalendar } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockCalendar: vi.fn((_props: { onChange: (value: string) => void }) => null),
  mockUseTimezoneState: vi.fn(),
}))

vi.mock('@/hooks/queries/general-settings', () => ({ useTimezoneState: mockUseTimezoneState }))
vi.mock('@sim/emcn', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null
  return {
    Calendar: mockCalendar,
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: passthrough,
    DropdownMenuTrigger: passthrough,
    Popover: passthrough,
    PopoverAnchor: () => null,
    PopoverContent: passthrough,
    toast: { error: mockToastError },
  }
})
const column = (type: ColumnDefinition['type']): ColumnDefinition => ({ name: 'expires_at', type })

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('dateEditorRawValue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
  })

  it('leaves TTL drafts for TTL coercion to resolve safely', () => {
    const ttlColumn = column('ttl')
    const timezone = 'America/New_York'
    const repeatedWallClock = '11/01/2026 1:30:00 AM'

    const repeatedRaw = dateEditorRawValue(repeatedWallClock, ttlColumn, timezone)
    expect(repeatedRaw).toBe(repeatedWallClock)
    expect(cleanCellValue(repeatedRaw, ttlColumn, timezone)).toBeNull()

    const fractionalRaw = dateEditorRawValue('2023-11-14t22:13:20.001Z', ttlColumn, timezone)
    expect(cleanCellValue(fractionalRaw, ttlColumn, timezone)).toBe('2023-11-14T22:13:20.001Z')
  })

  it.each([
    ['2026-11-01T01:30', '2026-11-01T01:30:00Z'],
    ['2026-03-08T02:30:45', '2026-03-08T02:30:45Z'],
    ['2026-09-07', '2026-09-07T00:00:00Z'],
  ])('saves literal UTC picker selection %s', (picked, expected) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    act(() =>
      root.render(
        createElement(InlineEditor, {
          column: column('ttl'),
          value: null,
          onSave,
          onCancel: vi.fn(),
        })
      )
    )
    const picker = mockCalendar.mock.calls.at(-1)![0]
    act(() => picker.onChange(picked))
    if (picked.includes('T')) {
      const input = container.querySelector('input') as HTMLInputElement
      expect(input.value).toBe(expected)
      act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    }
    expect(onSave).toHaveBeenCalledWith(expected, 'enter')
    expect(mockUseTimezoneState).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()
  })

  it('keeps ordinary date drafts on their existing display parser', () => {
    expect(dateEditorRawValue('11/01/2026 1:30:00 AM', column('date'), 'America/New_York')).toBe(
      '2026-11-01T01:30:00-04:00'
    )
  })

  it('accepts a typed offset timestamp and saves the same instant in UTC', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    act(() =>
      root.render(
        createElement(InlineEditor, {
          column: column('ttl'),
          value: null,
          onSave,
          onCancel: vi.fn(),
        })
      )
    )
    const input = container.querySelector('input') as HTMLInputElement
    act(() => changeInput(input, '2026-09-07T07:30:00.123456-07:00'))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onSave).toHaveBeenCalledWith('2026-09-07T14:30:00.123456Z', 'enter')
    expect(mockToastError).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()
  })

  it('keeps an open TTL edit in UTC when the timezone setting changes', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    const value = '2026-06-15T13:00:30Z'
    const props = {
      value,
      column: column('ttl'),
      onSave,
      onCancel: vi.fn(),
    }

    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    act(() => root.render(createElement(InlineEditor, props)))
    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/New_York',
      status: 'ready',
    })
    act(() => root.render(createElement(InlineEditor, props)))

    const input = container.querySelector('input') as HTMLInputElement
    expect(input?.value).toBe('2026-06-15T13:00:30Z')
    act(() => changeInput(input, '2026-09-01T09:00:00Z'))
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith('2026-09-01T09:00:00Z', 'enter')
    act(() => root.unmount())
    container.remove()
  })

  it('creates a UTC TTL draft while timezone settings are loading', () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'Asia/Tokyo',
      status: 'loading',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    const props = {
      value: '2026-06-15T13:00:30Z',
      column: column('ttl'),
      onSave,
      onCancel: vi.fn(),
    }

    act(() => root.render(createElement(InlineEditor, props)))

    expect(container.querySelector('input')?.value).toBe('2026-06-15T13:00:30Z')
    expect(container.querySelector('[role="status"]')).toBeNull()

    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
    act(() => root.render(createElement(InlineEditor, props)))

    const input = container.querySelector('input') as HTMLInputElement
    expect(input.disabled).toBe(false)
    act(() => changeInput(input, '2026-09-01T09:00:00Z'))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(onSave).toHaveBeenCalledWith('2026-09-01T09:00:00Z', 'enter')
    act(() => root.unmount())
    container.remove()
  })

  it('waits for the saved timezone before creating an ordinary date draft', () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'Asia/Tokyo',
      status: 'loading',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    const props = {
      value: '2026-06-15T06:00:30-07:00',
      column: column('date'),
      onSave,
      onCancel: vi.fn(),
    }

    act(() => root.render(createElement(InlineEditor, props)))

    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading timezone…')

    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
    act(() => root.render(createElement(InlineEditor, props)))

    const input = container.querySelector('input') as HTMLInputElement
    act(() => changeInput(input, '09/01/2026 9:00 AM'))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(onSave).toHaveBeenCalledWith('2026-09-01T09:00:00-07:00', 'enter')
    act(() => root.unmount())
    container.remove()
  })

  it('rejects an impossible TTL draft without clearing the cell', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()

    act(() =>
      root.render(
        createElement(InlineEditor, {
          value: '2026-06-15T13:00:30Z',
          column: column('ttl'),
          onSave,
          onCancel: vi.fn(),
        })
      )
    )

    const input = container.querySelector('input') as HTMLInputElement
    act(() => changeInput(input, '02/30/2026 1:30 AM'))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(onSave).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith(TTL_FORMAT_ERROR)
    act(() => root.unmount())
    container.remove()
  })

  it.each([
    {
      caseName: 'a historical sub-minute offset',
      timezone: 'Africa/Monrovia',
      value: '1970-01-01T00:44:30Z',
    },
    {
      caseName: 'microsecond precision',
      timezone: 'America/Los_Angeles',
      value: '2026-09-07T14:30:00.123456Z',
    },
    {
      caseName: 'the far-future representable boundary',
      timezone: 'Asia/Tokyo',
      value: '9999-12-31T23:59:59Z',
    },
  ])('preserves the exact UTC string for $caseName when untouched', ({ timezone, value }) => {
    mockUseTimezoneState.mockReturnValue({ timezone, status: 'ready' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()

    act(() =>
      root.render(
        createElement(InlineEditor, {
          value,
          column: column('ttl'),
          onSave,
          onCancel: vi.fn(),
        })
      )
    )

    const input = container.querySelector('input') as HTMLInputElement
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(onSave).toHaveBeenCalledWith(value, 'enter')
    act(() => root.unmount())
    container.remove()
  })

  it('allows TTL editing when the saved timezone cannot be loaded', () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'error',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onCancel = vi.fn()

    act(() =>
      root.render(
        createElement(InlineEditor, {
          value: '1970-01-01T00:44:30Z',
          column: column('ttl'),
          onSave: vi.fn(),
          onCancel,
        })
      )
    )

    expect(container.querySelector('input')?.value).toBe('1970-01-01T00:44:30Z')
    expect(onCancel).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()
  })

  it('rejects editing when the saved timezone is invalid', () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      savedTimezone: 'Mars/Olympus',
      status: 'invalid',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onCancel = vi.fn()

    act(() =>
      root.render(
        createElement(InlineEditor, {
          value: '2026-01-15T09:00:00-05:00',
          column: column('date'),
          onSave: vi.fn(),
          onCancel,
        })
      )
    )

    expect(container.querySelector('input')).toBeNull()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(mockToastError).toHaveBeenCalledWith(
      'Your saved timezone “Mars/Olympus” is invalid. Update it in Settings → General before editing Date cells.'
    )
    act(() => root.unmount())
    container.remove()
  })
})
