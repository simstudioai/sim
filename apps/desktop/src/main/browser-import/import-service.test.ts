import { describe, expect, it, vi } from 'vitest'
import { BROWSER_SOURCES, type BrowserSource } from '@/main/browser-import/browser-sources'
import type { ReadCookiesResult } from '@/main/browser-import/chromium-cookies'
import type { ReadPasswordsResult } from '@/main/browser-import/chromium-passwords'
import {
  type ImportServiceDeps,
  importChromeCookies,
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
  },
  {
    id: 'arc:Profile 2',
    directory: 'Profile 2',
    label: 'Work',
    source: ARC,
    cookiesPath: '/arc/Profile 2/Cookies',
    loginDataPath: '/arc/Profile 2/Login Data',
    faviconsPath: '/arc/Profile 2/Favicons',
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
      listProfiles: async () => [{ ...PROFILES[0], faviconsPath: null }],
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
