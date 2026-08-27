import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  type BrowserSessionSnapshot,
  type DesktopChatSessionEncryptionProvider,
  DesktopChatSessionStore,
  type TerminalSessionSnapshot,
} from '@/main/desktop-chat-session-store'

function encryption(available = true): DesktopChatSessionEncryptionProvider {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => {
      const encoded = value.toString('utf8')
      if (!encoded.startsWith('sealed:')) throw new Error('not encrypted by this provider')
      return encoded.slice('sealed:'.length)
    }),
  }
}

const ORIGIN = 'https://www.sim.ai'
const BROWSER: BrowserSessionSnapshot = {
  v: 1,
  tabs: [
    { url: 'https://example.com/inbox', pinned: true },
    { url: 'about:blank', pinned: false },
  ],
  activeIndex: 1,
  downloads: [
    {
      id: 'download-1',
      filename: 'report.csv',
      state: 'completed',
      receivedBytes: 2_048,
      totalBytes: 2_048,
      startedAt: '2026-07-31T12:00:00.000Z',
      savePath: '/Users/ada/Downloads/report.csv',
    },
  ],
}
const TERMINAL: TerminalSessionSnapshot = {
  v: 1,
  tabs: [{ cwd: '/Users/ada/code' }, { cwd: '/tmp/build' }],
  activeIndex: 0,
}

let directory: string
let filePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-desktop-chat-sessions-'))
  filePath = join(directory, 'desktop-chat-sessions.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function open(
  provider: DesktopChatSessionEncryptionProvider = encryption(),
  now: () => number = Date.now
): DesktopChatSessionStore {
  const store = new DesktopChatSessionStore(filePath, {
    encryption: provider,
    now,
    writeDelayMs: 60_000,
  })
  store.initialize()
  return store
}

function writeEncryptedPayload(
  provider: DesktopChatSessionEncryptionProvider,
  payload: unknown
): void {
  writeFileSync(
    filePath,
    JSON.stringify({
      v: 1,
      ciphertext: provider.encryptString(JSON.stringify(payload)).toString('base64'),
    })
  )
}

describe('DesktopChatSessionStore', () => {
  it('round-trips browser and terminal descriptors across app restarts', () => {
    const provider = encryption()
    const first = open(provider)

    expect(first.setBrowser(ORIGIN, 'chat-a', BROWSER)).toBe(true)
    expect(first.setTerminal(ORIGIN, 'chat-a', TERMINAL)).toBe(true)
    expect(first.flush()).toBe(true)

    const restarted = open(provider)
    expect(restarted.initialize()).toBe(true)
    expect(restarted.getBrowser(ORIGIN, 'chat-a')).toEqual(BROWSER)
    expect(restarted.getTerminal(ORIGIN, 'chat-a')).toEqual(TERMINAL)
  })

  it('encrypts the complete descriptor payload and writes it owner-only', () => {
    const provider = encryption()
    const store = open(provider)
    store.setBrowser(ORIGIN, 'chat-secret', BROWSER)
    store.setTerminal(ORIGIN, 'chat-secret', TERMINAL)

    expect(store.flush()).toBe(true)

    const onDisk = readFileSync(filePath, 'utf8')
    expect(onDisk).not.toContain('chat-secret')
    expect(onDisk).not.toContain('example.com')
    expect(onDisk).not.toContain('/Users/ada/code')
    expect(onDisk).not.toContain('report.csv')
    expect(JSON.parse(onDisk)).toEqual({ v: 1, ciphertext: expect.any(String) })
    expect(provider.encryptString).toHaveBeenCalledOnce()
    expect(statSync(filePath).mode & 0o077).toBe(0)
  })

  it('does not replace the durable store with an oversized encrypted envelope', () => {
    const provider = encryption()
    const store = open(provider)
    store.setTerminal(ORIGIN, 'chat-existing', TERMINAL)
    expect(store.flush()).toBe(true)
    const existing = readFileSync(filePath, 'utf8')

    vi.mocked(provider.encryptString).mockReturnValueOnce(Buffer.alloc(8 * 1024 * 1024))
    store.setTerminal(ORIGIN, 'chat-new', TERMINAL)

    expect(store.flush()).toBe(false)
    expect(readFileSync(filePath, 'utf8')).toBe(existing)

    expect(store.flush()).toBe(true)
    expect(readFileSync(filePath, 'utf8')).not.toBe(existing)
  })

  it('preserves an oversized store until explicit clear resets persistence', () => {
    writeFileSync(filePath, '')
    truncateSync(filePath, 10 * 1024 * 1024 + 1)
    const store = open(encryption())

    expect(store.initialize()).toBe(false)
    store.setTerminal(ORIGIN, 'chat-new', TERMINAL)
    expect(store.flush()).toBe(false)
    expect(statSync(filePath).size).toBe(10 * 1024 * 1024 + 1)

    store.clear()
    store.setTerminal(ORIGIN, 'chat-new', TERMINAL)
    expect(store.flush()).toBe(true)
  })

  it('keeps a pending chat in memory until migration promotes it to a durable chat id', () => {
    const provider = encryption()
    const pending = open(provider)
    pending.setBrowser(ORIGIN, 'pending:workspace-a', BROWSER)
    pending.setTerminal(ORIGIN, 'pending:workspace-a', TERMINAL)

    expect(pending.getBrowser(ORIGIN, 'pending:workspace-a')).toEqual(BROWSER)
    expect(pending.flush()).toBe(true)
    expect(existsSync(filePath)).toBe(false)

    expect(pending.migrateBrowser(ORIGIN, 'pending:workspace-a', 'chat-resolved')).toBe(true)
    expect(pending.migrateTerminal(ORIGIN, 'pending:workspace-a', 'chat-resolved')).toBe(true)
    expect(pending.flush()).toBe(true)

    const restarted = open(provider)
    restarted.initialize()
    expect(restarted.getBrowser(ORIGIN, 'pending:workspace-a')).toBeNull()
    expect(restarted.getBrowser(ORIGIN, 'chat-resolved')).toEqual(BROWSER)
    expect(restarted.getTerminal(ORIGIN, 'chat-resolved')).toEqual(TERMINAL)
  })

  it('migrates browser and terminal descriptors independently into one durable chat', () => {
    const provider = encryption()
    const store = open(provider)
    store.setBrowser(ORIGIN, 'pending:workspace-a', BROWSER)
    store.setTerminal(ORIGIN, 'pending:workspace-a', TERMINAL)

    expect(store.migrateBrowser(ORIGIN, 'pending:workspace-a', 'chat-resolved')).toBe(true)
    expect(store.getBrowser(ORIGIN, 'chat-resolved')).toEqual(BROWSER)
    expect(store.getTerminal(ORIGIN, 'chat-resolved')).toBeNull()
    expect(store.getBrowser(ORIGIN, 'pending:workspace-a')).toBeNull()
    expect(store.getTerminal(ORIGIN, 'pending:workspace-a')).toEqual(TERMINAL)

    expect(store.migrateTerminal(ORIGIN, 'pending:workspace-a', 'chat-resolved')).toBe(true)
    expect(store.getBrowser(ORIGIN, 'chat-resolved')).toEqual(BROWSER)
    expect(store.getTerminal(ORIGIN, 'chat-resolved')).toEqual(TERMINAL)
    expect(store.getBrowser(ORIGIN, 'pending:workspace-a')).toBeNull()
    expect(store.getTerminal(ORIGIN, 'pending:workspace-a')).toBeNull()

    expect(store.flush()).toBe(true)
    const restarted = open(provider)
    expect(restarted.getBrowser(ORIGIN, 'chat-resolved')).toEqual(BROWSER)
    expect(restarted.getTerminal(ORIGIN, 'chat-resolved')).toEqual(TERMINAL)
  })

  it('also merges the browser descriptor when terminal migration arrives first', () => {
    const store = open()
    store.setBrowser(ORIGIN, 'pending:workspace-a', BROWSER)
    store.setTerminal(ORIGIN, 'pending:workspace-a', TERMINAL)

    expect(store.migrateTerminal(ORIGIN, 'pending:workspace-a', 'chat-resolved')).toBe(true)
    expect(store.migrateBrowser(ORIGIN, 'pending:workspace-a', 'chat-resolved')).toBe(true)

    expect(store.getBrowser(ORIGIN, 'chat-resolved')).toEqual(BROWSER)
    expect(store.getTerminal(ORIGIN, 'chat-resolved')).toEqual(TERMINAL)
    expect(store.getBrowser(ORIGIN, 'pending:workspace-a')).toBeNull()
    expect(store.getTerminal(ORIGIN, 'pending:workspace-a')).toBeNull()
  })

  it('migrates the non-conflicting component without replacing a durable destination', () => {
    const store = open()
    const existingBrowser: BrowserSessionSnapshot = {
      v: 1,
      tabs: [{ url: 'https://existing.example/', pinned: true }],
      activeIndex: 0,
      downloads: [],
    }
    store.setBrowser(ORIGIN, 'chat-existing', existingBrowser)
    store.setBrowser(ORIGIN, 'pending:workspace-a', BROWSER)
    store.setTerminal(ORIGIN, 'pending:workspace-a', TERMINAL)

    expect(store.migrateBrowser(ORIGIN, 'pending:workspace-a', 'chat-existing')).toBe(false)
    expect(store.migrateTerminal(ORIGIN, 'pending:workspace-a', 'chat-existing')).toBe(true)

    expect(store.getBrowser(ORIGIN, 'chat-existing')).toEqual(existingBrowser)
    expect(store.getTerminal(ORIGIN, 'chat-existing')).toEqual(TERMINAL)
    expect(store.getBrowser(ORIGIN, 'pending:workspace-a')).toEqual(BROWSER)
    expect(store.getTerminal(ORIGIN, 'pending:workspace-a')).toBeNull()
  })

  it('keeps identical chat ids isolated across server origins', () => {
    const store = open()
    store.setBrowser(ORIGIN, 'chat-a', BROWSER)
    store.setBrowser('https://self-hosted.example/path', 'chat-a', {
      v: 1,
      tabs: [{ url: 'https://other.example/', pinned: false }],
      activeIndex: 0,
      downloads: [],
    })

    expect(store.getBrowser(ORIGIN, 'chat-a')?.tabs[0].url).toBe('https://example.com/inbox')
    expect(store.getBrowser('https://self-hosted.example', 'chat-a')?.tabs[0].url).toBe(
      'https://other.example/'
    )
  })

  it('preserves every browser and terminal tab while clamping active indexes', () => {
    const provider = encryption()
    const store = open(provider)
    store.setBrowser(ORIGIN, 'chat-a', {
      v: 1,
      tabs: Array.from({ length: 12 }, (_, index) => ({
        url: `https://tab-${index}.example/`,
        pinned: index < 2,
      })),
      activeIndex: 99,
      downloads: [],
    })
    store.setTerminal(ORIGIN, 'chat-a', {
      v: 1,
      tabs: Array.from({ length: 12 }, (_, index) => ({ cwd: `/tmp/tab-${index}` })),
      activeIndex: 99,
    })

    expect(store.flush()).toBe(true)
    const restarted = open(provider)
    const browser = restarted.getBrowser(ORIGIN, 'chat-a')
    const terminal = restarted.getTerminal(ORIGIN, 'chat-a')
    expect(browser?.tabs).toHaveLength(12)
    expect(browser?.activeIndex).toBe(11)
    expect(terminal?.tabs).toHaveLength(12)
    expect(terminal?.activeIndex).toBe(11)
  })

  it('bounds persisted browser tabs while retaining pinned and active entries', () => {
    const store = open()
    const tabs = Array.from({ length: 40 }, (_, index) => ({
      url: `https://tab-${index}.example/`,
      pinned: index < 4,
    }))

    expect(
      store.setBrowser(ORIGIN, 'chat-bounded', {
        v: 1,
        tabs,
        activeIndex: tabs.length - 1,
        downloads: [],
      })
    ).toBe(true)

    const snapshot = store.getBrowser(ORIGIN, 'chat-bounded')
    expect(snapshot?.tabs).toHaveLength(32)
    expect(snapshot?.tabs.filter((tab) => tab.pinned)).toHaveLength(4)
    expect(snapshot?.tabs[snapshot.activeIndex]?.url).toBe('https://tab-39.example/')
  })

  it('filters unsafe or malformed values while loading an encrypted payload', () => {
    const provider = encryption()
    writeEncryptedPayload(provider, {
      v: 1,
      entries: [
        {
          origin: ORIGIN,
          scope: 'chat-valid',
          lastAccessedAt: 3,
          browser: {
            v: 1,
            tabs: [
              { url: 'https://user:password@example.com/private', pinned: false },
              { url: 'file:///Users/ada/.ssh/id_ed25519', pinned: false },
              { url: 'javascript:alert(1)', pinned: true },
              { url: 'about:blank', pinned: false },
              { url: 'http://localhost:3000/path', pinned: true },
              { url: `https://example.com/${'x'.repeat(8_200)}`, pinned: false },
            ],
            activeIndex: 20,
            downloads: [],
          },
          terminal: {
            v: 1,
            tabs: [
              { cwd: '' },
              { cwd: '   ' },
              { cwd: '/tmp\0hidden' },
              { cwd: 'x'.repeat(4_097) },
              { cwd: '/Users/ada/code' },
            ],
            activeIndex: 50,
          },
        },
        {
          origin: ORIGIN,
          scope: 'pending:must-not-load',
          lastAccessedAt: 4,
          browser: BROWSER,
        },
        {
          origin: 'https://user:secret@sim.ai',
          scope: 'chat-bad-origin',
          lastAccessedAt: 5,
          browser: BROWSER,
        },
      ],
    })

    const store = open(provider)
    expect(store.initialize()).toBe(true)
    expect(store.getBrowser(ORIGIN, 'chat-valid')).toEqual({
      v: 1,
      tabs: [
        { url: 'about:blank', pinned: false },
        { url: 'http://localhost:3000/path', pinned: true },
      ],
      activeIndex: 1,
      downloads: [],
    })
    expect(store.getTerminal(ORIGIN, 'chat-valid')).toEqual({
      v: 1,
      tabs: [{ cwd: '/Users/ada/code' }],
      activeIndex: 0,
    })
    expect(store.getBrowser(ORIGIN, 'pending:must-not-load')).toBeNull()
    expect(store.getBrowser(ORIGIN, 'chat-bad-origin')).toBeNull()
  })

  it('rejects persisted browser snapshots without a downloads array', () => {
    const provider = encryption()
    writeEncryptedPayload(provider, {
      v: 1,
      entries: [
        {
          origin: ORIGIN,
          scope: 'chat-missing-downloads',
          lastAccessedAt: 1,
          browser: { v: 1, tabs: [], activeIndex: 0 },
        },
        {
          origin: ORIGIN,
          scope: 'chat-invalid-downloads',
          lastAccessedAt: 2,
          browser: { v: 1, tabs: [], activeIndex: 0, downloads: null },
        },
      ],
    })

    const store = open(provider)
    expect(store.getBrowser(ORIGIN, 'chat-missing-downloads')).toBeNull()
    expect(store.getBrowser(ORIGIN, 'chat-invalid-downloads')).toBeNull()
  })

  it('keeps only the 100 most recently used durable chat entries', () => {
    let timestamp = 1
    const provider = encryption()
    const store = open(provider, () => timestamp++)
    const snapshot: TerminalSessionSnapshot = {
      v: 1,
      tabs: [{ cwd: '/tmp' }],
      activeIndex: 0,
    }

    for (let index = 0; index < 100; index += 1) {
      store.setTerminal(ORIGIN, `chat-${index}`, snapshot)
    }
    expect(store.getTerminal(ORIGIN, 'chat-0')).toEqual(snapshot)
    store.setTerminal(ORIGIN, 'chat-100', snapshot)
    store.flush()

    const restarted = open(provider, () => timestamp++)
    restarted.initialize()
    expect(restarted.getTerminal(ORIGIN, 'chat-0')).toEqual(snapshot)
    expect(restarted.getTerminal(ORIGIN, 'chat-1')).toBeNull()
    expect(restarted.getTerminal(ORIGIN, 'chat-100')).toEqual(snapshot)
  })

  it('applies the durable-entry cap when a pending descriptor is promoted', () => {
    let timestamp = 1
    const store = open(encryption(), () => timestamp++)
    for (let index = 0; index < 100; index += 1) {
      store.setTerminal(ORIGIN, `chat-${index}`, TERMINAL)
    }
    store.setBrowser(ORIGIN, 'pending:new-chat', BROWSER)

    expect(store.migrateBrowser(ORIGIN, 'pending:new-chat', 'chat-promoted')).toBe(true)
    expect(store.getTerminal(ORIGIN, 'chat-0')).toBeNull()
    expect(store.getBrowser(ORIGIN, 'chat-promoted')).toEqual(BROWSER)
  })

  it('stays memory-only with no plaintext fallback when OS encryption is unavailable', () => {
    const provider = encryption(false)
    const store = open(provider)

    expect(store.initialize()).toBe(false)
    expect(store.setBrowser(ORIGIN, 'chat-a', BROWSER)).toBe(true)
    expect(store.getBrowser(ORIGIN, 'chat-a')).toEqual(BROWSER)
    expect(store.flush()).toBe(false)
    expect(provider.encryptString).not.toHaveBeenCalled()
    expect(existsSync(filePath)).toBe(false)
  })

  it('also treats an encryption availability error as unavailable', () => {
    const provider = encryption()
    provider.isEncryptionAvailable = vi.fn(() => {
      throw new Error('keychain is locked')
    })
    const store = open(provider)

    store.setTerminal(ORIGIN, 'chat-a', TERMINAL)
    expect(store.isAvailable()).toBe(false)
    expect(store.flush()).toBe(false)
    expect(existsSync(filePath)).toBe(false)
  })

  it('stays memory-only rather than overwriting corrupt or undecryptable files', () => {
    writeFileSync(filePath, '{not json')
    const corrupt = open()
    expect(corrupt.initialize()).toBe(false)
    expect(corrupt.getBrowser(ORIGIN, 'chat-a')).toBeNull()
    corrupt.setBrowser(ORIGIN, 'chat-new', BROWSER)
    expect(corrupt.flush()).toBe(false)
    expect(readFileSync(filePath, 'utf8')).toBe('{not json')

    const provider = encryption()
    writeFileSync(filePath, JSON.stringify({ v: 1, ciphertext: 'aW52YWxpZA==' }))
    const undecryptable = open(provider)
    expect(undecryptable.initialize()).toBe(false)
    expect(undecryptable.getTerminal(ORIGIN, 'chat-a')).toBeNull()
  })

  it('returns defensive copies and clears both memory and disk', () => {
    const provider = encryption()
    const store = open(provider)
    store.setBrowser(ORIGIN, 'chat-a', BROWSER)

    const read = store.getBrowser(ORIGIN, 'chat-a')
    if (!read) throw new Error('expected browser snapshot')
    read.tabs[0].url = 'https://mutated.example/'
    expect(store.getBrowser(ORIGIN, 'chat-a')).toEqual(BROWSER)

    store.flush()
    expect(existsSync(filePath)).toBe(true)
    store.clear()
    expect(store.getBrowser(ORIGIN, 'chat-a')).toBeNull()
    expect(existsSync(filePath)).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })
})
