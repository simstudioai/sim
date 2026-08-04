import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { sleep } from '@sim/utils/helpers'
import type { BrowserWindow, WebContents } from 'electron'
import { Menu } from 'electron'
import { FillCoordinator } from '@/main/browser-credentials/fill'
import type { CredentialVault } from '@/main/browser-credentials/vault'

const ORIGIN = 'https://example.com'
const SCOPE = 'chat-a'
const WINDOW = {} as BrowserWindow

function fakeContents(url = `${ORIGIN}/login`) {
  return {
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  }
}

function fakeVault(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isAvailable: vi.fn(() => true),
    listForOrigin: vi.fn(async () => [
      {
        id: 'c1',
        origin: ORIGIN,
        username: 'ada',
        createdAt: '',
        updatedAt: '',
        source: 'chrome' as const,
      },
    ]),
    readForFill: vi.fn(async () => ({ username: 'ada', password: 'hunter2' })),
    ...overrides,
  }
}

type Contents = ReturnType<typeof fakeContents>

function setup(contents: Contents = fakeContents(), vault = fakeVault()) {
  const onAvailabilityChanged = vi.fn()
  let active: Contents | null = contents
  let activeScope = SCOPE
  const contentsScopes = new WeakMap<object, string>()
  contentsScopes.set(contents, SCOPE)
  const coordinator = new FillCoordinator({
    vault: vault as unknown as CredentialVault,
    getActiveContents: (scopeId) =>
      !scopeId || scopeId === activeScope ? (active as unknown as WebContents | null) : null,
    scopeOwnsContents: (scopeId, candidate) => contentsScopes.get(candidate) === scopeId,
    onAvailabilityChanged,
  })
  return {
    coordinator,
    contents,
    vault,
    onAvailabilityChanged,
    setActive: (next: Contents | null, scopeId = SCOPE) => {
      active = next
      activeScope = scopeId
      if (next) contentsScopes.set(next, scopeId)
    },
  }
}

function loginFormState(
  overrides: Partial<{
    origin: string
    hasLoginForm: boolean
    hasPasswordField: boolean
  }> = {}
) {
  return {
    origin: ORIGIN,
    hasLoginForm: true,
    hasPasswordField: true,
    ...overrides,
  }
}

/** Reports a login form, opens the chooser, and returns its menu template. */
async function openChooser(context: ReturnType<typeof setup>) {
  context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
  await context.coordinator.showChooser(WINDOW, { x: 10, y: 20 })
  const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as
    | Array<{ label: string; click: () => void }>
    | undefined
  return template ?? []
}

/**
 * Menu clicks are fire-and-forget, so a test has to wait for the fill's
 * promise chain to finish on its own.
 *
 * Several ticks rather than one: the chain awaits the vault and then
 * revalidates, and a single macrotask was enough to make this flaky on a
 * loaded machine — the assertion ran before the chain reached `send`.
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick++) {
    await sleep(0)
  }
}

beforeEach(() => {
  vi.mocked(Menu.buildFromTemplate).mockClear()
})

describe('fill availability', () => {
  it('is available once a login form has a saved match', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(true)
  })

  it('replays the active tab availability when its chat is reactivated', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await settle()
    context.onAvailabilityChanged.mockClear()

    await context.coordinator.refreshAvailability()
    expect(context.onAvailabilityChanged).not.toHaveBeenCalled()

    await context.coordinator.refreshAvailability(true)
    expect(context.onAvailabilityChanged).toHaveBeenCalledWith(true, context.contents)
  })

  it('does not publish a stale match after the page navigates', async () => {
    let resolveMatches!: (matches: Awaited<ReturnType<CredentialVault['listForOrigin']>>) => void
    const listForOrigin = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<CredentialVault['listForOrigin']>>>((resolve) => {
          resolveMatches = resolve
        })
    )
    const context = setup(fakeContents(), fakeVault({ listForOrigin }))

    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    await settle()
    resolveMatches([
      {
        id: 'c1',
        origin: ORIGIN,
        username: 'ada',
        createdAt: '',
        updatedAt: '',
        source: 'chrome',
      },
    ])
    await settle()

    expect(context.onAvailabilityChanged.mock.calls).toEqual([[false, context.contents]])
  })

  it('does not publish an old tab after the active tab changes', async () => {
    let resolveMatches!: (matches: Awaited<ReturnType<CredentialVault['listForOrigin']>>) => void
    const listForOrigin = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<CredentialVault['listForOrigin']>>>((resolve) => {
          resolveMatches = resolve
        })
    )
    const context = setup(fakeContents(), fakeVault({ listForOrigin }))
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    context.setActive(fakeContents('https://other.example/login'))
    resolveMatches([
      {
        id: 'c1',
        origin: ORIGIN,
        username: 'ada',
        createdAt: '',
        updatedAt: '',
        source: 'chrome',
      },
    ])
    await settle()

    expect(context.onAvailabilityChanged).not.toHaveBeenCalled()
  })

  it.each([
    ['there is no login form', { hasLoginForm: false }],
    ['the page origin cannot hold a credential', { origin: 'about:blank' }],
  ])('is unavailable when %s', async (_label, report) => {
    const context = setup()
    context.coordinator.noteFormState(
      context.contents as unknown as WebContents,
      loginFormState(report)
    )

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('is unavailable with no saved credential for the origin', async () => {
    const context = setup(fakeContents(), fakeVault({ listForOrigin: vi.fn(async () => []) }))
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('is unavailable when secure storage is unavailable', async () => {
    const context = setup(fakeContents(), fakeVault({ isAvailable: vi.fn(() => false) }))
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('drops to unavailable as soon as the page navigates', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    context.coordinator.noteNavigation(context.contents as unknown as WebContents)

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('requests a fresh page report after same-document navigation', () => {
    const context = setup()

    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    expect(context.contents.send).not.toHaveBeenCalledWith('browser-credentials:rescan')

    context.coordinator.noteNavigation(context.contents as unknown as WebContents, true)
    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:rescan')
  })

  it('forgets a closed tab', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    context.coordinator.forget(context.contents as unknown as WebContents)

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })
})

describe('credential chooser', () => {
  it('lists usernames without reading any password', async () => {
    const context = setup()
    const template = await openChooser(context)

    expect(template.map((item) => item.label)).toEqual(['ada'])
    expect(context.vault.readForFill).not.toHaveBeenCalled()
  })

  it('refuses to open without a login form or a match', async () => {
    const context = setup()
    await expect(context.coordinator.showChooser(WINDOW, { x: 0, y: 0 })).resolves.toBe(false)

    const noMatches = setup(fakeContents(), fakeVault({ listForOrigin: vi.fn(async () => []) }))
    noMatches.coordinator.noteFormState(
      noMatches.contents as unknown as WebContents,
      loginFormState()
    )
    await expect(noMatches.coordinator.showChooser(WINDOW, { x: 0, y: 0 })).resolves.toBe(false)
  })
})

describe('renderer credential chooser', () => {
  it('lists only matching metadata and never reads a password', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    await expect(context.coordinator.listFillOptions(SCOPE)).resolves.toEqual([
      expect.objectContaining({ id: 'c1', origin: ORIGIN, username: 'ada' }),
    ])
    expect(context.vault.listForOrigin).toHaveBeenCalledWith(ORIGIN)
    expect(context.vault.readForFill).not.toHaveBeenCalled()
  })

  it('refuses to list options for a scope that does not own the active tab', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await settle()
    context.vault.listForOrigin.mockClear()

    await expect(context.coordinator.listFillOptions('chat-b')).resolves.toEqual([])
    expect(context.vault.listForOrigin).not.toHaveBeenCalled()
  })

  it('fills one selected option and consumes its authorization', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await context.coordinator.listFillOptions(SCOPE)

    await expect(context.coordinator.fillCredential('c1', SCOPE)).resolves.toBe(true)
    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:fill', {
      origin: ORIGIN,
      username: 'ada',
      password: 'hunter2',
    })
    await expect(context.coordinator.fillCredential('c1', SCOPE)).resolves.toBe(false)
    expect(context.contents.send).toHaveBeenCalledTimes(1)
  })

  it('refuses an id that was not in the matching option list', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await context.coordinator.listFillOptions(SCOPE)

    await expect(context.coordinator.fillCredential('other', SCOPE)).resolves.toBe(false)
    expect(context.vault.readForFill).not.toHaveBeenCalled()
  })

  it('invalidates a renderer selection when the page navigates', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await context.coordinator.listFillOptions(SCOPE)

    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())

    await expect(context.coordinator.fillCredential('c1', SCOPE)).resolves.toBe(false)
    expect(context.vault.readForFill).not.toHaveBeenCalled()
  })

  it('revalidates the active scope after the vault read begins', async () => {
    let releaseRead: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const vault = fakeVault({
      readForFill: vi.fn(async () => {
        await pending
        return { username: 'ada', password: 'hunter2' }
      }),
    })
    const context = setup(fakeContents(), vault)
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await context.coordinator.listFillOptions(SCOPE)

    const fill = context.coordinator.fillCredential('c1', SCOPE)
    await settle()
    context.setActive(fakeContents('https://other.test/login'), 'chat-b')
    releaseRead()

    await expect(fill).resolves.toBe(false)
    expect(context.contents.send).not.toHaveBeenCalled()
  })
})

describe('performing a fill', () => {
  it('sends the credential to the page the user chose it for', async () => {
    const context = setup()
    const template = await openChooser(context)

    template[0].click()
    await settle()

    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:fill', {
      origin: ORIGIN,
      username: 'ada',
      password: 'hunter2',
    })
  })

  it('fills the email step of a two-step sign-in without sending the password', async () => {
    const context = setup()
    context.coordinator.noteFormState(
      context.contents as unknown as WebContents,
      loginFormState({ hasPasswordField: false })
    )
    await context.coordinator.showChooser(WINDOW, { x: 10, y: 20 })
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as Array<{
      click: () => void
    }>

    template[0].click()
    await settle()

    // The page has nowhere to put a password, so it does not get one.
    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:fill', {
      origin: ORIGIN,
      username: 'ada',
      password: undefined,
    })
  })

  it('refuses after the page navigated between choosing and clicking', async () => {
    const context = setup()
    const template = await openChooser(context)

    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    template[0].click()
    await settle()

    expect(context.vault.readForFill).not.toHaveBeenCalled()
    expect(context.contents.send).not.toHaveBeenCalled()
  })

  it('refuses when the live document is no longer the origin that was reported', async () => {
    // The preload's report is a claim. If the tab is actually somewhere else
    // now, the password must not follow it.
    const context = setup()
    const template = await openChooser(context)
    context.contents.getURL.mockReturnValue('https://evil.test/login')

    template[0].click()
    await settle()

    expect(context.vault.readForFill).not.toHaveBeenCalled()
    expect(context.contents.send).not.toHaveBeenCalled()
  })

  it('refuses when the user switched to another tab', async () => {
    const context = setup()
    const template = await openChooser(context)
    context.setActive(fakeContents())

    template[0].click()
    await settle()

    expect(context.contents.send).not.toHaveBeenCalled()
  })

  it('refuses when the tab was destroyed', async () => {
    const context = setup()
    const template = await openChooser(context)
    context.contents.isDestroyed.mockReturnValue(true)

    template[0].click()
    await settle()

    expect(context.contents.send).not.toHaveBeenCalled()
  })

  it('refuses when the page navigates during the vault read', async () => {
    // Reading the vault is asynchronous, so the document can change inside it.
    // Revalidating only before the read would let the password land on the
    // page that replaced the one the user was looking at.
    let releaseRead: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const vault = fakeVault({
      readForFill: vi.fn(async () => {
        await pending
        return { username: 'ada', password: 'hunter2' }
      }),
    })
    const context = setup(fakeContents(), vault)
    const template = await openChooser(context)

    template[0].click()
    await settle()
    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    releaseRead()
    await settle()

    expect(context.vault.readForFill).toHaveBeenCalled()
    expect(context.contents.send).not.toHaveBeenCalled()
  })

  it('refuses when the vault no longer holds the chosen credential', async () => {
    const context = setup(fakeContents(), fakeVault({ readForFill: vi.fn(async () => null) }))
    const template = await openChooser(context)

    template[0].click()
    await settle()

    expect(context.contents.send).not.toHaveBeenCalled()
  })
})
