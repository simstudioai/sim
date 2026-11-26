import { describe, expect, it } from 'vitest'
import { WORKFLOW_SOURCE_LOOP_HELP } from './source-loop-help'
import { sourcePrimer } from './source-primer'

describe('the edit loop of sim workflows source --help', () => {
  it('chains the same check, apply, test run and deploy the primer does', () => {
    const primerLoop = sourcePrimer('workflow').match(/`(sim workflows source check [^`]+)`/)?.[1]
    expect(primerLoop).toContain('--run')
    expect(WORKFLOW_SOURCE_LOOP_HELP).toContain(primerLoop?.replaceAll('--dir .', '--dir ./wf'))
  })
})
