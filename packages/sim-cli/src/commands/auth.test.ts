import { describe, expect, it } from 'vitest'
import { profilesCommand } from './auth'

describe('profiles command', () => {
  it('accepts the singular profile alias', () => {
    expect(profilesCommand().alias()).toBe('profile')
  })
})
