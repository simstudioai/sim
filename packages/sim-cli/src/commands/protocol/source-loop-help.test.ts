import { describe, expect, it } from 'vitest'
import { WORKFLOW_SOURCE_LOOP_HELP } from './source-loop-help'
import { sourcePrimer } from './source-primer'

describe('the edit loop of sim workflows source --help', () => {
  it('chains the same test run the primer does', () => {
    const primerRun = sourcePrimer('workflow').match(/&& (sim workflows run [^`]+)`/)?.[1]
    expect(primerRun).toBeDefined()
    expect(WORKFLOW_SOURCE_LOOP_HELP).toContain(`&& ${primerRun}`)
  })
})
