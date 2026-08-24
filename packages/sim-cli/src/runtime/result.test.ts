/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec } from '../contract/types'
import { renderPage, renderResult } from './result'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The table arrives as one string; its first line is the header. */
function tableLines(): string[] {
  return logged.join('\n').split('\n')
}

describe('single-record output is only clamped for the human table', () => {
  const url = `https://sim-storage.example.com/exports/probe.csv?X-Amz-Signature=${'a'.repeat(300)}`

  it('keeps the whole value in text, which exists to be piped', () => {
    renderResult('tableExportDownload', 'text', { url }, {})
    expect(logged[0]).toBe(`url\t${url}`)
  })

  it('keeps the whole value in json', () => {
    renderResult('tableExportDownload', 'json', { url }, {})
    expect(JSON.parse(logged[0])).toEqual({ url })
  })

  it('clamps the value in table mode', () => {
    renderResult('tableExportDownload', 'table', { url }, {})
    expect(logged[0]).toMatch(/…$/)
    expect(logged[0].length).toBeLessThan(url.length)
  })
})

describe('inferred cells pick a format from the key shape', () => {
  const row = {
    createdAt: '2026-08-17T20:35:38.478Z',
    durationMs: 9.145596999907866,
    size: 3000000,
    isActive: true,
    deletedAt: null,
    rowCount: 0,
    displayName: 'probe',
  }

  it('formats timestamps, durations, byte counts and booleans in a record', () => {
    renderResult('getTable', 'text', row, {})
    expect(logged).toEqual([
      'created at\t2026-08-17 20:35:38',
      'duration\t9ms',
      'size\t2.9 MB',
      'active\tyes',
      'deleted at\t',
      'row count\t0',
      'display name\tprobe',
    ])
  })

  it('de-camelCases inferred table headers', () => {
    renderPage('table', [row], {})
    expect(tableLines()[0].split(/\s{2,}/)).toEqual([
      'CREATED AT',
      'DURATION',
      'SIZE',
      'ACTIVE',
      'DELETED AT',
      'ROW COUNT',
      'DISPLAY NAME',
    ])
  })

  it('leaves json and yaml on the raw payload', () => {
    renderResult('getTable', 'json', row, {})
    renderResult('getTable', 'yaml', row, {})
    expect(JSON.parse(logged[0])).toEqual(row)
    expect(logged[1]).toContain('durationMs: 9.145596999907866')
  })

  it('infers nothing when the value type disagrees with the key', () => {
    renderResult('getTable', 'text', { size: 'small', createdAt: 'whenever', isActive: 'yes' }, {})
    expect(logged).toEqual(['size\tsmall', 'created at\twhenever', 'is active\tyes'])
  })

  it('rounds a relevance score to a readable precision', () => {
    renderResult('searchKnowledge', 'text', { similarity: 0.2818676545790171 }, {})
    expect(logged[0]).toBe('similarity\t0.2819')
  })

  it('leaves explicit column formats alone', () => {
    const spec: CommandSpec = {
      columns: [{ header: 'size', format: 'auto' }],
    }
    renderPage('text', [{ size: 3000000 }], spec)
    expect(logged[0]).toBe('3000000')
  })
})

describe('cells the user named, not the API', () => {
  // `tables rows list` and `tables rows query` expand `data`, whose keys are
  // whatever the caller called their columns. A key shape is a promise about
  // the value, and only the API's own field names carry one.
  const rows = [{ id: 'row_1', data: { score: 3, size: 5, duration: 30, isBillable: true } }]
  const spec: CommandSpec = { expand: 'data' }

  it('leaves a user column named like an API field alone', () => {
    renderPage('text', rows, spec)
    expect(logged[0]).toBe('row_1\t3\t5\t30\ttrue')
  })

  it('heads each one with the name the user has to type back into --filter', () => {
    renderPage('table', rows, spec)
    expect(tableLines()[0].split(/\s{2,}/)).toEqual([
      'ID',
      'SCORE',
      'SIZE',
      'DURATION',
      'ISBILLABLE',
    ])
  })
})

describe('a folder path the operation declared no column for', () => {
  it('is decoded in the record the create echoes back', () => {
    // `tables folders create 'Reports/Q1 2026'` answered `/Reports/Q1%202026`
    // while the `ls` right after it showed the same folder decoded.
    renderResult(
      'createTableFolder',
      'text',
      { name: 'Q1 2026', path: '/Reports/Q1%202026', parentPath: '/Reports' },
      {}
    )
    expect(logged).toContain('path\t/Reports/Q1 2026')
  })

  it('stays in wire form in json, which is what gets fed back', () => {
    renderResult('createTableFolder', 'json', { path: '/Reports/Q1%202026' }, {})
    expect(JSON.parse(logged[0])).toEqual({ path: '/Reports/Q1%202026' })
  })
})

describe('a declared field that the API stops returning', () => {
  const spec: CommandSpec = {
    fields: [
      { header: 'plan' },
      { header: 'credits used', path: 'credits.used' },
      { header: 'credits limit', path: 'credits.limit' },
    ],
  }

  it('is reported as absent rather than dropped', () => {
    renderResult('getBillingStatus', 'table', { plan: 'team' }, spec)
    expect(logged).toHaveLength(3)
    expect(logged[1]).toContain('credits used')
    expect(logged[2]).toContain('credits limit')
  })

  it('stays an empty field in text, so cut -f2 still lines up', () => {
    renderResult('getBillingStatus', 'text', { plan: 'team' }, spec)
    expect(logged).toEqual(['plan\tteam', 'credits used\t', 'credits limit\t'])
  })
})

describe('a similarity score, at a width a person can read', () => {
  const results = {
    results: [
      { similarity: 0.2818957269585687, documentName: 'a.md', chunkIndex: 0, content: 'x' },
    ],
  }
  const spec = CLI_CONTRACT.searchKnowledge as CommandSpec

  it('fixes the score to four decimals in the table', () => {
    // The raw double is nineteen characters wide and its last dozen digits
    // separate nothing: every row shares them to within a rounding error.
    renderResult('searchKnowledge', 'table', results, spec)
    const [, row] = tableLines()
    expect(row).toContain('0.2819')
    expect(row).not.toContain('0.2818957269585687')
  })

  it('leaves the full double in json, which is what a script compares', () => {
    renderResult('searchKnowledge', 'json', results, spec)
    expect(JSON.parse(logged[0]).results[0].similarity).toBe(0.2818957269585687)
  })
})

describe('folder paths are shown by name, but piped in wire form', () => {
  const folders = [
    {
      path: '/cli-test-a/nested%20one',
      name: 'nested one',
      parentPath: '/cli-test-a',
      updatedAt: '2026-08-17T20:35:38.478Z',
    },
  ]
  const spec = CLI_CONTRACT.listTableFolders as CommandSpec

  it('decodes the path in the table, which held it next to the decoded name', () => {
    renderPage('table', folders, spec)
    const [, row] = tableLines()
    expect(row).toContain('/cli-test-a/nested one')
    expect(row).not.toContain('%20')
  })

  it('decodes the path in text, the format shell plumbing reads', () => {
    renderPage('text', folders, spec)
    expect(logged[0].split('\t')[0]).toBe('/cli-test-a/nested one')
  })

  it('keeps the wire form in json, so a path fed back still resolves', () => {
    renderPage('json', folders, spec)
    expect(JSON.parse(logged[0])[0].path).toBe('/cli-test-a/nested%20one')
  })

  it('keeps the wire form in yaml for the same reason', () => {
    renderPage('yaml', folders, spec)
    expect(logged[0]).toContain('/cli-test-a/nested%20one')
  })

  it('decodes a declared record field too', () => {
    renderResult(
      'getFile',
      'text',
      { id: 'f_1', folderPath: '/cli-test-a/nested%20one' },
      CLI_CONTRACT.getFile as CommandSpec
    )
    expect(logged).toContain('folder\t/cli-test-a/nested one')
  })

  it('shows the canonical web URL in file details', () => {
    const webUrl = 'https://www.sim.ai/workspace/ws-1/files/f_1'
    renderResult('getFile', 'text', { id: 'f_1', webUrl }, CLI_CONTRACT.getFile as CommandSpec)
    expect(logged).toContain(`web URL\t${webUrl}`)
  })

  it('shows an undecodable path as it arrived rather than dropping it', () => {
    renderPage('text', [{ path: '/100%zz', name: 'x', parentPath: '/', updatedAt: null }], spec)
    expect(logged[0].split('\t')[0]).toBe('/100%zz')
  })
})
