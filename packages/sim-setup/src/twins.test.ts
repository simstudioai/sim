import { describe, expect, it } from 'vitest'
import { FLAG_TWINS } from './twins'

describe('setup environment twins', () => {
  it('keeps the Slack server and browser capability values coherent', () => {
    expect(FLAG_TWINS).toContainEqual({
      server: 'SLACK_EXTENDED_SCOPES',
      client: 'NEXT_PUBLIC_SLACK_EXTENDED_SCOPES',
    })
  })
})
