import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalOrigin,
  createConfigStore,
  DEFAULT_ORIGIN,
  isSafeInternalPath,
  isSimCloudOrigin,
  partitionForOrigin,
  validateOriginInput,
} from '@/main/config'

function tempSettingsPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'sim-desktop-config-')), 'settings.json')
}

describe('validateOriginInput', () => {
  it('accepts http only for loopback hosts', () => {
    expect(validateOriginInput('http://localhost:3000')).toEqual({
      ok: true,
      origin: 'http://localhost:3000',
    })
    expect(validateOriginInput('http://127.0.0.1:3000').ok).toBe(true)
    expect(validateOriginInput('http://evil.example').ok).toBe(false)
  })

  it('rejects credentials, bad schemes, and garbage', () => {
    expect(validateOriginInput('https://user:pass@sim.ai').ok).toBe(false)
    expect(validateOriginInput('ftp://sim.ai').ok).toBe(false)
    expect(validateOriginInput('sim.ai').ok).toBe(false)
    expect(validateOriginInput('').ok).toBe(false)
  })
})

describe('partitionForOrigin', () => {
  it('gives every other origin an isolated persistent partition', () => {
    const partition = partitionForOrigin('https://self-hosted.example:8443')
    expect(partition).toMatch(/^persist:sim-/)
    expect(partition).not.toBe(partitionForOrigin('https://other.example'))
  })
})

describe('canonicalOrigin', () => {
  it('keeps a rewritten install on its existing cookie partition', () => {
    // The whole point of rewriting rather than leaving the apex in place: the
    // apex no longer equals DEFAULT_ORIGIN, so an un-rewritten install would
    // be moved to a fresh empty jar and silently signed out on update.
    expect(partitionForOrigin(canonicalOrigin('https://sim.ai'))).toBe('persist:sim')
    expect(partitionForOrigin('https://sim.ai')).not.toBe('persist:sim')
  })
})

describe('isSafeInternalPath', () => {
  it('rejects protocol-relative, backslash, absolute, and oversized values', () => {
    expect(isSafeInternalPath('//evil.example')).toBe(false)
    expect(isSafeInternalPath('/a\\evil')).toBe(false)
    expect(isSafeInternalPath('https://evil.example/x')).toBe(false)
    expect(isSafeInternalPath('workspace')).toBe(false)
    expect(isSafeInternalPath('')).toBe(false)
    expect(isSafeInternalPath(`/${'a'.repeat(2100)}`)).toBe(false)
    expect(isSafeInternalPath(42)).toBe(false)
  })
})

describe('createConfigStore', () => {
  it('does not carry settings across an invalid stored origin or retain them after repair', () => {
    const filePath = tempSettingsPath()
    const original = JSON.stringify({
      origin: 'http://evil.example',
      browserKnownSites: [{ hostname: 'private.example', lastVisitedAt: '2026-01-01' }],
      browserDownloadDirectory: '/private/downloads',
    })
    writeFileSync(filePath, original)
    const store = createConfigStore(filePath, {})

    expect(store.isPersistenceAvailable()).toBe(false)
    expect(store.getOrigin()).toBe(DEFAULT_ORIGIN)
    expect(store.get('browserKnownSites')).toBeUndefined()
    expect(store.get('browserDownloadDirectory')).toBeUndefined()
    store.set('zoomLevel', 2)
    store.flush()
    expect(readFileSync(filePath, 'utf8')).toBe(original)

    expect(store.setOrigin('https://self-hosted.example').ok).toBe(true)
    const repaired = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(repaired.browserKnownSites).toBeUndefined()
    expect(repaired.browserDownloadDirectory).toBeUndefined()
    expect(readFileSync(filePath, 'utf8')).not.toContain('private.example')
  })

  it('keeps the active origin unchanged when its immediate write fails', () => {
    const filePath = tempSettingsPath()
    const parent = dirname(filePath)
    const store = createConfigStore(filePath, {})
    rmSync(parent, { recursive: true })
    writeFileSync(parent, 'not a directory')

    try {
      expect(store.setOrigin('https://sim.example.com')).toEqual({
        ok: false,
        error: 'Could not save the desktop settings file',
      })
      expect(store.getOrigin()).toBe(DEFAULT_ORIGIN)
      expect(store.isPersistenceAvailable()).toBe(false)

      rmSync(parent)
      mkdirSync(parent)
      expect(store.setOrigin('https://sim.example.com')).toEqual({
        ok: true,
        origin: 'https://sim.example.com',
      })
      expect(store.isPersistenceAvailable()).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('isSimCloudOrigin', () => {
  it('recognizes Sim-operated origins and nothing else', () => {
    for (const origin of ['https://sim.ai', 'https://www.sim.ai', 'https://www.staging.sim.ai']) {
      expect(isSimCloudOrigin(origin)).toBe(true)
    }
    // A lookalike host must not pass — the suffix check is on the parsed
    // hostname, never a prefix or substring of the raw string.
    for (const origin of [
      'https://sim.example.com',
      'https://sim.ai.evil.example',
      'https://notsim.ai',
      'http://localhost:3000',
      'not a url',
    ]) {
      expect(isSimCloudOrigin(origin)).toBe(false)
    }
  })
})
