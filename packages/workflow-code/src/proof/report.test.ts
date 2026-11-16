import { describe, expect, it } from 'vitest'
import { createProofReport, reportPathVariable } from './report'

describe('createProofReport', () => {
  it('computes parity per block type from decided outcomes only', () => {
    const report = createProofReport('roundtrip-corpus')
    report.record({
      caseId: 'a',
      blockTypes: ['slack', 'start_trigger'],
      property: 'P1',
      status: 'passed',
    })
    report.record({ caseId: 'b', blockTypes: ['slack'], property: 'P1', status: 'failed' })
    report.record({ caseId: 'c', blockTypes: ['slack'], property: 'P1', status: 'skipped' })
    report.record({
      caseId: 'd',
      blockTypes: ['slack', 'slack'],
      property: 'P1',
      status: 'errored',
    })
    const built = report.build({ generatedAt: 'now' })
    expect(built.parity.slack?.P1).toEqual({
      passed: 1,
      failed: 1,
      skipped: 1,
      errored: 1,
      rate: 1 / 3,
    })
    expect(built.parity.start_trigger?.P1?.rate).toBe(1)
    expect(built.status).toBe('failed')
    expect(built.caseCount).toBe(4)
    expect(built.failures.map((f) => f.caseId)).toEqual(['b', 'd'])
  })

  it('reports a run with a skipped property as incomplete, never passed', () => {
    const report = createProofReport('roundtrip-corpus')
    report.record({ caseId: 'a', blockTypes: ['agent'], property: 'O1', status: 'passed' })
    report.skipProperty('P1', 'missing @sim/workflow-code#printWorkflow')
    expect(report.build({ generatedAt: 'now' }).status).toBe('incomplete')
  })

  it('caps the failure list and counts the overflow', () => {
    const report = createProofReport('s', { failureLimit: 2 })
    for (const id of ['a', 'b', 'c']) {
      report.record({ caseId: id, blockTypes: [], property: 'O2', status: 'failed' })
    }
    const built = report.build({ generatedAt: 'now' })
    expect(built.failures).toHaveLength(2)
    expect(built.truncatedFailures).toBe(1)
  })

  it('derives the report path variable from the suite name', () => {
    expect(reportPathVariable('roundtrip-corpus')).toBe('ROUNDTRIP_CORPUS_REPORT_PATH')
  })
})
