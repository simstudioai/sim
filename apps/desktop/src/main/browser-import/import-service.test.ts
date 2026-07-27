import { describe, expect, it, vi } from 'vitest'
import { BROWSER_SOURCES, type BrowserSource } from '@/main/browser-import/browser-sources'
import type { ReadCookiesResult } from '@/main/browser-import/chromium-cookies'
import type { ReadPasswordsResult } from '@/main/browser-import/chromium-passwords'
import type { ImportedSite } from '@/main/browser-import/chromium-site-names'
import {
  type ImportServiceDeps,
  importChromeCookies,
  importChromeData,
  importChromePasswords,
  listImportableProfiles,
  toDisplayProfiles,
} from '@/main/browser-import/import-service'
import {
  type BrowserProfile,
  emptySkipCounts,
  type ImportableCookie,
  ImportFailure,
} from '@/main/browser-import/types'

const CHROME = BROWSER_SOURCES.find(({ id }) => id === 'chrome') as BrowserSource
const ARC = BROWSER_SOURCES.find(({ id }) => id === 'arc') as BrowserSource
const DIA = BROWSER_SOURCES.find(({ id }) => id === 'dia') as BrowserSource

const PROFILES: BrowserProfile[] = [
  {
    id: 'chrome:Default',
    directory: 'Default',
    label: 'Person 1',
    source: CHROME,
    cookiesPath: '/chrome/Default/Cookies',
    loginDataPath: '/chrome/Default/Login Data',
    faviconsPath: '/chrome/Default/Favicons',
    historyPath: '/chrome/Default/History',
  },
  {
    id: 'arc:Profile 2',
    directory: 'Profile 2',
    label: 'Work',
    source: ARC,
    cookiesPath: '/arc/Profile 2/Cookies',
    loginDataPath: '/arc/Profile 2/Login Data',
    faviconsPath: '/arc/Profile 2/Favicons',
    historyPath: '/arc/Profile 2/History',
  },
]

function cookie(name = 'session'): ImportableCookie {
  return {
    url: 'https://example.com/',
    name,
    value: 'value',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  }
}

function read(overrides: Partial<ReadCookiesResult> = {}): ReadCookiesResult {
  return { cookies: [cookie()], skipped: emptySkipCounts(), rowsSeen: 1, ...overrides }
}

function readPasswords(overrides: Partial<ReadPasswordsResult> = {}): ReadPasswordsResult {
  return {
    credentials: [{ origin: 'https://example.com', username: 'ada', password: 'hunter2' }],
    skipped: 0,
    rowsSeen: 1,
    ...overrides,
  }
}

function createDeps(overrides: Partial<ImportServiceDeps> = {}): ImportServiceDeps {
  return {
    platform: 'darwin',
    listProfiles: async () => PROFILES,
    readSafeStoragePassword: async () => 'safe-storage-password',
    readCookies: async () => read(),
    writeCookies: async (cookies) => ({ imported: cookies.length, failed: 0 }),
    readPasswords: async () => readPasswords(),
    readFavicons: async () => new Map<string, string>(),
    readSites: async () => [],
    rememberSites: async () => {},
    vault: {
      isAvailable: () => true,
      importCredentials: async (candidates) => ({
        added: candidates.length,
        updated: 0,
        skipped: 0,
      }),
    },
    ...overrides,
  }
}

describe('toDisplayProfiles', () => {
  function profile(source: BrowserSource, directory: string, label: string): BrowserProfile {
    return {
      id: `${source.id}:${directory}`,
      directory,
      label,
      source,
      cookiesPath: '/cookies',
      loginDataPath: null,
      faviconsPath: null,
      historyPath: null,
    }
  }

  it('leads with the browser, which is the identity that matters', () => {
    // Regression: labelling by profile name alone produced a list like
    // "Your Chrome / sim.ai / Your Chromium / Microtrades" with no way to tell
    // which browser any of them belonged to.
    const labels = toDisplayProfiles([
      profile(CHROME, 'Default', ''),
      profile(CHROME, 'Profile 1', 'sim.ai'),
      profile(ARC, 'Default', ''),
      profile(ARC, 'Profile 2', 'Microtrades'),
    ]).map(({ label }) => label)

    expect(labels).toEqual(['Chrome', 'Chrome · sim.ai', 'Arc', 'Arc · Microtrades'])
  })

  it('uses the browser alone when the profile was never named', () => {
    expect(toDisplayProfiles([profile(CHROME, 'Default', '')])[0].label).toBe('Chrome')
  })

  it('keeps two unnamed profiles of one browser distinguishable', () => {
    const labels = toDisplayProfiles([
      profile(CHROME, 'Default', ''),
      profile(CHROME, 'Profile 1', ''),
    ]).map(({ label }) => label)

    expect(labels).toEqual(['Chrome · Default', 'Chrome · Profile 1'])
    expect(new Set(labels).size).toBe(2)
  })

  it('does not disambiguate across browsers, which are already distinct', () => {
    const labels = toDisplayProfiles([
      profile(ARC, 'Default', ''),
      profile(DIA, 'Default', ''),
    ]).map(({ label }) => label)

    expect(labels).toEqual(['Arc', 'Dia'])
  })

  it('names an unnamed profile by its directory in a profile-only picker', () => {
    // The browser dropdown already says "Chrome", so the profile dropdown
    // beside it needs something to show rather than a blank row.
    expect(
      toDisplayProfiles([profile(CHROME, 'Default', '')]).map(({ profileLabel }) => profileLabel)
    ).toEqual(['Default'])

    expect(
      toDisplayProfiles([profile(CHROME, 'Profile 1', 'sim.ai')]).map(
        ({ profileLabel }) => profileLabel
      )
    ).toEqual(['sim.ai'])
  })
})

describe('listImportableProfiles', () => {
  it('exposes ids, labels, and the owning browser — never a profile path', async () => {
    await expect(listImportableProfiles(createDeps())).resolves.toEqual([
      {
        id: 'chrome:Default',
        label: 'Chrome · Person 1',
        browserId: 'chrome',
        browserLabel: 'Chrome',
        profileLabel: 'Person 1',
      },
      {
        id: 'arc:Profile 2',
        label: 'Arc · Work',
        browserId: 'arc',
        browserLabel: 'Arc',
        profileLabel: 'Work',
      },
    ])
  })

  it('is empty off macOS without consulting the disk', async () => {
    const listProfiles = vi.fn()
    await expect(
      listImportableProfiles(createDeps({ platform: 'win32', listProfiles }))
    ).resolves.toEqual([])
    expect(listProfiles).not.toHaveBeenCalled()
  })

  it('reports no profiles rather than throwing when discovery fails', async () => {
    const listProfiles = async () => {
      throw new Error('unreadable')
    }
    await expect(listImportableProfiles(createDeps({ listProfiles }))).resolves.toEqual([])
  })
})

describe('importChromeCookies', () => {
  it('imports the requested profile and reports counts', async () => {
    const readCookies = vi.fn(async () => read({ cookies: [cookie('a'), cookie('b')] }))
    const result = await importChromeCookies('arc:Profile 2', createDeps({ readCookies }))

    expect(result).toEqual({ cookiesImported: 2, cookiesSkipped: 0 })
    expect(readCookies).toHaveBeenCalledWith('/arc/Profile 2/Cookies', expect.any(Buffer))
  })

  it('defaults to the first profile when none is named', async () => {
    const readCookies = vi.fn(async () => read())
    await importChromeCookies(undefined, createDeps({ readCookies }))
    expect(readCookies).toHaveBeenCalledWith('/chrome/Default/Cookies', expect.any(Buffer))
  })

  it('refuses an unknown profile instead of falling back to the default', async () => {
    const readCookies = vi.fn(async () => read())
    const result = await importChromeCookies('../../elsewhere', createDeps({ readCookies }))

    expect(result.error).toBe('chrome-not-found')
    expect(readCookies).not.toHaveBeenCalled()
  })

  it('counts cookies the browser profile rejected as skipped', async () => {
    const deps = createDeps({
      readCookies: async () =>
        read({
          cookies: [cookie('a'), cookie('b'), cookie('c')],
          skipped: { ...emptySkipCounts(), expired: 4 },
        }),
      writeCookies: async () => ({ imported: 2, failed: 1 }),
    })

    await expect(importChromeCookies(undefined, deps)).resolves.toEqual({
      cookiesImported: 2,
      cookiesSkipped: 5,
    })
  })

  it('zeroes the derived key once the rows are decrypted', async () => {
    let observed: Buffer | undefined
    const deps = createDeps({
      readCookies: async (_path, key) => {
        observed = key
        expect(key.some((byte) => byte !== 0)).toBe(true)
        return read()
      },
    })

    await importChromeCookies(undefined, deps)
    expect(observed?.every((byte) => byte === 0)).toBe(true)
  })

  it('zeroes the derived key even when reading throws', async () => {
    let observed: Buffer | undefined
    const deps = createDeps({
      readCookies: async (_path, key) => {
        observed = key
        throw new ImportFailure('profile-unreadable', 'locked')
      },
    })

    await importChromeCookies(undefined, deps)
    expect(observed?.every((byte) => byte === 0)).toBe(true)
  })

  it.each([
    ['unsupported-platform', createDeps({ platform: 'win32' })],
    ['chrome-not-found', createDeps({ listProfiles: async () => [] })],
    ['keychain-unavailable', createDeps({ readSafeStoragePassword: async () => null })],
  ] as const)('fails closed with %s', async (error, deps) => {
    await expect(importChromeCookies(undefined, deps)).resolves.toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
      error,
    })
  })

  it('never reaches the Keychain on an unsupported platform', async () => {
    const readSafeStoragePassword = vi.fn()
    await importChromeCookies(undefined, createDeps({ platform: 'linux', readSafeStoragePassword }))
    expect(readSafeStoragePassword).not.toHaveBeenCalled()
  })

  it('surfaces a reader failure as its own category', async () => {
    const deps = createDeps({
      readCookies: async () => {
        throw new ImportFailure('unsupported-schema', 'unknown table shape')
      },
    })
    await expect(importChromeCookies(undefined, deps)).resolves.toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
      error: 'unsupported-schema',
    })
  })

  it('reports rows that all failed to decrypt as an import failure', async () => {
    const deps = createDeps({
      readCookies: async () =>
        read({ cookies: [], skipped: { ...emptySkipCounts(), 'decrypt-failed': 9 }, rowsSeen: 9 }),
    })
    await expect(importChromeCookies(undefined, deps)).resolves.toEqual({
      cookiesImported: 0,
      cookiesSkipped: 9,
      error: 'nothing-imported',
    })
  })

  it('treats a genuinely empty profile as a success', async () => {
    const deps = createDeps({ readCookies: async () => read({ cookies: [], rowsSeen: 0 }) })
    await expect(importChromeCookies(undefined, deps)).resolves.toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
    })
  })

  it('does not leak an unexpected error to the caller', async () => {
    const deps = createDeps({
      writeCookies: async () => {
        throw new Error('/Users/someone/Library/Application Support/Google/Chrome exploded')
      },
    })
    await expect(importChromeCookies(undefined, deps)).resolves.toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
      error: 'unknown',
    })
  })

  it('reports a profile with no cookie database rather than reading another one', async () => {
    const deps = createDeps({
      listProfiles: async () => [
        {
          id: 'chrome:Default',
          directory: 'Default',
          label: 'Person 1',
          source: CHROME,
          cookiesPath: null,
          loginDataPath: '/chrome/Login Data',
          faviconsPath: null,
          historyPath: null,
        },
      ],
    })
    await expect(importChromeCookies(undefined, deps)).resolves.toMatchObject({
      error: 'profile-unreadable',
    })
  })
})

describe('importChromePasswords', () => {
  it('stores decrypted passwords in the vault and reports counts', async () => {
    const importCredentials = vi.fn(async () => ({ added: 2, updated: 1, skipped: 0 }))
    const deps = createDeps({
      readPasswords: async () =>
        readPasswords({
          credentials: [
            { origin: 'https://example.com', username: 'ada', password: 'a' },
            { origin: 'https://other.test', username: 'grace', password: 'b' },
          ],
          skipped: 3,
          rowsSeen: 5,
        }),
      vault: { isAvailable: () => true, importCredentials },
    })

    await expect(importChromePasswords('arc:Profile 2', 'replace', deps)).resolves.toEqual({
      passwordsAdded: 2,
      passwordsUpdated: 1,
      passwordsSkipped: 3,
    })
    expect(importCredentials).toHaveBeenCalledWith(expect.any(Array), 'replace')
  })

  it('attaches each site\u2019s icon from the same profile', async () => {
    const importCredentials = vi.fn(async () => ({ added: 1, updated: 0, skipped: 0 }))
    const readFavicons = vi.fn(
      async () => new Map([['https://example.com', 'data:image/png;base64,AA']])
    )
    const deps = createDeps({
      readPasswords: async () =>
        readPasswords({
          credentials: [{ origin: 'https://example.com/login', username: 'ada', password: 'p' }],
        }),
      readFavicons,
      vault: { isAvailable: () => true, importCredentials },
    })

    await importChromePasswords('chrome:Default', 'keep-existing', deps)

    // Only the origins being imported are looked up, never the whole history.
    expect(readFavicons).toHaveBeenCalledWith(
      '/chrome/Default/Favicons',
      new Set(['https://example.com'])
    )
    expect(importCredentials).toHaveBeenCalledWith(
      [expect.objectContaining({ icon: 'data:image/png;base64,AA' })],
      'keep-existing'
    )
  })

  it('imports without icons when the profile has no favicon store', async () => {
    const importCredentials = vi.fn(async () => ({ added: 1, updated: 0, skipped: 0 }))
    const readFavicons = vi.fn()
    const deps = createDeps({
      listProfiles: async () => [{ ...PROFILES[0], faviconsPath: null, historyPath: null }],
      readFavicons,
      vault: { isAvailable: () => true, importCredentials },
    })

    await importChromePasswords(undefined, 'keep-existing', deps)

    expect(readFavicons).not.toHaveBeenCalled()
    expect(importCredentials).toHaveBeenCalledWith(
      [expect.not.objectContaining({ icon: expect.anything() })],
      'keep-existing'
    )
  })

  it('still imports passwords when the favicon store will not read', async () => {
    const importCredentials = vi.fn(async () => ({ added: 1, updated: 0, skipped: 0 }))
    const deps = createDeps({
      readFavicons: async () => {
        throw new Error('corrupt')
      },
      vault: { isAvailable: () => true, importCredentials },
    })

    await expect(importChromePasswords(undefined, 'keep-existing', deps)).resolves.toMatchObject({
      passwordsAdded: 1,
    })
  })

  it('reads the requested profile\u2019s password database', async () => {
    const readPasswordsSpy = vi.fn(async () => readPasswords())
    await importChromePasswords(
      'arc:Profile 2',
      'keep-existing',
      createDeps({ readPasswords: readPasswordsSpy })
    )

    expect(readPasswordsSpy).toHaveBeenCalledWith('/arc/Profile 2/Login Data', expect.any(Buffer))
  })

  it('uses the chosen browser\u2019s own Keychain item', async () => {
    // Reading Chrome's item to import Arc would prompt the user about the
    // wrong browser — and would derive a key that cannot decrypt anything.
    const readSafeStoragePassword = vi.fn(async () => 'password')
    await importChromePasswords(
      'arc:Profile 2',
      'keep-existing',
      createDeps({ readSafeStoragePassword })
    )

    expect(readSafeStoragePassword).toHaveBeenCalledWith({
      service: 'Arc Safe Storage',
      account: 'Arc',
    })
  })

  it('refuses an unknown profile rather than falling back to the default', async () => {
    const readPasswordsSpy = vi.fn(async () => readPasswords())
    const result = await importChromePasswords(
      '../../elsewhere',
      'keep-existing',
      createDeps({ readPasswords: readPasswordsSpy })
    )

    expect(result.error).toBe('chrome-not-found')
    expect(readPasswordsSpy).not.toHaveBeenCalled()
  })

  it('will not run without secure storage, and never reaches the Keychain', async () => {
    // There is no plaintext fallback for passwords: an unavailable vault ends
    // the import instead of degrading it.
    const readSafeStoragePassword = vi.fn()
    const deps = createDeps({
      readSafeStoragePassword,
      vault: { isAvailable: () => false, importCredentials: vi.fn() },
    })

    await expect(importChromePasswords(undefined, 'keep-existing', deps)).resolves.toEqual({
      passwordsAdded: 0,
      passwordsUpdated: 0,
      passwordsSkipped: 0,
      error: 'vault-unavailable',
    })
    expect(readSafeStoragePassword).not.toHaveBeenCalled()
  })

  it('zeroes the derived key after reading, including on failure', async () => {
    let observed: Buffer | undefined
    await importChromePasswords(
      undefined,
      'keep-existing',
      createDeps({
        readPasswords: async (_path, key) => {
          observed = key
          throw new ImportFailure('unsupported-schema', 'unknown logins table')
        },
      })
    )

    expect(observed?.every((byte) => byte === 0)).toBe(true)
  })

  it('reports rows that all failed to decrypt as an import failure', async () => {
    const deps = createDeps({
      readPasswords: async () => readPasswords({ credentials: [], skipped: 7, rowsSeen: 7 }),
    })

    await expect(importChromePasswords(undefined, 'keep-existing', deps)).resolves.toEqual({
      passwordsAdded: 0,
      passwordsUpdated: 0,
      passwordsSkipped: 7,
      error: 'nothing-imported',
    })
  })

  it('treats a profile with no saved passwords as a success', async () => {
    const deps = createDeps({
      readPasswords: async () => readPasswords({ credentials: [], skipped: 0, rowsSeen: 0 }),
    })

    await expect(importChromePasswords(undefined, 'keep-existing', deps)).resolves.toEqual({
      passwordsAdded: 0,
      passwordsUpdated: 0,
      passwordsSkipped: 0,
    })
  })

  it.each([
    ['unsupported-platform', { platform: 'win32' as const }],
    ['chrome-not-found', { listProfiles: async () => [] }],
    ['keychain-unavailable', { readSafeStoragePassword: async () => null }],
  ])('fails closed with %s', async (error, overrides) => {
    await expect(
      importChromePasswords(undefined, 'keep-existing', createDeps(overrides))
    ).resolves.toMatchObject({ error })
  })

  it('does not leak an unexpected error to the caller', async () => {
    const deps = createDeps({
      vault: {
        isAvailable: () => true,
        importCredentials: async () => {
          throw new Error('/Users/someone/Library/.../Login Data exploded')
        },
      },
    })

    await expect(importChromePasswords(undefined, 'keep-existing', deps)).resolves.toEqual({
      passwordsAdded: 0,
      passwordsUpdated: 0,
      passwordsSkipped: 0,
      error: 'unknown',
    })
  })
})

describe('importChromeData', () => {
  const COOKIES_IMPORTED = { cookiesImported: 1, cookiesSkipped: 0 }
  const PASSWORDS_IMPORTED = { passwordsAdded: 1, passwordsUpdated: 0, passwordsSkipped: 0 }

  /** Runs a combined import while holding on to the key the halves were handed. */
  async function importObservingKey(overrides: Partial<ImportServiceDeps> = {}) {
    const base = createDeps(overrides)
    let observed: Buffer | undefined
    const result = await importChromeData(undefined, 'keep-existing', {
      ...base,
      readCookies: (path, key) => {
        observed = key
        return base.readCookies(path, key)
      },
      readPasswords: (path, key) => {
        observed = key
        return base.readPasswords(path, key)
      },
    })
    return { result, observed }
  }

  it('brings over both halves in one action', async () => {
    await expect(importChromeData('arc:Profile 2', 'keep-existing', createDeps())).resolves.toEqual(
      { cookies: COOKIES_IMPORTED, passwords: PASSWORDS_IMPORTED }
    )
  })

  it('refuses both halves off macOS without consulting the disk', async () => {
    const listProfiles = vi.fn()
    const readSafeStoragePassword = vi.fn()

    await expect(
      importChromeData(
        undefined,
        'keep-existing',
        createDeps({ platform: 'win32', listProfiles, readSafeStoragePassword })
      )
    ).resolves.toEqual({
      cookies: { cookiesImported: 0, cookiesSkipped: 0, error: 'unsupported-platform' },
      passwords: {
        passwordsAdded: 0,
        passwordsUpdated: 0,
        passwordsSkipped: 0,
        error: 'unsupported-platform',
      },
    })
    expect(listProfiles).not.toHaveBeenCalled()
    expect(readSafeStoragePassword).not.toHaveBeenCalled()
  })

  it('prompts for the Keychain once, not once per half', async () => {
    // Regression: running the two exported halves in sequence read the Safe
    // Storage item twice, so a user who answered the first prompt with "Allow"
    // rather than "Always Allow" got a second prompt mid-import — one arriving
    // without a user gesture behind it, which silently fails the password half.
    const listProfiles = vi.fn(async () => PROFILES)
    const readSafeStoragePassword = vi.fn(async () => 'safe-storage-password')

    await importChromeData(
      'chrome:Default',
      'keep-existing',
      createDeps({ listProfiles, readSafeStoragePassword })
    )

    expect(readSafeStoragePassword).toHaveBeenCalledTimes(1)
    expect(listProfiles).toHaveBeenCalledTimes(1)
  })

  it('hands both halves the one key that open derived', async () => {
    let cookieKey: Buffer | undefined
    let passwordKey: Buffer | undefined
    const deps = createDeps({
      readCookies: async (_path, key) => {
        cookieKey = key
        return read()
      },
      readPasswords: async (_path, key) => {
        passwordKey = key
        // The cookie half must not wipe the key out from under this one.
        expect(key.some((byte) => byte !== 0)).toBe(true)
        return readPasswords()
      },
    })

    await importChromeData(undefined, 'keep-existing', deps)

    expect(passwordKey).toBe(cookieKey)
  })

  it('reports the same reason for both halves when the profile will not open', async () => {
    await expect(
      importChromeData('../../elsewhere', 'keep-existing', createDeps())
    ).resolves.toEqual({
      cookies: { cookiesImported: 0, cookiesSkipped: 0, error: 'chrome-not-found' },
      passwords: {
        passwordsAdded: 0,
        passwordsUpdated: 0,
        passwordsSkipped: 0,
        error: 'chrome-not-found',
      },
    })
  })

  it('still imports passwords when the cookie half throws', async () => {
    const deps = createDeps({
      readCookies: async () => {
        throw new ImportFailure('unsupported-schema', 'unknown cookies table')
      },
    })

    await expect(importChromeData(undefined, 'keep-existing', deps)).resolves.toEqual({
      cookies: { cookiesImported: 0, cookiesSkipped: 0, error: 'unsupported-schema' },
      passwords: PASSWORDS_IMPORTED,
    })
  })

  it('still reports the imported cookies when the password half throws', async () => {
    const deps = createDeps({
      readPasswords: async () => {
        throw new ImportFailure('unsupported-schema', 'unknown logins table')
      },
    })

    await expect(importChromeData(undefined, 'keep-existing', deps)).resolves.toEqual({
      cookies: COOKIES_IMPORTED,
      passwords: {
        passwordsAdded: 0,
        passwordsUpdated: 0,
        passwordsSkipped: 0,
        error: 'unsupported-schema',
      },
    })
  })

  it('imports cookies even though secure storage cannot take the passwords', async () => {
    // There is no plaintext fallback for passwords, but cookies do not need
    // the vault — so an unavailable one must not cost the user both halves.
    const importCredentials = vi.fn()
    const deps = createDeps({ vault: { isAvailable: () => false, importCredentials } })

    await expect(importChromeData(undefined, 'keep-existing', deps)).resolves.toEqual({
      cookies: COOKIES_IMPORTED,
      passwords: {
        passwordsAdded: 0,
        passwordsUpdated: 0,
        passwordsSkipped: 0,
        error: 'vault-unavailable',
      },
    })
    expect(importCredentials).not.toHaveBeenCalled()
  })

  it('filters history by the cookie hosts and the password origins together', async () => {
    // Either half alone is a partial picture of what the user brought over.
    const readSites = vi.fn(async () => [])
    const deps = createDeps({
      readCookies: async () =>
        read({ cookies: [{ ...cookie(), url: 'https://news.example.com/' }] }),
      readPasswords: async () =>
        readPasswords({
          credentials: [{ origin: 'https://accounts.other.test', username: 'ada', password: 'p' }],
        }),
      readSites,
    })

    await importChromeData(undefined, 'keep-existing', deps)

    expect(readSites).toHaveBeenCalledTimes(1)
    expect(readSites).toHaveBeenCalledWith(
      '/chrome/Default/History',
      new Set(['news.example.com', 'accounts.other.test'])
    )
  })

  const KEY_PATHS: [string, Partial<ImportServiceDeps>][] = [
    ['both halves land', {}],
    [
      'the cookie half throws',
      {
        readCookies: async () => {
          throw new ImportFailure('unsupported-schema', 'unknown cookies table')
        },
      },
    ],
    [
      'the password half throws',
      {
        readPasswords: async () => {
          throw new Error('/Users/someone/Library/.../Login Data exploded')
        },
      },
    ],
    [
      'secure storage is unavailable',
      { vault: { isAvailable: () => false, importCredentials: vi.fn() } },
    ],
    [
      'remembering the sites throws',
      {
        rememberSites: async () => {
          throw new Error('directory is unwritable')
        },
      },
    ],
  ]

  it.each(KEY_PATHS)('zeroes the derived key when %s', async (_path, overrides) => {
    const { observed } = await importObservingKey(overrides)

    expect(observed).toBeDefined()
    expect(observed?.every((byte) => byte === 0)).toBe(true)
  })
})

describe('remembering the sites an import brought over', () => {
  const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

  it('records the host history knows, not the cookie domain it was filtered by', async () => {
    // The filter is `google.com` (a domain cookie with its dot stripped) but
    // the site the user opened is `mail.google.com`. The favicon lookup and the
    // omnibox both key off the recorded string, so it must be the visited host.
    const rememberSites = vi.fn(async () => {})
    const readSites = vi.fn(async () => [
      { hostname: 'mail.google.com', name: 'Gmail', visits: 412 },
    ])
    const readFavicons = vi.fn(
      async () => new Map([['https://mail.google.com', 'data:image/png;base64,AA']])
    )
    const deps = createDeps({
      readCookies: async () => read({ cookies: [{ ...cookie(), url: 'https://google.com/' }] }),
      readSites,
      readFavicons,
      rememberSites,
    })

    await importChromeCookies(undefined, deps)

    expect(readSites).toHaveBeenCalledWith('/chrome/Default/History', new Set(['google.com']))
    expect(readFavicons).toHaveBeenCalledWith(
      '/chrome/Default/Favicons',
      new Set(['https://mail.google.com'])
    )
    expect(rememberSites).toHaveBeenCalledWith([
      {
        hostname: 'mail.google.com',
        name: 'Gmail',
        icon: 'data:image/png;base64,AA',
        visits: 412,
        importedAt: expect.stringMatching(ISO_TIMESTAMP),
      },
    ])
  })

  it('carries the visit count and the import time, which order the suggestions', async () => {
    const rememberSites = vi.fn<ImportServiceDeps['rememberSites']>(async () => {})
    const deps = createDeps({
      readSites: async () => [
        { hostname: 'example.com', name: 'Example', visits: 90 },
        { hostname: 'docs.example.com', visits: 4 },
      ],
      rememberSites,
    })

    await importChromeCookies(undefined, deps)

    const [records] = rememberSites.mock.calls[0]
    expect(records.map(({ hostname, visits }) => ({ hostname, visits }))).toEqual([
      { hostname: 'example.com', visits: 90 },
      { hostname: 'docs.example.com', visits: 4 },
    ])
    // One wall-clock stamp for the whole import, never the source browser's
    // own last-visit time — that would be the visit log this store avoids.
    expect(new Set(records.map(({ importedAt }) => importedAt)).size).toBe(1)
    expect(records[0].importedAt).toMatch(ISO_TIMESTAMP)
  })

  it('leaves a finished import alone when reading history throws synchronously', async () => {
    // Regression: a dependency that threw before returning its promise escaped
    // the `.catch()` chain and rewrote a completed import as
    // { cookiesImported: 0, error: 'unknown' } — losing cookies already written.
    const readSites = vi.fn((): Promise<ImportedSite[]> => {
      throw new Error('History is locked by the source browser')
    })

    await expect(importChromeCookies(undefined, createDeps({ readSites }))).resolves.toEqual({
      cookiesImported: 1,
      cookiesSkipped: 0,
    })
    expect(readSites).toHaveBeenCalled()
  })

  it('leaves a finished import alone when writing the directory throws synchronously', async () => {
    const rememberSites = vi.fn((): Promise<void> => {
      throw new Error('site directory is unwritable')
    })
    const deps = createDeps({
      readSites: async () => [{ hostname: 'example.com', visits: 3 }],
      rememberSites,
    })

    await expect(importChromePasswords(undefined, 'keep-existing', deps)).resolves.toEqual({
      passwordsAdded: 1,
      passwordsUpdated: 0,
      passwordsSkipped: 0,
    })
    expect(rememberSites).toHaveBeenCalled()
  })

  it('does not reject the combined import when remembering the sites fails', async () => {
    // The combined entry point awaits this last, outside its own guard, so a
    // throw here would reach the IPC caller as a rejected promise.
    const deps = createDeps({
      readSites: async () => [{ hostname: 'example.com', visits: 3 }],
      rememberSites: async () => {
        throw new Error('directory is unwritable')
      },
    })

    await expect(importChromeData(undefined, 'keep-existing', deps)).resolves.toEqual({
      cookies: { cookiesImported: 1, cookiesSkipped: 0 },
      passwords: { passwordsAdded: 1, passwordsUpdated: 0, passwordsSkipped: 0 },
    })
  })

  it('never records an Android package name a saved credential carried', async () => {
    const readSites = vi.fn(async () => [])
    const deps = createDeps({
      readPasswords: async () =>
        readPasswords({
          credentials: [
            { origin: 'android://hash@com.example.app/', username: 'ada', password: 'p' },
            { origin: 'https://example.com', username: 'ada', password: 'p' },
          ],
        }),
      readSites,
    })

    await importChromePasswords(undefined, 'keep-existing', deps)

    expect(readSites).toHaveBeenCalledWith('/chrome/Default/History', new Set(['example.com']))
  })

  it('does not open history for a profile that has none', async () => {
    const readSites = vi.fn(async () => [])
    const deps = createDeps({
      listProfiles: async () => [{ ...PROFILES[0], historyPath: null }],
      readSites,
    })

    await importChromeCookies(undefined, deps)

    expect(readSites).not.toHaveBeenCalled()
  })

  it('writes nothing when the import vouched for no hosts', async () => {
    const rememberSites = vi.fn(async () => {})
    const readSites = vi.fn(async () => [])
    const deps = createDeps({
      readCookies: async () => read({ cookies: [], rowsSeen: 0 }),
      readSites,
      rememberSites,
    })

    await importChromeCookies(undefined, deps)

    expect(readSites).not.toHaveBeenCalled()
    expect(rememberSites).not.toHaveBeenCalled()
  })
})
