import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import type { SourceStatus } from '@sim/workspace-code/status'
import { describe, expect, it } from 'vitest'
import { nextStep, pathFilter } from './source-status'

describe('pathFilter', () => {
  it('reads a filter with a long run of slashes before its last segment in linear time', () => {
    expectLinearGrowth((n) => {
      const filter = `wf${'/'.repeat(n)}workflow.ts`
      return () => pathFilter([filter], '.')
    }, 4_000)
  })
})

describe('nextStep', () => {
  const input = {
    prefix: 'sim workflows source',
    dir: './my wf',
    getArgs: 'wf_1 ',
    server: 'checked' as const,
    errors: 0,
    deletes: false,
    scope: '',
  }
  const edited: SourceStatus = {
    state: 'local',
    local: [{ kind: 'workflow', key: 'wf_1', change: 'edited', files: [] }],
    drift: [],
    conflicts: [],
  }

  it('quotes a directory with a space in each command it recommends, so it runs as printed', () => {
    expect(nextStep(edited, input)?.command).toBe(
      "sim workflows source apply --dir './my wf' --yes"
    )
    expect(nextStep(edited, { ...input, server: 'unreachable' })?.command).toBe(
      "sim workflows source apply --dir './my wf' --dry"
    )
    const drifted: SourceStatus = {
      ...edited,
      state: 'drift',
      local: [],
      drift: [{ kind: 'workflow', key: 'wf_1', server: 'changed' }],
    }
    expect(nextStep(drifted, input)?.command).toBe("sim workflows source get wf_1 --dir './my wf'")
  })
})
