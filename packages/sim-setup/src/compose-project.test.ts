import { describe, expect, it } from 'vitest'
import { standaloneComposeProjectName } from './compose-project'

describe('standaloneComposeProjectName', () => {
  it('isolates installations that share the same directory basename', () => {
    expect(standaloneComposeProjectName('/srv/one/sim')).not.toBe(
      standaloneComposeProjectName('/srv/two/sim')
    )
  })
})
