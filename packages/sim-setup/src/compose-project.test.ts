import { describe, expect, it } from 'vitest'
import { legacyComposeProjectName, standaloneComposeProjectName } from './compose-project'

describe('standaloneComposeProjectName', () => {
  it('is stable for one installation directory', () => {
    expect(standaloneComposeProjectName('/srv/one/sim')).toBe(
      standaloneComposeProjectName('/srv/one/sim')
    )
  })

  it('isolates installations that share the same directory basename', () => {
    expect(standaloneComposeProjectName('/srv/one/sim')).not.toBe(
      standaloneComposeProjectName('/srv/two/sim')
    )
  })

  it('produces a valid Compose project name without exposing the path', () => {
    expect(standaloneComposeProjectName('/Users/example/Customer Project/sim')).toMatch(
      /^sim-[0-9a-f]{12}$/
    )
  })

  it('retains the directory-derived name for legacy installations', () => {
    expect(legacyComposeProjectName('/srv/Sim.Demo')).toBe('simdemo')
    expect(() => legacyComposeProjectName('/srv/---')).toThrow(/Cannot derive/)
  })
})
