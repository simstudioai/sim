/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { mockBridge, mockSearch, mockToast } = vi.hoisted(() => ({
  mockBridge: { current: null as unknown },
  mockSearch: { value: '' },
  mockToast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@sim/emcn', () => ({
  /** `SettingsResourceRow` composes its tile classes with `cn`. */
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  ArrowLeft: () => <span />,
  ArrowRight: () => <span />,
  ChipConfirmModal: ({
    open,
    title,
    confirm,
  }: {
    open: boolean
    title: string
    confirm: { label: string; onClick: () => void }
  }) =>
    open ? (
      <div role='dialog' aria-label={title}>
        <button type='button' onClick={confirm.onClick}>{`Confirm ${confirm.label}`}</button>
      </div>
    ) : null,
  Key: () => <span />,
  OverflowText: ({ label, children }: { label: string; children?: ReactNode }) => (
    <span>{children ?? label}</span>
  ),
  Plus: () => <span />,
  toast: mockToast,
}))

vi.mock('@/lib/desktop', () => ({ getDesktopBridge: () => mockBridge.current }))

vi.mock('@/app/workspace/[workspaceId]/settings/components/use-settings-search', () => ({
  useSettingsSearch: () => [mockSearch.value, vi.fn()],
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    back,
    actions,
  }: {
    children: ReactNode
    back?: { text: string; onSelect: () => void }
    actions?: Array<{ text: string; onSelect: () => void; disabled?: boolean }>
  }) => (
    <main>
      <header>
        {back ? (
          <button type='button' onClick={back.onSelect}>
            {back.text}
          </button>
        ) : null}
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
  '@/app/workspace/[workspaceId]/settings/components/settings-empty-state/settings-empty-state',
  () => ({ SettingsEmptyState: ({ children }: { children: ReactNode }) => <p>{children}</p> })
)

vi.mock('@/components/browser-import/browser-import-dialog', () => ({
  BrowserImportDialog: ({ open, onImported }: { open: boolean; onImported: () => void }) =>
    open ? (
      <div role='dialog' aria-label='Import from your browser'>
        <button type='button' onClick={onImported}>
          Confirm import
        </button>
      </div>
    ) : null,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/browser/components/password-detail/password-detail',
  () => ({
    PasswordDetail: ({ credential }: { credential: BrowserCredentialMetadata }) => (
      <section aria-label='Password detail'>{credential.origin}</section>
    ),
  })
)

import { PasswordsView } from '@/app/workspace/[workspaceId]/settings/components/browser/components/passwords-view/passwords-view'

function credential(id: string, origin: string, username: string): BrowserCredentialMetadata {
  return { id, origin, username, createdAt: '', updatedAt: '', source: 'chrome' }
}

const CREDENTIALS = [
  credential('c1', 'https://example.com', 'ada@example.com'),
  credential('c2', 'https://fubo.tv', 'grace'),
]

function createBridge({ profiles = [{ id: 'chrome:Default', label: 'Chrome' }] } = {}) {
  return {
    browserCredentials: {
      forgetAll: vi.fn(async () => []),
      forget: vi.fn(async () => []),
      reveal: vi.fn(async () => 'hunter2'),
      copy: vi.fn(async () => true),
    },
    browserImport: {
      listChromeProfiles: vi.fn(async () => profiles),
      importFromChrome: vi.fn(async () => ({
        cookies: { cookiesImported: 4, cookiesSkipped: 0 },
        passwords: { passwordsAdded: 2, passwordsUpdated: 1, passwordsSkipped: 0 },
      })),
    },
  }
}

let container: HTMLDivElement
let root: Root
let onChange: ReturnType<typeof vi.fn>
let onBack: ReturnType<typeof vi.fn>
let onImported: ReturnType<typeof vi.fn>

async function render(credentials = CREDENTIALS) {
  await act(async () => {
    root.render(
      <PasswordsView
        credentials={credentials}
        onChange={onChange}
        onBack={onBack}
        onImported={onImported}
      />
    )
  })
}

const bridge = () => mockBridge.current as ReturnType<typeof createBridge>

describe('PasswordsView', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onChange = vi.fn()
    onBack = vi.fn()
    onImported = vi.fn(async () => {})
    mockSearch.value = ''
    mockBridge.current = createBridge()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('never shows a password in the list', async () => {
    // Reading one happens on the detail page, behind Touch ID.
    await render()

    expect(container.textContent).not.toContain('hunter2')
    expect(bridge().browserCredentials.reveal).not.toHaveBeenCalled()
  })
})
