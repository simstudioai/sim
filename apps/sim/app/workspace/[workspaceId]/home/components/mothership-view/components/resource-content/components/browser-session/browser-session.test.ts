import { describe, expect, it } from 'vitest'
import { resolveUrlBarInput } from './browser-session'

describe('resolveUrlBarInput', () => {
  it('passes explicit schemes through untouched', () => {
    expect(resolveUrlBarInput('https://sim.ai/docs')).toBe('https://sim.ai/docs')
    expect(resolveUrlBarInput('http://localhost:3000/workspace')).toBe(
      'http://localhost:3000/workspace'
    )
  })

  it('defaults host-looking input to https', () => {
    expect(resolveUrlBarInput('google.com')).toBe('https://google.com')
    expect(resolveUrlBarInput('docs.sim.ai/agents?tab=1')).toBe('https://docs.sim.ai/agents?tab=1')
  })

  it('defaults localhost and loopback IPs to http (local dev servers rarely speak TLS)', () => {
    expect(resolveUrlBarInput('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveUrlBarInput('localhost')).toBe('http://localhost')
    expect(resolveUrlBarInput('127.0.0.1:8080/health')).toBe('http://127.0.0.1:8080/health')
  })

  it('treats non-URL input as a Google search', () => {
    expect(resolveUrlBarInput('best pizza near me')).toBe(
      'https://www.google.com/search?q=best%20pizza%20near%20me'
    )
    expect(resolveUrlBarInput('what is sim.ai pricing')).toBe(
      'https://www.google.com/search?q=what%20is%20sim.ai%20pricing'
    )
    expect(resolveUrlBarInput('electron')).toBe('https://www.google.com/search?q=electron')
  })
})
