import { describe, expect, it, vi } from 'vitest'
import { BROWSER_SOURCES, type BrowserSource } from '@/main/browser-import/browser-sources'
import type { ReadCookiesResult } from '@/main/browser-import/chromium-cookies'
import type { ReadPasswordsResult } from '@/main/browser-import/chromium-passwords'
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
const _DIA = BROWSER_SOURCES.find(({ id }) => id === 'dia') as BrowserSource

const PROFILES: BrowserProfile[] = [
  {
    id: 'chrome:Default',
    directory: 'Default',
    label: 'Person 1',
    source: CHROME,
    cookiesPath: '/chrome/Default/Cookies',
    loginDataPaths: ['/chrome/Default/Login Data'],
    faviconsPath: '/chrome/Default/Favicons',
    historyPath: '/chrome/Default/History',
  },
  {
    id: 'arc:Profile 2',
    directory: 'Profile 2',
    label: 'Work',
    source: ARC,
    cookiesPath: '/arc/Profile 2/Cookies',
    loginDataPaths: ['/arc/Profile 2/Login Data'],
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
    commit: (operation) => operation(),
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
      loginDataPaths: [],
      faviconsPath: null,
      historyPath: null,
    }
  }

  it('keeps two unnamed profiles of one browser distinguishable', () => {
    const labels = toDisplayProfiles([
      profile(CHROME, 'Default', ''),
      profile(CHROME, 'Profile 1', ''),
    ]).map(({ label }) => label)

    expect(labels).toEqual(['Chrome · Default', 'Chrome · Profile 1'])
    expect(new Set(labels).size).toBe(2)
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
})

describe('importChromeCookies', () => {
  it('refuses an unknown profile instead of falling back to the default', async () => {
    const readCookies = vi.fn(async () => read())
    const result = await importChromeCookies('../../elsewhere', createDeps({ readCookies }))

    expect(result.error).toBe('chrome-not-found')
    expect(readCookies).not.toHaveBeenCalled()
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

  it('reports a profile with no cookie database rather than reading another one', async () => {
    const deps = createDeps({
      listProfiles: async () => [
        {
          id: 'chrome:Default',
          directory: 'Default',
          label: 'Person 1',
          source: CHROME,
          cookiesPath: null,
          loginDataPaths: ['/chrome/Login Data'],
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
  it('does not commit passwords when account teardown begins during the source read', async () => {
    let releaseRead: ((result: ReadPasswordsResult) => void) | undefined
    const readResult = new Promise<ReadPasswordsResult>((resolve) => {
      releaseRead = resolve
    })
    let current = true
    const importCredentials = vi.fn(async () => ({ added: 1, updated: 0, skipped: 0 }))
    const deps = createDeps({
      readPasswords: () => readResult,
      commit: async (operation) => {
        if (!current) throw new Error('account expired')
        return operation()
      },
      vault: { isAvailable: () => true, importCredentials },
    })

    const pending = importChromePasswords(undefined, 'keep-existing', deps)
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'))
    current = false
    releaseRead?.(readPasswords())

    await expect(pending).resolves.toMatchObject({ error: 'unknown' })
    expect(importCredentials).not.toHaveBeenCalled()
  })

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

  it('resolves cross-store identity collisions before applying the vault policy', async () => {
    const localPath = '/arc/Default/Login Data'
    const accountPath = '/arc/Default/Login Data For Account'
    const importCredentials = vi.fn(async (candidates) => ({
      added: candidates.length,
      updated: 0,
      skipped: 0,
    }))
    const deps = createDeps({
      listProfiles: async () => [
        { ...PROFILES[1], id: 'arc:Default', loginDataPaths: [localPath, accountPath] },
      ],
      readPasswords: async (path) =>
        readPasswords({
          credentials: [
            {
              origin:
                path === accountPath
                  ? 'https://accounts.example/login'
                  : 'https://ACCOUNTS.example/old',
              username: path === accountPath ? 'ada' : ' ada ',
              password: path === accountPath ? 'account-copy' : 'local-copy',
            },
          ],
        }),
      vault: { isAvailable: () => true, importCredentials },
    })

    await expect(importChromePasswords('arc:Default', 'keep-existing', deps)).resolves.toEqual({
      passwordsAdded: 1,
      passwordsUpdated: 0,
      passwordsSkipped: 1,
    })
    expect(importCredentials).toHaveBeenCalledWith(
      [expect.objectContaining({ password: 'account-copy' })],
      'keep-existing'
    )
  })

  it('keeps a newer local password over an older account-store copy', async () => {
    const localPath = '/arc/Default/Login Data'
    const accountPath = '/arc/Default/Login Data For Account'
    const importCredentials = vi.fn(async (candidates) => ({
      added: candidates.length,
      updated: 0,
      skipped: 0,
    }))
    const deps = createDeps({
      listProfiles: async () => [
        { ...PROFILES[1], id: 'arc:Default', loginDataPaths: [localPath, accountPath] },
      ],
      readPasswords: async (path) =>
        readPasswords({
          credentials: [
            {
              origin: 'https://accounts.example',
              username: 'ada',
              password: path === localPath ? 'new-local' : 'stale-account',
              sourceModifiedAt: path === localPath ? 20n : 10n,
            },
          ],
        }),
      vault: { isAvailable: () => true, importCredentials },
    })

    await expect(importChromePasswords('arc:Default', 'replace', deps)).resolves.toMatchObject({
      passwordsAdded: 1,
      passwordsSkipped: 1,
    })
    expect(importCredentials).toHaveBeenCalledWith(
      [expect.objectContaining({ password: 'new-local' })],
      'replace'
    )
  })

  it.each(['local', 'account'])(
    'reports a partial import when the %s password store is unreadable',
    async (failedStore) => {
      const localPath = '/arc/Default/Login Data'
      const accountPath = '/arc/Default/Login Data For Account'
      const deps = createDeps({
        listProfiles: async () => [
          { ...PROFILES[1], id: 'arc:Default', loginDataPaths: [localPath, accountPath] },
        ],
        readPasswords: async (path) => {
          if (path === (failedStore === 'local' ? localPath : accountPath)) {
            throw new ImportFailure('unsupported-schema', 'unknown account-store schema')
          }
          return readPasswords()
        },
      })

      await expect(importChromeData('arc:Default', 'replace', deps)).resolves.toMatchObject({
        cookies: { cookiesImported: 1 },
        passwords: {
          passwordsAdded: 1,
          passwordsSkipped: 0,
          error: 'unsupported-schema',
        },
      })
    }
  )

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
})

describe('importChromeData', () => {
  const _COOKIES_IMPORTED = { cookiesImported: 1, cookiesSkipped: 0 }
  const PASSWORDS_IMPORTED = { passwordsAdded: 1, passwordsUpdated: 0, passwordsSkipped: 0 }

  /** Runs a combined import while holding on to the key the halves were handed. */
  async function _importObservingKey(overrides: Partial<ImportServiceDeps> = {}) {
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

  const _KEY_PATHS: [string, Partial<ImportServiceDeps>][] = [
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
})

describe('remembering the sites an import brought over', () => {
  const _ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

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
})
