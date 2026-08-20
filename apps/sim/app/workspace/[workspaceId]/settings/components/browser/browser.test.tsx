/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import type {
  BrowserChromeImportResult,
  BrowserCredentialMetadata,
  BrowserImportProfile,
  DesktopZoomPercent,
} from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { mockBridge, mockRouter, mockToast } = vi.hoisted(() => ({
  mockBridge: { current: null as unknown },
  // Stable across renders, like the real App Router hook. A fresh object each
  // render would retrigger the component's mount effect forever.
  mockRouter: { replace: vi.fn() },
  mockToast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@sim/browser-protocol', () => ({
  BROWSER_DATA_KINDS: ['cookies', 'site-data', 'cache'],
}))

vi.mock('@sim/emcn', () => ({
  /** `SettingsResourceRow` composes its tile classes with `cn`. */
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Chip: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type='button' disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  ChipConfirmModal: ({
    open,
    title,
    text,
    confirm,
  }: {
    open: boolean
    title: string
    text?: Array<string | { text: string; bold?: boolean }>
    confirm: { label: string; pending?: boolean; pendingLabel?: string; onClick: () => void }
  }) =>
    open ? (
      <div role='dialog' aria-label={title}>
        <p>{(text ?? []).map((part) => (typeof part === 'string' ? part : part.text)).join('')}</p>
        <button type='button' disabled={confirm.pending} onClick={confirm.onClick}>
          {confirm.pending ? confirm.pendingLabel : confirm.label}
        </button>
      </div>
    ) : null,
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
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
  toast: mockToast,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws1' }),
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => mockBridge.current,
  setDesktopPreferencesSnapshot: vi.fn(),
}))

// Renders header actions as buttons so the top-right Import action is reachable.
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    actions,
  }: {
    children: ReactNode
    actions?: Array<{ text: string; onSelect: () => void; disabled?: boolean }>
  }) => (
    <main>
      <header>
        {(actions ?? []).map((action) => (
          <button
            key={action.text}
            type='button'
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.text}
          </button>
        ))}
      </header>
      {children}
    </main>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({
      children,
      label,
      action,
    }: {
      children: ReactNode
      label: string
      action?: ReactNode
    }) => (
      <section aria-label={label}>
        {action}
        {children}
      </section>
    ),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/browser/components/passwords-view/passwords-view',
  () => ({
    PasswordsView: ({
      credentials,
      onBack,
    }: {
      credentials: BrowserCredentialMetadata[]
      onBack: () => void
    }) => (
      <section aria-label='Passwords view'>
        <span>{`${credentials.length} saved`}</span>
        <button type='button' onClick={onBack}>
          Back
        </button>
      </section>
    ),
  })
)

// The modal's own picker logic is covered by import-modal.test.tsx; here it is
// reduced to "open?" plus a way to confirm the chosen profile.
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/browser/components/import-modal/import-modal',
  () => ({
    ImportModal: ({
      open,
      profiles,
      pending,
      onImport,
    }: {
      open: boolean
      profiles: BrowserImportProfile[]
      pending: boolean
      onImport: (profile: BrowserImportProfile) => void
    }) =>
      open ? (
        <div role='dialog' aria-label='Import from your browser'>
          <span>{`${profiles.length} profiles`}</span>
          <button type='button' disabled={pending} onClick={() => onImport(profiles[1])}>
            Confirm import
          </button>
        </div>
      ) : null,
  })
)

import { Browser } from '@/app/workspace/[workspaceId]/settings/components/browser/browser'

const PROFILES: BrowserImportProfile[] = [
  {
    id: 'chrome:Default',
    label: 'Chrome',
    browserId: 'chrome',
    browserLabel: 'Chrome',
    profileLabel: 'Default',
  },
  {
    id: 'arc:Profile 2',
    label: 'Arc · Microtrades',
    browserId: 'arc',
    browserLabel: 'Arc',
    profileLabel: 'Microtrades',
  },
]

const CREDENTIALS: BrowserCredentialMetadata[] = [
  {
    id: 'c1',
    origin: 'https://example.com',
    username: 'ada@example.com',
    createdAt: '',
    updatedAt: '',
    source: 'chrome',
  },
]

const IMPORTED_BOTH: BrowserChromeImportResult = {
  cookies: { cookiesImported: 12, cookiesSkipped: 3 },
  passwords: { passwordsAdded: 4, passwordsUpdated: 1, passwordsSkipped: 2 },
}

interface BridgeOverrides {
  browserEnabled?: boolean
  browserSearchSuggestionsEnabled?: boolean
  browserTheme?: 'app' | 'light' | 'dark'
  browserDefaultZoom?: DesktopZoomPercent
  browserDownloadDirectory?: string
  chosenBrowserDownloadDirectory?: string
  profiles?: BrowserImportProfile[]
  importResult?: BrowserChromeImportResult
  listProfilesFails?: boolean
  vaultAvailable?: boolean
}

function createBridge({
  browserEnabled = true,
  browserSearchSuggestionsEnabled = true,
  browserTheme = 'app',
  browserDefaultZoom = 100,
  browserDownloadDirectory = '/Users/sim/Downloads',
  chosenBrowserDownloadDirectory = '/Users/sim/Desktop/Browser files',
  profiles = PROFILES,
  importResult = IMPORTED_BOTH,
  listProfilesFails = false,
  vaultAvailable = true,
}: BridgeOverrides = {}) {
  const preferences = {
    notificationsEnabled: true,
    notificationSounds: true,
    notificationsOnlyWhenUnfocused: true,
    launchAtLogin: false,
    autoDownloadUpdates: true,
    browserEnabled,
    browserSearchSuggestionsEnabled,
    browserTheme,
    browserDefaultZoom,
    browserDownloadDirectory,
  }
  return {
    settings: {
      getPreferences: vi.fn(async () => preferences),
      setBrowserEnabled: vi.fn(),
      setBrowserSearchSuggestionsEnabled: vi.fn(async (enabled: boolean) => ({
        ...preferences,
        browserSearchSuggestionsEnabled: enabled,
      })),
      setBrowserTheme: vi.fn(async (theme: 'app' | 'light' | 'dark') => ({
        ...preferences,
        browserTheme: theme,
      })),
      setBrowserDefaultZoom: vi.fn(async (zoom: DesktopZoomPercent) => ({
        ...preferences,
        browserDefaultZoom: zoom,
      })),
      chooseBrowserDownloadDirectory: vi.fn(async () => ({
        ...preferences,
        browserDownloadDirectory: chosenBrowserDownloadDirectory,
      })),
    },
    browserAgent: {
      clearBrowsingData: vi.fn(async () => ({ sessions: [{ hostname: 'left.test' }] })),
    },
    browserImport: {
      listChromeProfiles: vi.fn(async (): Promise<BrowserImportProfile[]> => {
        if (listProfilesFails) throw new Error('unreadable')
        return profiles
      }),
      importFromChrome: vi.fn(async (): Promise<BrowserChromeImportResult> => importResult),
    },
    browserCredentials: {
      isAvailable: vi.fn(async () => vaultAvailable),
      list: vi.fn(async () => CREDENTIALS),
      forget: vi.fn(async () => []),
    },
  }
}

let container: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(<Browser />)
  })
}

function buttonLabelled(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text
  )
  if (!button) throw new Error(`No button labelled "${text}"`)
  return button
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const importDialog = () => container.querySelector('[aria-label="Import from your browser"]')

describe('Browser settings', () => {
  it('keeps browser controls together in one General section', async () => {
    await render()

    expect(container.querySelector('section[aria-label="General"]')).not.toBeNull()
    expect(container.querySelector('section[aria-label="Agent browser"]')).toBeNull()
    expect(container.querySelector('section[aria-label="Appearance"]')).toBeNull()
    expect(container.querySelector('section[aria-label="Downloads"]')).toBeNull()
    expect(container.querySelector('section[aria-label="Saved passwords"]')).toBeNull()
  })

  it('uses concise setting labels without explanatory footer copy', async () => {
    await render()

    expect(container.textContent).toContain('Let Chat browse the web')
    expect(container.textContent).toContain('Theme')
    expect(container.textContent).toContain('Search suggestions')
    expect(container.textContent).not.toContain(
      'Pages open in a browser built into Sim, signed in separately from your own.'
    )
    expect(container.textContent).not.toContain('Website theme')
    expect(container.textContent).not.toContain('Supported websites use this appearance')
    expect(container.textContent).not.toContain('signed in or holding cookies')
    expect(container.textContent).not.toContain('Saved passwords are never deleted here')
  })

  it('explains and persists the live-search privacy switch', async () => {
    const bridge = createBridge({ browserSearchSuggestionsEnabled: true })
    mockBridge.current = bridge
    await render()

    expect(container.textContent).toContain(
      'Send address-bar typing to Google for live completions'
    )
    const switches = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')

    await click(switches[1])

    expect(bridge.settings.setBrowserSearchSuggestionsEnabled).toHaveBeenCalledWith(false)
  })

  it('persists an independent website theme', async () => {
    const bridge = createBridge({ browserTheme: 'app' })
    mockBridge.current = bridge
    await render()

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Browser theme"]')
    expect(select?.value).toBe('app')

    await act(async () => {
      if (!select) throw new Error('Missing browser theme selector')
      select.value = 'dark'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(bridge.settings.setBrowserTheme).toHaveBeenCalledWith('dark')
    expect(select?.value).toBe('dark')
  })

  it('persists the default browser zoom', async () => {
    const bridge = createBridge({ browserDefaultZoom: 100 })
    mockBridge.current = bridge
    await render()

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Default zoom"]')
    expect(select?.value).toBe('100')

    await act(async () => {
      if (!select) throw new Error('Missing default zoom selector')
      select.value = '125'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(bridge.settings.setBrowserDefaultZoom).toHaveBeenCalledWith(125)
    expect(select?.value).toBe('125')
  })

  it('shows and changes the browser download location', async () => {
    const bridge = createBridge()
    mockBridge.current = bridge
    await render()

    const section = container.querySelector('section[aria-label="General"]')
    expect(section?.textContent).toContain('/Users/sim/Downloads')

    await click(buttonLabelled('Change'))

    expect(bridge.settings.chooseBrowserDownloadDirectory).toHaveBeenCalledTimes(1)
    expect(section?.textContent).toContain('/Users/sim/Desktop/Browser files')
  })

  it('reaches both sub-pages from the header', async () => {
    await render()

    expect([...container.querySelectorAll('header button')].map((b) => b.textContent)).toEqual([
      'Passwords',
      'Clear all',
    ])
  })

  it('lists each data type as a standard settings row in one section', async () => {
    await render()

    const section = container.querySelector('section[aria-label="Browsing data"]')
    expect(section).not.toBeNull()

    const labels = [...(section?.querySelectorAll('span') ?? [])].map((s) => s.textContent)
    for (const label of ['Cookies', 'Site data', 'Cached images and files']) {
      expect(labels).toContain(label)
    }
    expect([...(section?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Delete cookies',
      'Delete site data',
      'Delete cached images and files',
    ])
  })

  it.each([
    ['Delete cookies', ['cookies']],
    ['Delete site data', ['site-data']],
    ['Delete cached images and files', ['cache']],
  ])('%s clears only that kind, after confirmation', async (action, kinds) => {
    const bridge = createBridge()
    mockBridge.current = bridge
    await render()

    await click(buttonLabelled(action))
    expect(bridge.browserAgent.clearBrowsingData).not.toHaveBeenCalled()

    const confirm = [...container.querySelectorAll('[role="dialog"] button')].at(-1)
    await click(confirm as HTMLButtonElement)

    expect(bridge.browserAgent.clearBrowsingData).toHaveBeenCalledWith(kinds)
  })

  it('clears every kind from the header action', async () => {
    const bridge = createBridge()
    mockBridge.current = bridge
    await render()

    await click(buttonLabelled('Clear all'))
    const confirm = [...container.querySelectorAll('[role="dialog"] button')].at(-1)
    await click(confirm as HTMLButtonElement)

    expect(bridge.browserAgent.clearBrowsingData).toHaveBeenCalledWith([
      'cookies',
      'site-data',
      'cache',
    ])
  })

  it('spells out the consequence and spares saved passwords in the confirmation', async () => {
    await render()

    await click(buttonLabelled('Delete cookies'))

    const dialog = container.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(dialog).toContain('sign the browser out of every site')
    expect(dialog).toContain('saved passwords are not affected')
  })

  it('surfaces a failure instead of implying data was deleted', async () => {
    const bridge = createBridge()
    bridge.browserAgent.clearBrowsingData = vi.fn(async () => {
      throw new Error('locked')
    }) as typeof bridge.browserAgent.clearBrowsingData
    mockBridge.current = bridge
    await render()

    await click(buttonLabelled('Delete cookies'))
    const confirm = [...container.querySelectorAll('[role="dialog"] button')].at(-1)
    await click(confirm as HTMLButtonElement)

    expect(mockToast.error).toHaveBeenCalledWith('Could not delete browsing data')
  })

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

  it('opens the manager from the header rather than inlining it', async () => {
    await render()
    expect(container.querySelector('[aria-label="Passwords view"]')).toBeNull()

    await click(buttonLabelled('Passwords'))

    expect(container.querySelector('[aria-label="Passwords view"]')?.textContent).toContain(
      '1 saved'
    )
  })

  it('returns to the browser page from the manager', async () => {
    await render()
    await click(buttonLabelled('Passwords'))

    await click(buttonLabelled('Back'))

    expect(container.querySelector('[aria-label="Passwords view"]')).toBeNull()
    expect(container.querySelector('section[aria-label="General"]')).not.toBeNull()
  })
})
