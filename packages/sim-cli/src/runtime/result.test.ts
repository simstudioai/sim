/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec } from '../contract/types'
import { encodeFolderPath } from './request'
import { decodeFolderPath, renderPage, renderResult } from './result'

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
    renderPage('table', { data: [row], nextCursor: null }, {})
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
    renderPage('text', { data: [{ size: 3000000 }], nextCursor: null }, spec)
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
    renderPage('text', { data: rows, nextCursor: null }, spec)
    expect(logged[0]).toBe('row_1\t3\t5\t30\ttrue')
  })

  it('heads each one with the name the user has to type back into --filter', () => {
    renderPage('table', { data: rows, nextCursor: null }, spec)
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

describe('file-content search results', () => {
  const response = {
    results: [{ fileId: 'file_1', lineNumber: 7, text: 'quarterly revenue' }],
    total: 1,
  }
  const spec = CLI_CONTRACT.searchFileContent as CommandSpec

  it('renders result rows instead of the response envelope', () => {
    renderResult('searchFileContent', 'text', response, spec)
    expect(logged).toEqual(['file_1\t7\tquarterly revenue'])
  })

  it('preserves the response envelope for json output', () => {
    renderResult('searchFileContent', 'json', response, spec)
    expect(JSON.parse(logged[0])).toEqual(response)
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
    renderPage('table', { data: folders, nextCursor: null }, spec)
    const [, row] = tableLines()
    expect(row).toContain('/cli-test-a/nested one')
    expect(row).not.toContain('%20')
  })

  it('decodes the path in text, the format shell plumbing reads', () => {
    renderPage('text', { data: folders, nextCursor: null }, spec)
    expect(logged[0].split('\t')[0]).toBe('/cli-test-a/nested one')
  })

  it('keeps the wire form in json, so a path fed back still resolves', () => {
    renderPage('json', { data: folders, nextCursor: null }, spec)
    expect(JSON.parse(logged[0]).data[0].path).toBe('/cli-test-a/nested%20one')
  })

  it('keeps the wire form in yaml for the same reason', () => {
    renderPage('yaml', { data: folders, nextCursor: null }, spec)
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

  /**
   * `%2F` is the one escape that must survive display: decoding it prints a
   * root folder named `a/enc` exactly like a folder `enc` nested under `a`, and
   * the path people paste back then resolves to the other folder.
   */
  describe('a folder whose own name contains the separator', () => {
    const slashNamed = [
      {
        path: '/cli-test-a%2Fenc',
        name: 'cli-test-a/enc',
        parentPath: '/',
        updatedAt: '2026-08-17T20:35:38.478Z',
      },
    ]
    const nested = [
      {
        path: '/cli-test-a/enc',
        name: 'enc',
        parentPath: '/cli-test-a',
        updatedAt: '2026-08-17T20:35:38.478Z',
      },
    ]

    it('keeps it distinguishable from a genuinely nested folder in the table', () => {
      renderPage('table', { data: slashNamed, nextCursor: null }, spec)
      const [, slashRow] = tableLines()
      logged = []
      renderPage('table', { data: nested, nextCursor: null }, spec)
      const [, nestedRow] = tableLines()

      expect(slashRow).toContain('%2F')
      expect(slashRow.split(/\s{2,}/)[0]).not.toBe(nestedRow.split(/\s{2,}/)[0])
    })

    it('prints the wire form in text, which is what a script pipes back', () => {
      renderPage('text', { data: slashNamed, nextCursor: null }, spec)
      expect(logged[0].split('\t')[0]).toBe('/cli-test-a%2Fenc')
    })

    it('survives a round trip back through the encoder', () => {
      expect(encodeFolderPath(decodeFolderPath('/cli-test-a%2Fenc'))).toBe('/cli-test-a%2Fenc')
    })
  })

  it('shows an undecodable path as it arrived rather than dropping it', () => {
    renderPage(
      'text',
      {
        data: [{ path: '/100%zz', name: 'x', parentPath: '/', updatedAt: null }],
        nextCursor: null,
      },
      spec
    )
    expect(logged[0].split('\t')[0]).toBe('/100%zz')
  })
})

describe('paginated JSON output', () => {
  it('includes the cursor without a pagination notice', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const page = { data: [{ id: 'a' }], nextCursor: 'c1' }

    renderPage('json', page, {})

    expect(JSON.parse(logged.join('\n'))).toEqual(page)
    expect(stderr).not.toHaveBeenCalled()
  })

  it('includes a null cursor for an empty result', () => {
    renderPage('json', { data: [], nextCursor: null }, {})

    expect(JSON.parse(logged.join('\n'))).toEqual({ data: [], nextCursor: null })
  })

  it('includes the same pagination fields in YAML', () => {
    renderPage('yaml', { data: [{ id: 'a' }], nextCursor: 'c1' }, {})

    expect(logged.join('\n')).toBe('data:\n  - id: a\nnextCursor: c1')
  })
})

describe('a truncation the response states inside its payload', () => {
  /** Every note goes to stderr; stdout is asserted to be untouched by it. */
  function captureStderr(): () => string {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    return () => stderr.mock.calls.map(([chunk]) => String(chunk)).join('')
  }

  it('reports a clipped file body, which the envelope says nothing about', () => {
    const read = captureStderr()
    const payload = { fileId: 'wf_probe', name: 'a.txt', text: 'abc', truncated: true }

    renderResult('readFileText', 'json', payload, {}, {}, { data: payload })

    expect(read()).toContain('the server clipped this result')
    expect(JSON.parse(logged.join('\n'))).toEqual(payload)
  })

  it('reports a clipped row search', () => {
    const read = captureStderr()
    const payload = { matches: [{ ordinal: 1, rowId: 'row_1', column: 'name' }], truncated: true }

    renderResult('searchTableRows', 'json', payload, {}, {}, { data: payload })

    expect(read()).toContain('the server clipped this result')
  })

  it('names the tool names, not the servers, on the server list', () => {
    const read = captureStderr()

    renderPage(
      'json',
      { data: [{ id: 'srv_1' }], nextCursor: null },
      {},
      { data: [], toolNamesTruncated: true }
    )

    expect(read()).toContain('the server clipped the tool names it returned')
  })

  /**
   * The subject is the words before the suffix, and `is` is not one of them:
   * `isTruncated` read as a clip of "the is". Latent — no shipped endpoint
   * spells it that way — so this is what keeps it harmless if one ever does.
   */
  it('reads a copula prefix as no subject rather than as one', () => {
    const read = captureStderr()

    renderResult('readFileText', 'json', {}, {}, {}, { data: { isTruncated: true } })

    expect(read()).toContain('the server clipped this result')
    expect(read()).not.toContain('the is')
  })

  /** The strip stops at the copula: a real subject behind it still names itself. */
  it('keeps the subject behind a copula prefix', () => {
    const read = captureStderr()

    renderResult('readFileText', 'json', {}, {}, {}, { data: { isToolNamesTruncated: true } })

    expect(read()).toContain('the server clipped the tool names it returned')
  })

  /** And a subject that merely begins with those two letters is not a copula. */
  it('does not eat a subject that begins with is', () => {
    const read = captureStderr()

    renderResult('readFileText', 'json', {}, {}, {}, { data: { issuesTruncated: true } })

    expect(read()).toContain('the server clipped the issues it returned')
  })

  it('says nothing when a negated flag reports the answer was whole', () => {
    const read = captureStderr()

    renderResult('readFileText', 'json', {}, {}, {}, { data: { notTruncated: true } })

    expect(read()).toBe('')
  })

  it.each(['notTruncated', 'unTruncated', 'nonTruncated', 'neverTruncated', 'isNotTruncated'])(
    'says nothing for the negated spelling %s',
    (flag) => {
      const read = captureStderr()

      renderResult('readFileText', 'json', {}, {}, {}, { data: { [flag]: true } })

      expect(read()).toBe('')
    }
  )

  /**
   * The flag pattern, not the negation veto, is what rejects this: `was not
   * truncated` carries neither the `Not`/`Un` casing the veto looks for nor the
   * unbroken `<word>Truncated` shape the pattern demands. Asserted separately
   * so loosening the pattern to a bare `truncated` substring goes red here
   * rather than silently leaning on the veto to cover it.
   */
  it('says nothing for a key that only resembles the flag', () => {
    const read = captureStderr()

    renderResult('readFileText', 'json', {}, {}, {}, { data: { 'was not truncated': true } })

    expect(read()).toBe('')
  })

  /**
   * The bound the scan is built on: `data` is descended only while it is an
   * object, because a page's `data` is the rows and a row's keys are the
   * caller's own. A column literally named `truncated` is a value in somebody's
   * table, not a statement by the API, and reading it as one would warn about a
   * clip that never happened on every row that ever holds `true`.
   */
  it('ignores a row column named like the flag, because rows are not the envelope', () => {
    const read = captureStderr()
    const rows = [{ id: 'a', truncated: true }]

    renderPage('json', { data: rows, nextCursor: null }, {}, { data: rows })

    expect(read()).toBe('')
    expect(JSON.parse(logged.join('\n'))).toEqual({ data: rows, nextCursor: null })
  })

  /**
   * The other half of the same bound: the scan stops at `data`. A flag nested
   * below it is not read, so a future "scan deeper" change has to face this
   * test and the row-column case above together.
   */
  it('does not descend past data', () => {
    const read = captureStderr()

    renderResult('readFileText', 'json', {}, {}, {}, { data: { file: { truncated: true } } })

    expect(read()).toBe('')
  })

  it('keeps the server truncation note on stderr in YAML', () => {
    const read = captureStderr()

    renderPage('yaml', { data: [{ id: 'a' }], nextCursor: null }, {}, { data: [], truncated: true })

    expect(logged.join('\n')).not.toContain('clipped')
    expect(read()).toContain('the server clipped this result')
  })
})
