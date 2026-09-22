import { describe, expect, it } from 'vitest'
import { htmlContentOrigin } from '@/lib/workspace-files/html-runtime/config'

describe('HTML content origin', () => {
  it('allows file.simstudio.ai with the application on sim.ai', () => {
    expect(htmlContentOrigin('https://file.simstudio.ai', 'https://sim.ai')).toBe(
      'https://file.simstudio.ai'
    )
  })
  it.each([
    undefined,
    'https://sim.ai',
    'https://file.sim.ai',
    'https://file.simstudio.ai/path',
    'https://user:password@file.simstudio.ai',
    'http://file.simstudio.ai',
    'http://localhost:3001',
  ])('rejects unsafe production configuration %s', (origin) => {
    expect(() => htmlContentOrigin(origin, 'https://sim.ai')).toThrow()
  })
  it('allows separate local hosts for development', () => {
    expect(htmlContentOrigin('http://127.0.0.1:3000', 'http://localhost:3000')).toBe(
      'http://127.0.0.1:3000'
    )
  })
  it('rejects different ports on the same host, where cookies are shared', () => {
    expect(() => htmlContentOrigin('http://localhost:3001', 'http://localhost:3000')).toThrow()
  })
})
