/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { TerminalThemePalette, TerminalThemeProfile } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface CapturedComboboxProps {
  options: Array<{ label: string; value: string }>
  value?: string
  searchable?: boolean
  searchPlaceholder?: string
  dropdownWidth?: 'trigger' | number
  onChange?: (value: string) => void
}

const { capturedComboboxProps } = vi.hoisted(() => ({
  capturedComboboxProps: { current: null as CapturedComboboxProps | null },
}))

vi.mock('@sim/emcn', () => ({
  ChipCombobox: (props: CapturedComboboxProps) => {
    capturedComboboxProps.current = props
    return <div data-testid='terminal-theme-combobox' />
  },
}))

import { TerminalThemePicker } from './terminal-theme-picker'

const PALETTE: TerminalThemePalette = {
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: '#ffffff',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cc0000',
  green: '#00cc00',
  yellow: '#cccc00',
  blue: '#0000cc',
  magenta: '#cc00cc',
  cyan: '#00cccc',
  white: '#cccccc',
  brightBlack: '#555555',
  brightRed: '#ff5555',
  brightGreen: '#55ff55',
  brightYellow: '#ffff55',
  brightBlue: '#5555ff',
  brightMagenta: '#ff55ff',
  brightCyan: '#55ffff',
  brightWhite: '#ffffff',
}

const TERMINAL_PROFILE: TerminalThemeProfile = {
  id: 'terminal:pro',
  name: 'Pro',
  source: 'terminal',
  sourceLabel: 'Terminal',
  palette: PALETTE,
}

let container: HTMLDivElement
let root: Root

describe('TerminalThemePicker', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    capturedComboboxProps.current = null
    vi.clearAllMocks()
  })

  it('uses General settings’ searchable ChipCombobox with a flat theme list', async () => {
    const onBuiltInSelect = vi.fn()
    const onProfileSelect = vi.fn()

    await act(async () => {
      root.render(
        <TerminalThemePicker
          value='app'
          profiles={[TERMINAL_PROFILE]}
          onBuiltInSelect={onBuiltInSelect}
          onProfileSelect={onProfileSelect}
        />
      )
    })

    expect(capturedComboboxProps.current).toMatchObject({
      searchable: true,
      searchPlaceholder: 'Search themes',
      dropdownWidth: 240,
      value: 'app',
      options: [
        { label: 'Default', value: 'app' },
        { label: 'Sim Light', value: 'light' },
        { label: 'Sim Dark', value: 'dark' },
        { label: 'Terminal · Pro', value: 'profile:terminal:pro' },
      ],
    })

    act(() => capturedComboboxProps.current?.onChange?.('profile:terminal:pro'))
    expect(onProfileSelect).toHaveBeenCalledWith(TERMINAL_PROFILE)

    act(() => capturedComboboxProps.current?.onChange?.('dark'))
    expect(onBuiltInSelect).toHaveBeenCalledWith('dark')
  })
})
