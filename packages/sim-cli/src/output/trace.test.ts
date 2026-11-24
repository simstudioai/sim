import { beforeEach, describe, expect, it, vi } from 'vitest'
import { printTraceSpans } from './trace'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

describe('printTraceSpans', () => {
  it('shows which deployment version a child workflow call ran', () => {
    printTraceSpans('text', [
      {
        id: 'span-1',
        name: 'Score',
        type: 'workflow',
        blockId: 'wf-1',
        childDeploymentVersionId: 'dv-7',
      },
    ])

    expect(logged.join('\n')).toContain('child version: dv-7')
  })
})
