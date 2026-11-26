import { load } from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec } from '../contract/types'
import { encodeFolderPath } from './request'
import { decodeFolderPath, foldPageEnvelope, renderPage, renderResult } from './result'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

/** The table arrives as one string; its first line is the header. */
function tableLines(): string[] {
  return logged.join('\n').split('\n')
}

describe('single-record output is only clamped for the human table', () => {
  const url = `https://sim-storage.example.com/exports/probe.csv?X-Amz-Signature=${'a'.repeat(300)}`

  it('clamps the value in table mode', () => {
    renderResult('tableExportDownload', 'table', { url }, {})
    expect(logged[0]).toMatch(/…$/)
    expect(logged[0].length).toBeLessThan(url.length)
  })
})

describe('inferred cells pick a format from the key shape', () => {
  const _row = {
    createdAt: '2026-08-17T20:35:38.478Z',
    durationMs: 9.145596999907866,
    size: 3000000,
    isActive: true,
    deletedAt: null,
    rowCount: 0,
    displayName: 'probe',
  }

  it('infers nothing when the value type disagrees with the key', () => {
    renderResult('getTable', 'text', { size: 'small', createdAt: 'whenever', isActive: 'yes' }, {})
    expect(logged).toEqual(['size\tsmall', 'created at\twhenever', 'is active\tyes'])
  })
})

describe('a record keyed by data rather than by field names', () => {
  // `workflows outline` answers `{ blocks: { <block id>: {...} } }`: once the
  // single-key wrapper is unwrapped, each label is a block id the reader copies.
  const blockId = '112f78c0-9170-4843-abb7-d07329fe3cc7'
  const outline = { blocks: { [blockId]: { type: 'agent', name: 'Agent 1', enabled: true } } }

  it('labels each entry with its key exactly as the API sent it', () => {
    renderResult('getWorkflowOutline', 'text', outline, CLI_CONTRACT.getWorkflowOutline ?? {})
    expect(logged[0].split('\t')[0]).toBe(blockId)
  })
})

describe('cells the user named, not the API', () => {
  // `tables rows list` and `tables rows query` expand `data`, whose keys are
  // whatever the caller called their columns. A key shape is a promise about
  // the value, and only the API's own field names carry one.
  const rows = [{ id: 'row_1', data: { score: 3, size: 5, duration: 30, isBillable: true } }]
  const spec: CommandSpec = { expand: 'data' }

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

describe('folder paths are shown by name, but piped in wire form', () => {
  const _folders = [
    {
      path: '/cli-test-a/nested%20one',
      name: 'nested one',
      parentPath: '/cli-test-a',
      updatedAt: '2026-08-17T20:35:38.478Z',
    },
  ]
  const spec = CLI_CONTRACT.listTableFolders as CommandSpec

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
  it.each([
    { format: 'json', truncated: true },
    { format: 'json', truncated: false },
    { format: 'yaml', truncated: true },
    { format: 'yaml', truncated: false },
  ] as const)(
    'preserves truncated=$truncated in $format without carrying stale page data',
    ({ format, truncated }) => {
      vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const page = { data: [{ id: 'a' }, { id: 'b' }], nextCursor: null }
      renderPage(format, page, {}, { data: [{ id: 'a' }], nextCursor: 'stale', truncated })

      const result = format === 'json' ? JSON.parse(logged.join('\n')) : load(logged.join('\n'))
      expect(result).toEqual({ ...page, truncated })
    }
  )

  it.each([
    { first: false, last: true },
    { first: true, last: false },
    { first: undefined, last: false },
  ])('preserves truncation across pages with first=$first and last=$last', ({ first, last }) => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const envelope = foldPageEnvelope(
      {
        data: [{ id: 'a' }],
        nextCursor: 'next',
        ...(first === undefined ? {} : { toolNamesTruncated: first }),
      },
      { data: [{ id: 'b' }], nextCursor: null, toolNamesTruncated: last }
    )
    const page = { data: [{ id: 'a' }, { id: 'b' }], nextCursor: null }
    renderPage('json', page, {}, envelope)

    expect(JSON.parse(logged.join('\n'))).toEqual({
      ...page,
      toolNamesTruncated: first === true || last,
    })
  })
})

describe('a truncation the response states inside its payload', () => {
  /** Every note goes to stderr; stdout is asserted to be untouched by it. */
  function captureStderr(): () => string {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    return () => stderr.mock.calls.map(([chunk]) => String(chunk)).join('')
  }

  it.each(['readFileText', 'readFileVersionText'] as const)(
    'preserves complete %s content in table output',
    (operation) => {
      const read = captureStderr()
      const payload = {
        fileId: 'file_probe',
        name: 'probe.txt',
        text: `${'Long line '.repeat(30)}\nsecond\tline\n\u001b[2Jlast line`,
        truncated: false,
      }

      renderResult(operation, 'table', payload, CLI_CONTRACT[operation]!, {}, { data: payload })

      expect(JSON.parse(logged.join('\n'))).toEqual(payload)
      expect(logged.join('\n')).not.toContain('\u001b')
      expect(read()).toBe('')
    }
  )

  it('reports a clipped file body, which the envelope says nothing about', () => {
    const read = captureStderr()
    const payload = { fileId: 'wf_probe', name: 'a.txt', text: 'abc', truncated: true }

    renderResult('readFileText', 'json', payload, {}, {}, { data: payload })

    expect(read()).toContain('the server clipped this result')
    expect(JSON.parse(logged.join('\n'))).toEqual(payload)
  })
})

describe('a deploy result read by a person', () => {
  const ref = (blockId: string, blockName: string, blockType: string) => ({
    blockId,
    blockName,
    blockType,
  })
  /** A clean report as a real two-block workflow gets it: a source, a sink, no finding. */
  const clean = {
    sources: [ref('b-1', 'Start', 'start_trigger')],
    sinks: [ref('b-2', 'Agent', 'agent')],
    orphanBlocks: [],
    emptyOutgoingPorts: [],
    invalidBranchPorts: [],
    invalidConnectionTargets: [],
    fieldIssues: [],
    unresolvedReferences: [],
    tableFieldIssues: [],
    manualRunIssue: null,
    notes: [],
  }
  const deployed = (lint: Record<string, unknown> | null) => ({
    id: 'wf-1',
    isDeployed: true,
    version: 7,
    activeDeployment: {
      deploymentVersionId: 'dv-7',
      version: 7,
      deployedAt: '2026-11-20T00:00:00Z',
    },
    latestDeploymentAttempt: null,
    warnings: [],
    lint,
  })

  it('ends with what is live, and keeps only the lint findings', () => {
    const orphan = ref('b-3', 'Stray', 'function')
    renderResult(
      'deployWorkflow',
      'text',
      deployed({ ...clean, orphanBlocks: [orphan] }),
      CLI_CONTRACT.deployWorkflow ?? {}
    )
    expect(logged.at(-1)).toBe('live\tversion 7, serving (this deploy)')
    expect(logged).toContain(`lint\t${JSON.stringify({ orphanBlocks: [orphan] })}`)
  })

  it('drops a report whose only entries are the graph sources and sinks, for a machine too', () => {
    renderResult('deployWorkflow', 'text', deployed(clean), CLI_CONTRACT.deployWorkflow ?? {})
    expect(logged.some((line) => line.startsWith('lint\t'))).toBe(false)

    logged = []
    renderResult('deployWorkflow', 'json', deployed(clean), CLI_CONTRACT.deployWorkflow ?? {})
    const shown = JSON.parse(logged.join('\n'))
    expect(shown).not.toHaveProperty('lint')
    expect(Object.keys(shown).at(-1)).toBe('live')

    // A deploy that lints nothing answers `lint: null`: no report, so no field either.
    logged = []
    renderResult('deployWorkflow', 'json', deployed(null), CLI_CONTRACT.deployWorkflow ?? {})
    expect(JSON.parse(logged.join('\n'))).not.toHaveProperty('lint')
  })
})

describe('a run record read by a person', () => {
  const spec = CLI_CONTRACT.getWorkflowRun ?? {}
  const lineOf = (label: string) => logged.find((line) => line.startsWith(`${label}:`)) ?? ''

  it('chains the resumes of several waiting points so a pasted line runs each', () => {
    const point = (contextId: string) => ({ contextId, kind: 'human', status: 'paused' })
    renderResult(
      'getWorkflowRun',
      'table',
      {
        runId: 'run_1',
        workflowId: 'wf_1',
        status: 'paused',
        paused: { runId: 'run_1', points: [point('a'), point('b')] },
      },
      spec
    )
    expect(lineOf('next')).toContain(
      '--context a && sim workflows runs resume run_1 --workflow wf_1 --context b  # '
    )
  })

  it('prints the note naming the mocks a rerun leaves out whole', () => {
    const child = (n: number) => `00000000-0000-4000-8000-00000000000${n}.block_${n}`
    const mocks = [child(1), child(2), child(3)]
    renderResult(
      'getWorkflowRun',
      'table',
      {
        runId: 'run_9',
        workflowId: 'wf_1',
        status: 'failed',
        trigger: 'test',
        overrides: { allow: [], mocks },
        error: { message: 'boom', blockId: 'blk_3', rerunFromBlockId: 'blk_3' },
      },
      spec
    )
    expect(lineOf('next note')).toContain(mocks.join(', '))
  })
})
