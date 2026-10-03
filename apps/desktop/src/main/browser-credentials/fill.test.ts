import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { sleep } from '@sim/utils/helpers'
import { BrowserWindow, type WebContents } from 'electron'
import { FillCoordinator, type FillCoordinatorDeps } from '@/main/browser-credentials/fill'
import type { CredentialPicker } from '@/main/browser-credentials/picker'
import type { CredentialVault } from '@/main/browser-credentials/vault'
import type { CredentialFormReport } from '@/shared/browser-credentials'

const ORIGIN = 'https://example.com'
const SCOPE = 'chat-a'
const WINDOW = Object.assign(new BrowserWindow(), {
  getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  isDestroyed: () => false,
  isVisible: () => true,
  isMinimized: () => false,
  isFocused: () => true,
  focus: vi.fn(),
})

const { pickerOptions, pickerFocus } = vi.hoisted(() => ({
  pickerOptions: vi.fn(),
  pickerFocus: vi.fn(),
}))
vi.mock('@/main/browser-credentials/picker', () => ({
  CredentialPicker: class {
    constructor(private readonly options: ConstructorParameters<typeof CredentialPicker>[0]) {
      pickerOptions(options)
    }
    close() {
      this.options.closed()
    }
    position() {}
    focus() {
      pickerFocus()
    }
  },
}))

function fakeContents(url = `${ORIGIN}/login`) {
  return {
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    focus: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(
  contents: Contents = fakeContents(),
  vault = fakeVault(),
  pickerHost?: FillCoordinatorDeps['pickerHost']
) {
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
    pickerHost,
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

function loginFormState(overrides: Partial<CredentialFormReport> = {}) {
  return {
    origin: ORIGIN,
    targetId: 'target-1',
    bounds: null,
    hasLoginForm: true,
    hasPasswordField: true,
    ...overrides,
  }
}

/** Reports a login form, opens the chooser, and returns its menu template. */
async function openChooser(context: ReturnType<typeof setup>) {
  context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
  await context.coordinator.showChooser(WINDOW, { x: 10, y: 20 })
  const options = pickerOptions.mock.calls.at(-1)?.[0] as ConstructorParameters<
    typeof CredentialPicker
  >[0]
  return options.configuration.accounts.map((account) => ({
    label: account.username,
    click: () => options.select(account.id),
  }))
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
  pickerOptions.mockClear()
  pickerFocus.mockClear()
})

describe('fill availability', () => {
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
})

describe('credential chooser', () => {
  it.each(['hidden', 'minimized', 'unfocused'])(
    'does not open when the parent becomes %s during a metadata lookup',
    async (state) => {
      const context = setup()
      context.coordinator.noteFormState(
        context.contents as unknown as WebContents,
        loginFormState()
      )
      const matches = await context.vault.listForOrigin()
      const pending = deferred<typeof matches>()
      context.vault.listForOrigin.mockReturnValueOnce(pending.promise)
      let available = true
      const window = Object.assign(new BrowserWindow(), {
        ...WINDOW,
        isVisible: () => state !== 'hidden' || available,
        isMinimized: () => state === 'minimized' && !available,
        isFocused: () => state !== 'unfocused' || available,
      })
      const opened = context.coordinator.showChooser(window, { x: 0, y: 0 })
      available = false
      pending.resolve(matches)
      await expect(opened).resolves.toBe(false)
      expect(pickerOptions).not.toHaveBeenCalled()
    }
  )
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

    const result = context.coordinator.fillCredential('c1', SCOPE)
    await settle()
    const request = context.contents.send.mock.calls.at(-1)?.[1]
    context.coordinator.noteFillResult(context.contents as unknown as WebContents, {
      requestId: request.requestId,
      status: 'filled',
    })
    await expect(result).resolves.toBe(true)
    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:fill', {
      requestId: expect.any(String),
      targetId: 'target-1',
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
})

describe('performing a fill', () => {
  it('sends the credential to the page the user chose it for', async () => {
    const context = setup()
    const template = await openChooser(context)

    void template[0].click()
    await settle()

    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:fill', {
      requestId: expect.any(String),
      targetId: 'target-1',
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
    const options = pickerOptions.mock.calls.at(-1)![0] as ConstructorParameters<
      typeof CredentialPicker
    >[0]
    void options.select('c1')
    await settle()

    // The page has nowhere to put a password, so it does not get one.
    expect(context.contents.send).toHaveBeenCalledWith('browser-credentials:fill', {
      requestId: expect.any(String),
      targetId: 'target-1',
      origin: ORIGIN,
      username: 'ada',
      password: undefined,
    })
  })

  it('refuses after the page navigated between choosing and clicking', async () => {
    const context = setup()
    const template = await openChooser(context)

    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    void template[0].click()
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

    void template[0].click()
    await settle()

    expect(context.vault.readForFill).not.toHaveBeenCalled()
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

    void template[0].click()
    await settle()
    context.coordinator.noteNavigation(context.contents as unknown as WebContents)
    releaseRead()
    await settle()

    expect(context.vault.readForFill).toHaveBeenCalled()
    expect(context.contents.send).not.toHaveBeenCalled()
  })
})

describe('fill acknowledgements and target freshness', () => {
  async function start() {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await context.coordinator.listFillOptions(SCOPE)
    const result = context.coordinator.fillCredential('c1', SCOPE)
    await settle()
    const request = context.contents.send.mock.calls.at(-1)![1]
    return { ...context, result, request }
  }

  it('does not report success merely because IPC was sent', async () => {
    const context = await start()
    let settled = false
    void context.result.then(() => {
      settled = true
    })
    context.coordinator.noteFillResult(context.contents as unknown as WebContents, {
      requestId: 'wrong-request',
      status: 'filled',
    })
    context.coordinator.noteFillResult(fakeContents() as unknown as WebContents, {
      requestId: context.request.requestId,
      status: 'filled',
    })
    await settle()
    expect(settled).toBe(false)
    context.coordinator.noteFillResult(context.contents as unknown as WebContents, {
      requestId: context.request.requestId,
      status: 'failed',
    })
    await expect(context.result).resolves.toBe(false)
  })

  it('invalidates selection before reading secrets when a form is replaced', async () => {
    const context = setup()
    await openChooser(context)
    context.coordinator.noteFormState(
      context.contents as unknown as WebContents,
      loginFormState({ targetId: 'replacement' })
    )
    await expect(context.coordinator.fillCredential('c1', SCOPE)).resolves.toBe(false)
    expect(context.vault.readForFill).not.toHaveBeenCalled()
  })
})
