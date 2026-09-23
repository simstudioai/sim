import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { sleep } from '@sim/utils/helpers'
import type { BrowserWindow, WebContents } from 'electron'
import { FillCoordinator } from '@/main/browser-credentials/fill'
import type { CredentialPicker } from '@/main/browser-credentials/picker'
import type { CredentialVault } from '@/main/browser-credentials/vault'
import type { CredentialFormReport } from '@/shared/browser-credentials'

const ORIGIN = 'https://example.com'
const SCOPE = 'chat-a'
const WINDOW = {
  getContentBounds: () => ({ x: 0, y: 0 }),
  isDestroyed: () => false,
} as BrowserWindow

const { pickerOptions } = vi.hoisted(() => ({ pickerOptions: vi.fn() }))
vi.mock('@/main/browser-credentials/picker', () => ({
  CredentialPicker: class {
    constructor(private readonly options: ConstructorParameters<typeof CredentialPicker>[0]) {
      pickerOptions(options)
    }
    close() {
      this.options.closed()
    }
    position() {}
    focus() {}
  },
}))

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

  it('refuses when the user switched to another tab', async () => {
    const context = setup()
    const template = await openChooser(context)
    context.setActive(fakeContents())

    void template[0].click()
    await settle()

    expect(context.contents.send).not.toHaveBeenCalled()
  })

  it('refuses when the tab was destroyed', async () => {
    const context = setup()
    const template = await openChooser(context)
    context.contents.isDestroyed.mockReturnValue(true)

    void template[0].click()
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

    void template[0].click()
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

    void template[0].click()
    await settle()

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

  it('invalidates an in-flight fill when the selected form changes', async () => {
    const context = await start()
    context.coordinator.noteFormState(
      context.contents as unknown as WebContents,
      loginFormState({ targetId: 'replacement' })
    )
    context.coordinator.noteFillResult(context.contents as unknown as WebContents, {
      requestId: context.request.requestId,
      status: 'filled',
    })
    await expect(context.result).resolves.toBe(false)
  })

  it('expires an unacknowledged fill', async () => {
    vi.useFakeTimers()
    try {
      const context = setup()
      context.coordinator.noteFormState(
        context.contents as unknown as WebContents,
        loginFormState()
      )
      await context.coordinator.listFillOptions(SCOPE)
      const result = context.coordinator.fillCredential('c1', SCOPE)
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(result).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
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

describe('native picker lifetime', () => {
  it('survives unchanged browser visibility heartbeats', async () => {
    const context = setup()
    await openChooser(context)
    await context.coordinator.refreshAvailability(true)
    const options = pickerOptions.mock.calls.at(-1)![0] as ConstructorParameters<
      typeof CredentialPicker
    >[0]
    const result = options.select('c1')
    await settle()
    const request = context.contents.send.mock.calls.at(-1)![1]
    context.coordinator.noteFillResult(context.contents as unknown as WebContents, {
      requestId: request.requestId,
      status: 'filled',
    })
    await expect(result).resolves.toBe('filled')
  })

  it.each(['dismiss', 'dispose', 'closed'] as const)(
    'cancels a vault read after %s',
    async (action) => {
      let resolve!: (value: { username: string; password: string }) => void
      const promise = new Promise<{ username: string; password: string }>((done) => {
        resolve = done
      })
      const context = setup(fakeContents(), fakeVault({ readForFill: vi.fn(() => promise) }))
      await openChooser(context)
      const options = pickerOptions.mock.calls.at(-1)![0] as ConstructorParameters<
        typeof CredentialPicker
      >[0]
      const result = options.select('c1')
      if (action === 'dispose') context.coordinator.dispose()
      else if (action === 'closed') options.closed()
      else context.coordinator.dismissPicker()
      resolve({ username: 'ada', password: 'fixture-secret' })
      await expect(result).resolves.toBe('stale-target')
      expect(context.contents.send).not.toHaveBeenCalled()
    }
  )

  it('preserves older hosted chooser authorization while its native panel is occluded', async () => {
    const context = setup()
    context.coordinator.noteFormState(context.contents as unknown as WebContents, loginFormState())
    await context.coordinator.listFillOptions(SCOPE)
    context.coordinator.dismissPicker()
    const result = context.coordinator.fillCredential('c1', SCOPE)
    await settle()
    const request = context.contents.send.mock.calls.at(-1)![1]
    context.coordinator.noteFillResult(context.contents as unknown as WebContents, {
      requestId: request.requestId,
      status: 'filled',
    })
    await expect(result).resolves.toBe(true)
  })
})
