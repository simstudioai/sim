import { describe, expect, it } from 'vitest'
import { auditLedger } from './check-platform-parity'

const HEADER =
  '| Capability | Legacy source | Status | Proof or reason |\n| --- | --- | --- | --- |\n'

function audit(rows: string, run?: Map<string, string>) {
  return auditLedger({
    ledger: `${HEADER}${rows}`,
    testFiles: new Set(['home.spec.ts', 'home-model.test.ts']),
    liveTitles: ['a role change persists and a failed one is reported'],
    run,
  })
}

describe('auditLedger', () => {
  it('accepts a Done row that quotes a live test or names a test file', () => {
    expect(audit('| Role | x | Done | "a role change persists" |\n')).toEqual([])
    expect(audit('| States | x | Done | `home-model.test.ts` |\n')).toEqual([])
  })

  it('refuses a Done row with no test behind it', () => {
    expect(audit('| Role | x | Done | Static reading |\n')[0]).toContain('no test named')
    expect(audit('| Role | x | Unverified | Static reading |\n')).toEqual([])
  })

  it('refuses a proof that does not exist', () => {
    expect(audit('| Role | x | Done | "nothing like this" |\n')[0]).toContain('does not exist')
    expect(audit('| Role | x | Open | `gone.spec.ts` |\n')[0]).toContain('does not exist')
  })

  it('refuses a malformed row', () => {
    expect(audit('| Role | x | Done |\n')[0]).toContain('expected 4 cells')
    expect(audit('| Role | x | Shipped | y |\n')[0]).toContain('unknown status')
    expect(audit('| Role | x | Open |  |\n')[0]).toContain('gives no proof')
  })

  it('refuses a Done row whose test did not pass in the given run', () => {
    const title = 'a role change persists and a failed one is reported'
    const row = '| Role | x | Done | "a role change persists" |\n'
    expect(audit(row, new Map([[title, 'passed']]))).toEqual([])
    expect(audit(row, new Map([[title, 'failed']]))[0]).toContain('failed in this run')
    expect(audit(row, new Map([[title, 'skipped']]))[0]).toContain('skipped in this run')
    expect(audit(row, new Map())[0]).toContain('did not run')
  })
})
