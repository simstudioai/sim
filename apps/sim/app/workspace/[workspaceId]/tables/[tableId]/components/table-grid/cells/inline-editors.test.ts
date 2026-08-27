/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition } from '@/lib/table'
import {
  dateEditorRawValue,
  InlineEditor,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/inline-editors'
import { cleanCellValue } from '@/app/workspace/[workspaceId]/tables/[tableId]/utils'

const { mockToastError, mockUseTimezoneState } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUseTimezoneState: vi.fn(),
}))

vi.mock('@/hooks/queries/general-settings', () => ({ useTimezoneState: mockUseTimezoneState }))
vi.mock('@sim/emcn', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null
  return {
    Calendar: () => null,
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
    expect(cleanCellValue(repeatedRaw, ttlColumn, timezone)).toBe(
      Date.parse('2026-11-01T06:30:00Z') / 1000
    )

    const fractionalRaw = dateEditorRawValue('2023-11-14t22:13:20.001Z', ttlColumn, timezone)
    expect(cleanCellValue(fractionalRaw, ttlColumn, timezone)).toBe(1_700_000_001)
  })

  it('keeps ordinary date drafts on their existing display parser', () => {
    expect(dateEditorRawValue('11/01/2026 1:30:00 AM', column('date'), 'America/New_York')).toBe(
      '2026-11-01T01:30:00-04:00'
    )
  })

  it('keeps an open TTL edit in its starting timezone when the setting changes', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    const value = Date.parse('2026-06-15T13:00:30Z') / 1000
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

    const input = container.querySelector('input')
    expect(input?.value).toBe('06/15/2026 6:00:30 AM')
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith(value, 'enter')
    act(() => root.unmount())
    container.remove()
  })

  it('waits for the saved timezone before creating a TTL draft', () => {
    mockUseTimezoneState.mockReturnValue({
      timezone: 'Asia/Tokyo',
      status: 'loading',
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSave = vi.fn()
    const props = {
      value: Date.parse('2026-06-15T13:00:30Z') / 1000,
      column: column('ttl'),
      onSave,
      onCancel: vi.fn(),
    }

    act(() => root.render(createElement(InlineEditor, props)))

    expect(container.querySelector('input')).toMatchObject({
      disabled: true,
      placeholder: 'Loading timezone...',
    })

    mockUseTimezoneState.mockReturnValue({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
    act(() => root.render(createElement(InlineEditor, props)))

    const input = container.querySelector('input') as HTMLInputElement
    expect(input.disabled).toBe(false)
    act(() => changeInput(input, '09/01/2026 9:00 AM'))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(onSave).toHaveBeenCalledWith(Date.parse('2026-09-01T16:00:00Z') / 1000, 'enter')
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
          value: Date.parse('2026-06-15T13:00:30Z') / 1000,
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
    expect(mockToastError).toHaveBeenCalledWith('Invalid expiration date')
    act(() => root.unmount())
    container.remove()
  })

  it.each([
    { caseName: 'a historical sub-minute offset', timezone: 'Africa/Monrovia', value: 2670 },
    {
      caseName: 'the far-future representable boundary',
      timezone: 'Asia/Tokyo',
      value: 253_402_300_799,
    },
  ])('preserves the exact epoch for $caseName when untouched', ({ timezone, value }) => {
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

  it('cancels TTL editing when the saved timezone cannot be loaded', () => {
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
          value: 2670,
          column: column('ttl'),
          onSave: vi.fn(),
          onCancel,
        })
      )
    )

    expect(onCancel).toHaveBeenCalledOnce()
    expect(mockToastError).toHaveBeenCalledWith('Could not load timezone')
    act(() => root.unmount())
    container.remove()
  })
})
