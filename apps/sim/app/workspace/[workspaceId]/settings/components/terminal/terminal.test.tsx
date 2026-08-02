/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import type {
  DesktopZoomPercent,
  TerminalAppearanceTheme,
  TerminalSelectedProfile,
  TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { mockBridge, mockRouter, mockSnapshot, mockToast } = vi.hoisted(() => ({
  mockBridge: { current: null as unknown },
  mockRouter: { replace: vi.fn() },
  mockSnapshot: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@sim/emcn', () => ({
  ChipSelect: ({
    value,
    onChange,
    options,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value?: string
    onChange?: (value: string) => void
    options?: Array<{ label: string; value: string }>
    disabled?: boolean
    'aria-label'?: string
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    >
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Switch: ({ checked }: { checked: boolean }) => (
    <button type='button' role='switch' aria-checked={checked} />
  ),
  toast: mockToast,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws1' }),
  useRouter: () => mockRouter,
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => mockBridge.current,
  setDesktopPreferencesSnapshot: mockSnapshot,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    actions,
  }: {
    children: ReactNode
    actions?: Array<{ text: string; onSelect: () => void; disabled?: boolean }>
  }) => (
    <main>
      {actions?.map((action) => (
        <button
          key={action.text}
          type='button'
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.text}
        </button>
      ))}
      {children}
    </main>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children, label }: { children: ReactNode; label: string }) => (
      <section aria-label={label}>{children}</section>
    ),
  })
)

vi.mock('@/app/workspace/[workspaceId]/settings/components/terminal/terminal-theme-picker', () => ({
  TerminalThemePicker: ({
    value,
    profiles,
    disabled,
    onBuiltInSelect,
    onProfileSelect,
  }: {
    value: string
    profiles: TerminalThemeProfile[]
    disabled?: boolean
    onBuiltInSelect: (theme: 'app' | 'light' | 'dark') => void
    onProfileSelect: (profile: TerminalThemeProfile) => void
  }) => (
    <select
      aria-label='Terminal theme'
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = event.currentTarget.value
        const profile = profiles.find(({ id }) => `profile:${id}` === next)
        if (profile) onProfileSelect(profile)
        else onBuiltInSelect(next as 'app' | 'light' | 'dark')
      }}
    >
      <option value='app'>Default</option>
      <option value='light'>Sim Light</option>
      <option value='dark'>Sim Dark</option>
      {profiles.map((profile) => (
        <option key={profile.id} value={`profile:${profile.id}`}>
          {profile.sourceLabel} · {profile.name}
        </option>
      ))}
    </select>
  ),
}))

import { Terminal } from './terminal'

const importedProfile = {
  id: 'iterm2:ocean',
  name: 'Ocean',
  source: 'iterm2' as const,
  sourceLabel: 'iTerm2',
  isDefault: true,
  palette: {
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
  },
}

function createBridge(
  theme: TerminalAppearanceTheme = 'app',
  terminalProfile?: TerminalSelectedProfile,
  terminalDefaultZoom: DesktopZoomPercent = 100
) {
  const preferences = {
    notificationsEnabled: true,
    notificationSounds: true,
    notificationsOnlyWhenUnfocused: true,
    launchAtLogin: false,
    autoDownloadUpdates: true,
    terminalEnabled: true,
    terminalTheme: theme,
    terminalDefaultZoom,
    ...(terminalProfile ? { terminalProfile } : {}),
  }
  return {
    terminal: {},
    settings: {
      getPreferences: vi.fn(async () => preferences),
      setTerminalEnabled: vi.fn(),
      setTerminalTheme: vi.fn(async (next: TerminalAppearanceTheme) => ({
        ...preferences,
        terminalTheme: next,
      })),
      setTerminalDefaultZoom: vi.fn(async (zoom: DesktopZoomPercent) => ({
        ...preferences,
        terminalDefaultZoom: zoom,
      })),
    },
    terminalThemes: {
      listProfiles: vi.fn(async () => [importedProfile]),
      selectProfile: vi.fn(async () => ({
        ...preferences,
        terminalTheme: 'profile:iterm2:ocean' as const,
        terminalProfile: {
          id: importedProfile.id,
          name: importedProfile.name,
          source: importedProfile.source,
          palette: importedProfile.palette,
        },
      })),
    },
  }
}

let container: HTMLDivElement
let root: Root

describe('Terminal settings', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockBridge.current = createBridge()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('consolidates terminal controls into the compact General section', async () => {
    await act(async () => {
      root.render(<Terminal />)
    })

    expect(container.querySelector('section[aria-label="General"]')).not.toBeNull()
    expect(container.querySelector('section[aria-label="Appearance"]')).toBeNull()
    expect(container.querySelectorAll('section')).toHaveLength(1)
    expect(container.textContent).not.toContain('Commands run on this machine')
    expect(container.textContent).not.toContain('Choose Sim’s default palettes')
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Terminal theme"]')
    expect(select?.value).toBe('app')
    expect([...select!.options].map(({ text }) => text)).toEqual([
      'Default',
      'Sim Light',
      'Sim Dark',
      'iTerm2 · Ocean',
    ])
  })

  it('updates the theme without restarting terminal sessions', async () => {
    const bridge = createBridge()
    mockBridge.current = bridge
    await act(async () => {
      root.render(<Terminal />)
    })

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Terminal theme"]')
    await act(async () => {
      if (!select) throw new Error('Missing terminal theme selector')
      select.value = 'light'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(bridge.settings.setTerminalTheme).toHaveBeenCalledWith('light')
    expect(mockSnapshot).toHaveBeenCalledWith(expect.objectContaining({ terminalTheme: 'light' }))
  })

  it('persists the default terminal zoom with the shared zoom selector', async () => {
    const bridge = createBridge('app', undefined, 100)
    mockBridge.current = bridge
    await act(async () => {
      root.render(<Terminal />)
    })

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Terminal default zoom"]'
    )
    expect(select?.value).toBe('100')

    await act(async () => {
      if (!select) throw new Error('Missing terminal default zoom selector')
      select.value = '125'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(bridge.settings.setTerminalDefaultZoom).toHaveBeenCalledWith(125)
    expect(mockSnapshot).toHaveBeenCalledWith(expect.objectContaining({ terminalDefaultZoom: 125 }))
    expect(select.value).toBe('125')
  })

  it('selects a Terminal or iTerm2 profile directly from the theme picker', async () => {
    const bridge = createBridge()
    mockBridge.current = bridge
    await act(async () => {
      root.render(<Terminal />)
    })

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Terminal theme"]')
    await act(async () => {
      if (!select) throw new Error('Missing terminal theme selector')
      select.value = 'profile:iterm2:ocean'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(bridge.terminalThemes.selectProfile).toHaveBeenCalledWith('iterm2:ocean')
    expect(mockSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ terminalTheme: 'profile:iterm2:ocean' })
    )
  })
})
