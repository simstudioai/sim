import { describe, expect, it } from 'vitest'
import { auditLedger } from './check-platform-parity'

const HEADER =
  '| Capability | Legacy source | Status | Proof or reason |\n| --- | --- | --- | --- |\n'

function audit(rows: string, run?: Map<string, string>, job?: 'product' | 'self-hosted') {
  return auditLedger({
    ledger: `${HEADER}${rows}`,
    testFiles: new Set(['home.spec.ts', 'home-model.test.ts']),
    liveTitles: ['a role change persists and a failed one is reported'],
    run,
    job,
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

  it('refuses a capability listed twice in one domain', () => {
    const row = '| Role | x | Open | Not yet |\n'
    expect(audit(`${row}${row}`)[0]).toContain('repeats the row at line 3')
    const domains =
      '| Domain | Capability | Legacy source | Status | Proof or reason |\n| --- | --- | --- | --- | --- |\n'
    expect(
      auditLedger({
        ledger: `${domains}| Chat | Role | x | Open | a |\n| Search | Role | x | Open | a |\n| Chat | Role | y | Open | b |\n`,
        testFiles: new Set(),
        liveTitles: [],
      })
    ).toEqual([
      expect.stringContaining('org-parity.md:5: "Role" in Chat repeats the row at line 3'),
    ])
  })

  it('lets a section point back at a Domain row of the same name', () => {
    const ledger = `| Domain | Capability | Legacy source | Status | Proof or reason |\n| --- | --- | --- | --- | --- |\n| Shell | Inbox | None | Hidden | a |\n\n## Shell\n\n${HEADER}| Inbox | None | Hidden | See above |\n`
    expect(auditLedger({ ledger, testFiles: new Set(), liveTitles: [] })).toEqual([])
  })

  it('refuses a Done row whose test did not pass in the given run', () => {
    const title = 'a role change persists and a failed one is reported'
    const row = '| Role | x | Done | "a role change persists" |\n'
    expect(audit(row, new Map([[title, 'passed']]))).toEqual([])
    expect(audit(row, new Map([[title, 'failed']]))[0]).toContain('failed in this run')
    expect(audit(row, new Map([[title, 'skipped']]))[0]).toContain('skipped in this run')
    expect(audit(row, new Map())[0]).toContain('did not run')
  })

  it('holds each live job to its own rows, and neither to the other', () => {
    const title = 'a role change persists and a failed one is reported'
    const productRow = '| Role | x | Done | "a role change persists" |\n'
    const selfHostedRow =
      '| Role | x | Done | "a role change persists", in the `live (self-hosted)` job |\n'

    expect(audit(selfHostedRow, new Map(), 'product')).toEqual([])
    expect(audit(productRow, new Map(), 'self-hosted')).toEqual([])

    expect(audit(productRow, new Map(), 'product')[0]).toContain('did not run')
    expect(audit(selfHostedRow, new Map(), 'self-hosted')[0]).toContain('did not run')
    expect(audit(selfHostedRow, new Map([[title, 'failed']]), 'self-hosted')[0]).toContain('failed')
    expect(audit(selfHostedRow, new Map([[title, 'passed']]), 'self-hosted')).toEqual([])
  })

  it('still refuses a row in another job when its test does not exist', () => {
    const row = '| Role | x | Done | "nothing like this", in the `live (self-hosted)` job |\n'
    expect(audit(row, new Map(), 'product')[0]).toContain('does not exist')
  })
})
