import { describe, expect, it } from 'bun:test'
import { getComposeUpdateMode, isLifecycleCommand } from './lifecycle.ts'

describe('setup lifecycle', () => {
  it('recognizes update as a lifecycle command', () => {
    expect(isLifecycleCommand('update')).toBe(true)
  })

  it('pulls published installs and rebuilds source installs', () => {
    expect(getComposeUpdateMode('/repo/docker-compose.prod.yml')).toBe('pull')
    expect(getComposeUpdateMode('/repo/docker-compose.local.yml')).toBe('build')
    expect(() => getComposeUpdateMode('/repo/compose.yml')).toThrow(/Unsupported Sim Compose file/)
  })
})
