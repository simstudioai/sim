import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { sleep } from '@sim/utils/helpers'
import type { BrowserWindow, WebContents } from 'electron'
import { Menu } from 'electron'
import { FillCoordinator } from '@/main/browser-credentials/fill'
import type { CredentialVault } from '@/main/browser-credentials/vault'

const ORIGIN = 'https://example.com'
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
  const coordinator = new FillCoordinator({
    vault: vault as unknown as CredentialVault,
    getActiveContents: () => active as unknown as WebContents | null,
    onAvailabilityChanged,
  })
  return {
    coordinator,
    contents,
    vault,
    onAvailabilityChanged,
    setActive: (next: Contents | null) => {
      active = next
    },
  }
}

/** Reports a login form, opens the chooser, and returns its menu template. */
async function openChooser(context: ReturnType<typeof setup>) {
  context.coordinator.noteFormState(context.contents as unknown as WebContents, {
    origin: ORIGIN,
    hasLoginForm: true,
  })
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
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(true)
  })

  it.each([
    ['there is no login form', { hasLoginForm: false }],
    ['the page origin cannot hold a credential', { origin: 'about:blank' }],
  ])('is unavailable when %s', async (_label, report) => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
      ...report,
    })

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('is unavailable with no saved credential for the origin', async () => {
    const context = setup(fakeContents(), fakeVault({ listForOrigin: vi.fn(async () => []) }))
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('is unavailable when secure storage is unavailable', async () => {
    const context = setup(fakeContents(), fakeVault({ isAvailable: vi.fn(() => false) }))
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('drops to unavailable as soon as the page navigates', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })

    context.coordinator.noteNavigation(context.contents as unknown as WebContents)

    await expect(context.coordinator.isFillAvailable()).resolves.toBe(false)
  })

  it('forgets a closed tab', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })

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
    noMatches.coordinator.noteFormState(noMatches.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })
    await expect(noMatches.coordinator.showChooser(WINDOW, { x: 0, y: 0 })).resolves.toBe(false)
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
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
      hasPasswordField: false,
    })
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

  it('sends the password to a shell that never reported whether a field exists', async () => {
    const context = setup()
    // Older preloads omit the flag; assuming a password field keeps them working.
    context.coordinator.noteFormState(context.contents as unknown as WebContents, {
      origin: ORIGIN,
      hasLoginForm: true,
    })
    await context.coordinator.showChooser(WINDOW, { x: 10, y: 20 })
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as Array<{
      click: () => void
    }>

    template[0].click()
    await settle()

    expect(context.contents.send).toHaveBeenCalledWith(
      'browser-credentials:fill',
      expect.objectContaining({ password: 'hunter2' })
    )
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
