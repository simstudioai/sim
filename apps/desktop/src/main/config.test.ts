import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_NAME_FOR_CHANNEL,
  channelForOrigin,
  createConfigStore,
  DEFAULT_ORIGIN,
  isSafeInternalPath,
  partitionForOrigin,
  validateOriginInput,
} from '@/main/config'

function tempSettingsPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'sim-desktop-config-')), 'settings.json')
}

describe('validateOriginInput', () => {
  it('accepts https and normalizes to the origin', () => {
    expect(validateOriginInput('https://sim.ai')).toEqual({ ok: true, origin: 'https://sim.ai' })
    expect(validateOriginInput(' https://sim.example.com/path?q=1 ')).toEqual({
      ok: true,
      origin: 'https://sim.example.com',
    })
    expect(validateOriginInput('https://sim.example.com:8443')).toEqual({
      ok: true,
      origin: 'https://sim.example.com:8443',
    })
  })

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
  it('uses the canonical partition for the default origin', () => {
    expect(partitionForOrigin(DEFAULT_ORIGIN)).toBe('persist:sim')
  })

  it('gives every other origin an isolated persistent partition', () => {
    const partition = partitionForOrigin('https://self-hosted.example:8443')
    expect(partition).toMatch(/^persist:sim-/)
    expect(partition).not.toBe(partitionForOrigin('https://other.example'))
  })
})

describe('isSafeInternalPath', () => {
  it('accepts absolute same-origin paths with query', () => {
    expect(isSafeInternalPath('/workspace/ws1?tab=logs')).toBe(true)
    expect(isSafeInternalPath('/')).toBe(true)
  })

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
  it('round-trips settings through disk', () => {
    const filePath = tempSettingsPath()
    const store = createConfigStore(filePath, {})
    expect(store.getOrigin()).toBe(DEFAULT_ORIGIN)
    store.set('zoomLevel', 1.5)
    store.set('lastRoute', '/workspace/ws1')

    const reloaded = createConfigStore(filePath, {})
    expect(reloaded.get('zoomLevel')).toBe(1.5)
    expect(reloaded.get('lastRoute')).toBe('/workspace/ws1')
  })

  it('persists a validated origin and rejects invalid input', () => {
    const filePath = tempSettingsPath()
    const store = createConfigStore(filePath, {})
    expect(store.setOrigin('https://self-hosted.example').ok).toBe(true)
    expect(store.getOrigin()).toBe('https://self-hosted.example')
    expect(store.setOrigin('http://evil.example').ok).toBe(false)
    expect(store.getOrigin()).toBe('https://self-hosted.example')

    const reloaded = createConfigStore(filePath, {})
    expect(reloaded.getOrigin()).toBe('https://self-hosted.example')
  })

  it('recovers from a corrupted settings file', () => {
    const filePath = tempSettingsPath()
    writeFileSync(filePath, '{not json')
    const store = createConfigStore(filePath, {})
    expect(store.getOrigin()).toBe(DEFAULT_ORIGIN)
  })

  it('falls back to the default origin when the stored origin is invalid', () => {
    const filePath = tempSettingsPath()
    writeFileSync(filePath, JSON.stringify({ origin: 'http://evil.example' }))
    const store = createConfigStore(filePath, {})
    expect(store.getOrigin()).toBe(DEFAULT_ORIGIN)
  })

  it('honors a valid SIM_DESKTOP_ORIGIN override without persisting it', () => {
    const filePath = tempSettingsPath()
    const store = createConfigStore(filePath, { SIM_DESKTOP_ORIGIN: 'http://127.0.0.1:4600' })
    expect(store.getOrigin()).toBe('http://127.0.0.1:4600')
    store.set('zoomLevel', 1)
    expect(JSON.parse(readFileSync(filePath, 'utf8')).origin).toBe(DEFAULT_ORIGIN)
  })

  it('ignores an invalid SIM_DESKTOP_ORIGIN override', () => {
    const store = createConfigStore(tempSettingsPath(), {
      SIM_DESKTOP_ORIGIN: 'http://evil.example',
    })
    expect(store.getOrigin()).toBe(DEFAULT_ORIGIN)
  })
})

describe('channelForOrigin', () => {
  it('maps each environment origin to its channel', () => {
    expect(channelForOrigin('https://sim.ai')).toBe('prod')
    expect(channelForOrigin('https://www.sim.ai')).toBe('prod')
    expect(channelForOrigin('https://www.dev.sim.ai')).toBe('dev')
    expect(channelForOrigin('https://dev.sim.ai')).toBe('dev')
    expect(channelForOrigin('https://www.staging.sim.ai')).toBe('staging')
    expect(channelForOrigin('http://localhost:3000')).toBe('local')
    expect(channelForOrigin('http://127.0.0.1:3000')).toBe('local')
  })

  it('treats self-hosted and garbage origins as prod', () => {
    expect(channelForOrigin('https://sim.mycompany.com')).toBe('prod')
    expect(channelForOrigin('not a url')).toBe('prod')
  })

  it('gives every channel a distinct app identity, prod keeping the plain name', () => {
    expect(APP_NAME_FOR_CHANNEL.prod).toBe('Sim')
    const names = Object.values(APP_NAME_FOR_CHANNEL)
    expect(new Set(names).size).toBe(names.length)
  })
})
