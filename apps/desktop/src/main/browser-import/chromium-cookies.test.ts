import { createCipheriv, createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBrowserCookies } from '@/main/browser-import/chromium-cookies'
import { deriveEncryptionKey } from '@/main/browser-import/chromium-crypto'

/**
 * Exercises the reader against a synthetic Chrome profile. Fixtures are built
 * here on purpose: a test must never read a developer's real Chrome profile or
 * touch their Keychain.
 */
const sqliteAvailable = await import('node:sqlite').then(
  () => true,
  () => false
)

const KEY = deriveEncryptionKey('test-safe-storage-password')
const NOW_SECONDS = 1_800_000_000

async function stagingDirectories(): Promise<Set<string>> {
  const entries = await readdir(tmpdir())
  return new Set(entries.filter((entry) => entry.startsWith('sim-chrome-import-')))
}

/**
 * Staging copies still present that were not there at `before`.
 *
 * Every reader in this folder stages through the shared `os.tmpdir()` under one
 * prefix, and Vitest runs their suites in parallel workers, so a single snapshot
 * can catch a sibling's copy mid-read and read as a leak. A leak of our own
 * never clears, so this settles instead of sampling once.
 */
async function stagingLeftBehindSince(before: ReadonlySet<string>): Promise<string[]> {
  let leftover: string[] = []
  for (let attempt = 0; attempt < 20; attempt++) {
    leftover = [...(await stagingDirectories())].filter((entry) => !before.has(entry))
    if (leftover.length === 0) return leftover
    await sleep(25)
  }
  return leftover
}

function chromeTime(unixSeconds: number): bigint {
  return BigInt(unixSeconds + 11_644_473_600) * 1_000_000n
}

function encryptV10(plaintext: Buffer): Uint8Array {
  const cipher = createCipheriv('aes-128-cbc', KEY, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()])
}

interface FixtureCookie {
  hostKey: string
  name: string
  encryptedValue?: Uint8Array
  value?: string
  expiresUtc?: bigint
  hasExpires?: number
  isPersistent?: number
  isSecure?: number
  sameSite?: number
  path?: string
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-chrome-cookies-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeCookieDatabase(cookies: FixtureCookie[]): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const path = join(directory, 'Cookies')
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, name TEXT NOT NULL,
      value TEXT NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
      has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
      samesite INTEGER NOT NULL, encrypted_value BLOB
    )
  `)
  const insert = database.prepare(`
    INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc,
      is_secure, is_httponly, has_expires, is_persistent, samesite, encrypted_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const cookie of cookies) {
    insert.run(
      chromeTime(NOW_SECONDS - 100),
      cookie.hostKey,
      cookie.name,
      cookie.value ?? '',
      cookie.path ?? '/',
      cookie.expiresUtc ?? chromeTime(NOW_SECONDS + 3600),
      cookie.isSecure ?? 1,
      1,
      cookie.hasExpires ?? 1,
      cookie.isPersistent ?? 1,
      cookie.sameSite ?? 1,
      cookie.encryptedValue ?? null
    )
  }
  database.close()
  return path
}

describe.skipIf(!sqliteAvailable)('readBrowserCookies', () => {
  it('decrypts a v10 cookie and preserves its attributes', async () => {
    const path = await writeCookieDatabase([
      {
        hostKey: '.example.com',
        name: 'session',
        encryptedValue: encryptV10(Buffer.from('token-123')),
      },
    ])

    const result = await readBrowserCookies(path, KEY, NOW_SECONDS)

    expect(result.rowsSeen).toBe(1)
    expect(result.cookies).toHaveLength(1)
    const [cookie] = result.cookies
    expect(cookie).toMatchObject({
      url: 'https://example.com/',
      name: 'session',
      value: 'token-123',
      domain: '.example.com',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    })
    expect(cookie.expirationDate).toBeCloseTo(NOW_SECONDS + 3600, 3)
  })

  it('reads Chrome timestamps that overflow a safe integer', async () => {
    const path = await writeCookieDatabase([
      {
        hostKey: 'example.com',
        name: 'a',
        encryptedValue: encryptV10(Buffer.from('v')),
        expiresUtc: chromeTime(NOW_SECONDS + 86_400),
      },
    ])

    const [cookie] = (await readBrowserCookies(path, KEY, NOW_SECONDS)).cookies
    expect(cookie.expirationDate).toBeCloseTo(NOW_SECONDS + 86_400, 3)
  })

  it('removes a verified domain-bound prefix', async () => {
    const plaintext = Buffer.concat([
      createHash('sha256').update('.example.com').digest(),
      Buffer.from('bound'),
    ])
    const path = await writeCookieDatabase([
      { hostKey: '.example.com', name: 'a', encryptedValue: encryptV10(plaintext) },
    ])

    expect((await readBrowserCookies(path, KEY, NOW_SECONDS)).cookies[0].value).toBe('bound')
  })

  it('falls back to the plain value column for unencrypted rows', async () => {
    const path = await writeCookieDatabase([
      { hostKey: 'example.com', name: 'a', value: 'legacy-plaintext' },
    ])

    expect((await readBrowserCookies(path, KEY, NOW_SECONDS)).cookies[0].value).toBe(
      'legacy-plaintext'
    )
  })

  it('counts unreadable and expired rows instead of failing the import', async () => {
    const path = await writeCookieDatabase([
      { hostKey: 'example.com', name: 'good', encryptedValue: encryptV10(Buffer.from('v')) },
      { hostKey: 'example.com', name: 'bad', encryptedValue: Buffer.from('v20-not-supported') },
      {
        hostKey: 'example.com',
        name: 'old',
        encryptedValue: encryptV10(Buffer.from('v')),
        expiresUtc: chromeTime(NOW_SECONDS - 10),
      },
    ])

    const result = await readBrowserCookies(path, KEY, NOW_SECONDS)

    expect(result.rowsSeen).toBe(3)
    expect(result.cookies.map(({ name }) => name)).toEqual(['good'])
    expect(result.skipped['decrypt-failed']).toBe(1)
    expect(result.skipped.expired).toBe(1)
  })

  it('reports an unrecognised schema rather than guessing', async () => {
    const path = join(directory, 'Cookies')
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(path)
    database.exec('CREATE TABLE something_else (a TEXT)')
    database.close()

    await expect(readBrowserCookies(path, KEY, NOW_SECONDS)).rejects.toMatchObject({
      code: 'unsupported-schema',
    })
  })

  it('reports an unreadable source rather than throwing raw', async () => {
    await expect(
      readBrowserCookies(join(directory, 'absent', 'Cookies'), KEY, NOW_SECONDS)
    ).rejects.toMatchObject({ code: 'profile-unreadable' })
  })

  it('leaves the source database untouched', async () => {
    const path = await writeCookieDatabase([
      { hostKey: 'example.com', name: 'a', encryptedValue: encryptV10(Buffer.from('v')) },
    ])
    const before = await stat(path)

    await readBrowserCookies(path, KEY, NOW_SECONDS)

    const after = await stat(path)
    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('deletes its decrypted working copy', async () => {
    const before = await stagingDirectories()
    const path = await writeCookieDatabase([
      { hostKey: 'example.com', name: 'a', encryptedValue: encryptV10(Buffer.from('v')) },
    ])

    await readBrowserCookies(path, KEY, NOW_SECONDS)

    expect(await stagingLeftBehindSince(before)).toEqual([])
  })

  it('cleans up even when the read fails', async () => {
    const before = await stagingDirectories()
    await writeFile(join(directory, 'Cookies'), 'not a database')

    await expect(readBrowserCookies(join(directory, 'Cookies'), KEY, NOW_SECONDS)).rejects.toThrow()

    expect(await stagingLeftBehindSince(before)).toEqual([])
  })
})
