import { createCipheriv } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeOrigin } from '@/main/browser-credentials/origin'
import { deriveEncryptionKey } from '@/main/browser-import/chromium-crypto'
import { readBrowserPasswords } from '@/main/browser-import/chromium-passwords'

/**
 * Runs against a synthetic `Login Data` database. Tests never read a
 * developer's real Chrome profile or Keychain.
 */
const sqliteAvailable = await import('node:sqlite').then(
  () => true,
  () => false
)

const KEY = deriveEncryptionKey('test-safe-storage-password')

function encryptV10(plaintext: string): Uint8Array {
  const cipher = createCipheriv('aes-128-cbc', KEY, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), cipher.update(Buffer.from(plaintext)), cipher.final()])
}

interface FixtureLogin {
  signonRealm: string
  username: string
  passwordValue?: Uint8Array
  blacklisted?: number
  originUrl?: string
  modifiedAt?: number
  createdAt?: number
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-chrome-logins-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeLoginDatabase(
  logins: FixtureLogin[],
  fileName = 'Login Data'
): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const path = join(directory, fileName)
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE logins (
      origin_url TEXT NOT NULL, signon_realm TEXT NOT NULL,
      username_value TEXT NOT NULL, password_value BLOB,
      blacklisted_by_user INTEGER NOT NULL,
      date_password_modified INTEGER NOT NULL,
      date_created INTEGER NOT NULL
    )
  `)
  const insert = database.prepare(
    'INSERT INTO logins (origin_url, signon_realm, username_value, password_value, blacklisted_by_user, date_password_modified, date_created) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  for (const login of logins) {
    insert.run(
      login.originUrl ?? `${login.signonRealm}login`,
      login.signonRealm,
      login.username,
      login.passwordValue ?? null,
      login.blacklisted ?? 0,
      login.modifiedAt ?? 0,
      login.createdAt ?? 0
    )
  }
  database.close()
  return path
}

describe.skipIf(!sqliteAvailable)('readBrowserPasswords', () => {
  it('decrypts saved logins', async () => {
    const path = await writeLoginDatabase([
      {
        signonRealm: 'https://example.com/',
        username: 'ada',
        passwordValue: encryptV10('hunter2'),
      },
    ])

    const result = await readBrowserPasswords(path, KEY)

    expect(result.rowsSeen).toBe(1)
    expect(result.credentials).toEqual([
      {
        origin: 'https://example.com/',
        username: 'ada',
        password: 'hunter2',
        sourceModifiedAt: 0n,
      },
    ])
  })

  it('reads the account-scoped password database with the same protections', async () => {
    const path = await writeLoginDatabase(
      [
        {
          signonRealm: 'https://accounts.example/',
          username: 'ada',
          passwordValue: encryptV10('account-password'),
        },
      ],
      'Login Data For Account'
    )

    await expect(readBrowserPasswords(path, KEY)).resolves.toMatchObject({
      credentials: [
        {
          origin: 'https://accounts.example/',
          username: 'ada',
          password: 'account-password',
        },
      ],
    })
  })

  it('carries the best available Chromium modification timestamp', async () => {
    const path = await writeLoginDatabase([
      {
        signonRealm: 'https://modified.test/',
        username: 'ada',
        passwordValue: encryptV10('newer'),
        modifiedAt: 20,
        createdAt: 10,
      },
      {
        signonRealm: 'https://created.test/',
        username: 'grace',
        passwordValue: encryptV10('older'),
        createdAt: 15,
      },
    ])

    expect(
      (await readBrowserPasswords(path, KEY)).credentials.map(
        ({ sourceModifiedAt }) => sourceModifiedAt
      )
    ).toEqual([20n, 15n])
  })

  it('does not strip a prefix from password plaintext', async () => {
    // Unlike cookies, saved passwords carry no domain-bound prefix. Removing
    // 32 bytes here would silently corrupt every password.
    const password = 'x'.repeat(48)
    const path = await writeLoginDatabase([
      {
        signonRealm: 'https://example.com/',
        username: 'ada',
        passwordValue: encryptV10(password),
      },
    ])

    expect((await readBrowserPasswords(path, KEY)).credentials[0].password).toBe(password)
  })

  it('skips never-saved sites, empty rows, and undecryptable values', async () => {
    const path = await writeLoginDatabase([
      {
        signonRealm: 'https://good.test/',
        username: 'ada',
        passwordValue: encryptV10('keep'),
      },
      { signonRealm: 'https://blocked.test/', username: '', blacklisted: 1 },
      { signonRealm: 'https://empty.test/', username: 'a' },
      {
        signonRealm: 'https://broken.test/',
        username: 'b',
        passwordValue: Buffer.from('v20-app-bound'),
      },
    ])

    const result = await readBrowserPasswords(path, KEY)

    expect(result.rowsSeen).toBe(4)
    expect(result.credentials.map(({ origin }) => origin)).toEqual(['https://good.test/'])
    expect(result.skipped).toBe(3)
  })

  it('falls back to the origin url when there is no signon realm', async () => {
    const path = await writeLoginDatabase([
      {
        signonRealm: '',
        originUrl: 'https://fallback.test/login',
        username: 'ada',
        passwordValue: encryptV10('p'),
      },
    ])

    expect((await readBrowserPasswords(path, KEY)).credentials[0].origin).toBe(
      'https://fallback.test/login'
    )
  })

  it('binds a password to signon_realm when origin_url names another site', async () => {
    const path = await writeLoginDatabase([
      {
        signonRealm: 'https://accounts.google.com/',
        originUrl: 'https://evil.test/login',
        username: 'ada',
        passwordValue: encryptV10('p'),
      },
    ])

    expect((await readBrowserPasswords(path, KEY)).credentials[0].origin).toBe(
      'https://accounts.google.com/'
    )
  })

  it('never falls back from a non-web realm to a web origin', async () => {
    const path = await writeLoginDatabase([
      {
        signonRealm: 'android://token@com.example/',
        originUrl: 'https://evil.test/login',
        username: 'ada',
        passwordValue: encryptV10('p'),
      },
    ])

    const [credential] = (await readBrowserPasswords(path, KEY)).credentials
    expect(credential.origin).toBe('android://token@com.example/')
    expect(normalizeOrigin(credential.origin)).toBeNull()
  })

  it('reports an unrecognised schema rather than guessing', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const path = join(directory, 'Login Data')
    const database = new DatabaseSync(path)
    database.exec('CREATE TABLE not_logins (a TEXT)')
    database.close()

    await expect(readBrowserPasswords(path, KEY)).rejects.toMatchObject({
      code: 'unsupported-schema',
    })
  })
})
