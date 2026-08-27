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

const { mockUseTimezone } = vi.hoisted(() => ({ mockUseTimezone: vi.fn() }))

vi.mock('@/hooks/queries/general-settings', () => ({ useTimezone: mockUseTimezone }))
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
    toast: { error: vi.fn() },
  }
})
const column = (type: ColumnDefinition['type']): ColumnDefinition => ({ name: 'expires_at', type })

describe('dateEditorRawValue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTimezone.mockReturnValue('America/Los_Angeles')
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
    mockUseTimezone.mockReturnValue('America/New_York')
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
})
