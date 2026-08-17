import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SimApiError } from '../http/client'
import { deriveCommandPath } from './derive'
import { buildRequest, coerce, type FieldSpec } from './request'

const WORKSPACE = 'ws_local'

describe('buildRequest', () => {
  it('substitutes path params from positional args and injects the workspace', () => {
    expect(buildRequest('upsertTableRow', ['tbl_1'], { data: '{"a":1}' }, WORKSPACE)).toEqual({
      path: '/api/v2/tables/tbl_1/rows/upsert',
      query: {},
      body: { workspaceId: WORKSPACE, data: { a: 1 } },
    })
  })

  it('puts the workspace in whichever slot the contract declares it', () => {
    // Same field, different slot: body for upsert above, query here.
    const built = buildRequest('listTables', [], {}, WORKSPACE)
    expect(built.query).toEqual({ workspaceId: WORKSPACE })
    expect(built.body).toBeUndefined()
  })

  it('omits an optional profile workspace when all workspaces are requested', () => {
    const built = buildRequest('listBillingLogs', [], { allWorkspaces: true }, WORKSPACE)
    expect(built.query).not.toHaveProperty('workspaceId')
  })

  it('maps a contract flag alias back to its field name', () => {
    const built = buildRequest('upsertTableRow', ['t'], { data: '{}', on: 'email' }, WORKSPACE)
    expect(built.body).toMatchObject({ conflictTarget: 'email' })
  })

  it('comma-joins a list flag the route splits, which the type calls a string', () => {
    const built = buildRequest('listLogs', [], { workflow: ['wf_1', 'wf_2'] }, WORKSPACE)
    expect(built.query.workflowIds).toBe('wf_1,wf_2')
  })

  // Keys here are camelCase because that is what commander stores — feeding
  // flag-shaped keys is what let the camelCase mismatch through review.
  it('coerces numeric flags out of the strings argv gives', () => {
    const built = buildRequest('listLogs', [], { minDurationMs: '250' }, WORKSPACE)
    expect(built.query.minDurationMs).toBe(250)
  })

  it('omits absent optional fields so the server applies its own default', () => {
    // Except where the contract asks for one, as `details` does below.
    const built = buildRequest('listLogs', [], {}, WORKSPACE)
    expect(built.query).toEqual({ workspaceId: WORKSPACE, details: 'full' })
    expect(built.query).not.toHaveProperty('order')
  })

  it('asks for the detail level its own declared columns read from', () => {
    // `logs list` renders `workflow.name`, which the API sends only at `full`,
    // so the default request left the workflow column empty on every row.
    const built = buildRequest('listLogs', [], {}, WORKSPACE)
    expect(built.query.details).toBe('full')
  })

  it('lets an explicit detail level override the contract default', () => {
    const built = buildRequest('listLogs', [], { details: 'basic' }, WORKSPACE)
    expect(built.query.details).toBe('basic')
  })

  it('never sends a field the contract marked omit', () => {
    // `stream` would switch the response to SSE, which the JSON client cannot read.
    const built = buildRequest('executeWorkflow', ['wf_1'], { stream: true }, WORKSPACE)
    expect(built.body ?? {}).not.toHaveProperty('stream')
  })

  it('sends an empty object when a declared body has no provided fields', () => {
    expect(buildRequest('executeWorkflow', ['wf_1'], {}, WORKSPACE).body).toEqual({})
  })

  it('percent-encodes path params so an id cannot retarget the request', () => {
    expect(buildRequest('getTable', ['a/b?c'], {}, WORKSPACE).path).toBe('/api/v2/tables/a%2Fb%3Fc')
  })

  it('fills a configured workspace path segment from the profile', () => {
    expect(buildRequest('getWorkspace', [], {}, WORKSPACE).path).toBe(
      `/api/v2/workspaces/${WORKSPACE}`
    )
  })

  it('combines nested resource path arguments in route order', () => {
    expect(buildRequest('getKnowledgeDocument', ['kb_1', 'doc_1'], {}, WORKSPACE)).toEqual({
      path: '/api/v2/knowledge/kb_1/documents/doc_1',
      query: { workspaceId: WORKSPACE },
      body: undefined,
    })
  })

  describe('failures, all before any network call', () => {
    it('rejects a missing path arg', () => {
      expect(() => buildRequest('getTable', [], {}, WORKSPACE)).toThrow('Missing <tableId>')
    })

    it('rejects a profile-backed workspace path when no workspace is configured', () => {
      expect(() => buildRequest('getWorkspace', [], {}, null)).toThrow(
        'No workspace set. Pass --workspace, or run: sim configure --set-workspace <id>'
      )
    })

    it('rejects a missing required flag', () => {
      expect(() => buildRequest('upsertTableRow', ['t'], {}, WORKSPACE)).toThrow(
        '--data is required'
      )
    })

    it('names a missing nested parent path argument clearly', () => {
      expect(() => buildRequest('getKnowledgeDocument', [], {}, WORKSPACE)).toThrow(
        'Missing <knowledgeBaseId>'
      )
    })

    it('rejects malformed JSON, naming the flag the caller typed', () => {
      expect(() => buildRequest('upsertTableRow', ['t'], { data: '{oops' }, WORKSPACE)).toThrow(
        '--data must be valid JSON'
      )
    })

    it('rejects a value outside an enum', () => {
      expect(() => buildRequest('listLogs', [], { level: 'warn' }, WORKSPACE)).toThrow(
        '--level must be one of: info, error'
      )
    })

    it('rejects a non-numeric number', () => {
      expect(() => buildRequest('listLogs', [], { minCost: 'lots' }, WORKSPACE)).toThrow(
        '--min-cost must be a number'
      )
    })

    it('explains an unset workspace in terms of how to set one', () => {
      expect(() => buildRequest('listTables', [], {}, null)).toThrow(SimApiError)
      expect(() => buildRequest('listTables', [], {}, null)).toThrow(
        'sim configure --set-workspace'
      )
    })
  })
})

describe('deriveCommandPath', () => {
  it('derives collection and item verbs from the method and path shape', () => {
    expect(deriveCommandPath('listTables')).toEqual(['tables', 'list'])
    expect(deriveCommandPath('getTable')).toEqual(['tables', 'get'])
    expect(deriveCommandPath('createTable')).toEqual(['tables', 'create'])
    expect(deriveCommandPath('deleteTable')).toEqual(['tables', 'delete'])
  })

  it('nests a sub-resource', () => {
    expect(deriveCommandPath('getKnowledgeDocument')).toEqual(['knowledge', 'documents', 'get'])
    expect(deriveCommandPath('listTableRows')).toEqual(['tables', 'rows', 'list'])
  })

  it('treats a verb-like trailing segment as the command name', () => {
    expect(deriveCommandPath('upsertTableRow')).toEqual(['tables', 'upsert'])
    expect(deriveCommandPath('searchKnowledge')).toEqual(['knowledge', 'search'])
  })
})

describe('repeated flags encode per the field kind, not uniformly', () => {
  it('joins a string field the route splits', () => {
    const built = buildRequest('listLogs', [], { workflow: ['wf_1', 'wf_2'] }, WORKSPACE)
    expect(built.query.workflowIds).toBe('wf_1,wf_2')
  })

  it('keeps an array field as an array', () => {
    // Joining these produced a string where the wire wants an array, so
    // `--row a b` failed validation — and so did a single `--row a`.
    const built = buildRequest('deleteTableRows', ['tbl_1'], { row: ['r1', 'r2'] }, WORKSPACE)
    expect(built.body?.rowIds).toEqual(['r1', 'r2'])
  })

  it('keeps a single repeated value as a one-element array, not a bare string', () => {
    const built = buildRequest('deleteTableRows', ['tbl_1'], { row: ['r1'] }, WORKSPACE)
    expect(built.body?.rowIds).toEqual(['r1'])
  })

  it('sends the array branch of a string-or-array union', () => {
    // `knowledgeBaseIds` accepts either; joining made "kb_1,kb_2" a single id.
    const built = buildRequest(
      'searchKnowledge',
      [],
      { kb: ['kb_1', 'kb_2'], query: 'refunds' },
      WORKSPACE
    )
    expect(built.body?.knowledgeBaseIds).toEqual(['kb_1', 'kb_2'])
  })

  it('reads one list value per line from @path', () => {
    const path = join(tmpdir(), 'sim-cli-list-values.txt')
    writeFileSync(path, 'file_1\nfile_2\n')
    expect(coerce(`@${path}`, { kind: 'array' }, { list: true }, 'file-ids')).toEqual([
      'file_1',
      'file_2',
    ])
    rmSync(path)
  })

  it('rejects empty lines in a list file', () => {
    const path = join(tmpdir(), 'sim-cli-list-empty-line.txt')
    writeFileSync(path, 'file_1\n\nfile_2')
    expect(() => coerce(`@${path}`, { kind: 'array' }, { list: true }, 'file-ids')).toThrow(
      /empty value on line 2/
    )
    rmSync(path)
  })
})

describe('contract-provided choices', () => {
  it('validates an enum the generator could not recover', () => {
    const field: FieldSpec = { kind: 'enum' }
    const flag = { choices: ['vector', 'hybrid'] } as const
    expect(coerce('hybrid', field, flag, 'search-mode')).toBe('hybrid')
    expect(() => coerce('semantic', field, flag, 'search-mode')).toThrow(
      '--search-mode must be one of: vector, hybrid'
    )
  })
})

describe('JSON flags that name a file', () => {
  const field: FieldSpec = { kind: 'object' }

  it('reads @path', () => {
    const path = join(tmpdir(), 'sim-cli-arg.json')
    writeFileSync(path, '{"version":"1.0","state":{"blocks":{}}}')
    expect(coerce(`@${path}`, field, {}, 'workflow')).toEqual({
      version: '1.0',
      state: { blocks: {} },
    })
    rmSync(path)
  })

  it('still accepts inline JSON', () => {
    expect(coerce('{"a":1}', field, {}, 'workflow')).toEqual({ a: 1 })
  })

  it('names the file it could not read', () => {
    expect(() => coerce('@/nope/missing.json', field, {}, 'workflow')).toThrow(
      /cannot read \/nope\/missing\.json/
    )
  })

  it('says which file the bad JSON came from', () => {
    const path = join(tmpdir(), 'sim-cli-bad.json')
    writeFileSync(path, 'not json')
    expect(() => coerce(`@${path}`, field, {}, 'workflow')).toThrow(/read from .*sim-cli-bad\.json/)
    rmSync(path)
  })

  it('points at @ when a bare filename was passed instead', () => {
    // `--workflow export.json` is the natural first guess; "must be valid JSON"
    // alone never reveals that passing a file is supported at all.
    const path = join(tmpdir(), 'sim-cli-bare.json')
    writeFileSync(path, '{}')
    expect(() => coerce(path, field, {}, 'workflow')).toThrow(new RegExp(`pass it as @${path}`))
    rmSync(path)
    expect(() => coerce('export.json', field, {}, 'workflow')).toThrow(/pass @path/)
  })

  it('does not suggest a path for malformed inline JSON', () => {
    expect(() => coerce('{"a":', field, {}, 'workflow')).not.toThrow(/@path/)
  })
})

describe('folder paths are typed by the name the app shows', () => {
  it('encodes a space so the visible folder name is what the caller types', () => {
    const built = buildRequest('listWorkflows', [], { folder: '/Folder 1' }, WORKSPACE)
    expect(built.query.folderPath).toBe('/Folder%201')
  })

  it('leaves an already-encoded path alone, because that is the form it prints', () => {
    // `workflows ls` prints the wire form in its `ref` column and the README
    // uses it, so the value people paste back must not become `%2520`.
    const built = buildRequest('listWorkflows', [], { folder: '/Folder%201' }, WORKSPACE)
    expect(built.query.folderPath).toBe('/Folder%201')
  })

  it('encodes each segment and keeps the separators between them', () => {
    const built = buildRequest('listTables', [], { folder: '/cli-test-a/nested one' }, WORKSPACE)
    expect(built.query.folderPath).toBe('/cli-test-a/nested%20one')
  })

  it('still treats the leading slash as optional', () => {
    const built = buildRequest('createTableFolder', [], { path: 'cli-test-noslash' }, WORKSPACE)
    expect(built.body).toMatchObject({ path: 'cli-test-noslash' })
  })

  it('escapes the characters encodeURIComponent leaves raw', () => {
    // The route re-encodes each segment and demands a byte-for-byte match, and
    // `encodeURIComponent` alone leaves `!'()*` alone — so `/Q1 (draft)` went
    // out as `/Q1%20(draft)` and came back "Path must be a canonical folder
    // path". Folder names like these are ordinary.
    const built = buildRequest('createTableFolder', [], { path: "/Q1 (draft)/Sam's !*" }, WORKSPACE)
    expect(built.body).toMatchObject({ path: '/Q1%20%28draft%29/Sam%27s%20%21%2A' })
  })

  it('spells out a dot segment, which the API refuses to read as a relative path', () => {
    const built = buildRequest('createTableFolder', [], { path: '/./..' }, WORKSPACE)
    expect(built.body).toMatchObject({ path: '/%2E/%2E%2E' })
  })

  it('leaves the canonical form it prints unchanged when pasted back', () => {
    // Every one of these is what the CLI's own `ref` column shows, so it is what
    // people paste into the next command; re-encoding it must be a no-op.
    for (const name of ['Q1 (draft)', "Sam's stuff", 'wow!', 'a*b', '.', '..', '50% off']) {
      const canonical = buildRequest('createTableFolder', [], { path: `/${name}` }, WORKSPACE).body
        ?.path as string
      const again = buildRequest('createTableFolder', [], { path: canonical }, WORKSPACE)
      expect(again.body).toMatchObject({ path: canonical })
    }
  })

  it('encodes a literal percent that is not an escape', () => {
    const built = buildRequest('createTableFolder', [], { path: '/50% off' }, WORKSPACE)
    expect(built.body).toMatchObject({ path: '/50%25%20off' })
  })

  it('encodes both ends of a folder move', () => {
    const built = buildRequest(
      'relocateTableFolder',
      [],
      { path: '/old name', destination: '/new name' },
      WORKSPACE
    )
    expect(built.body).toMatchObject({ path: '/old%20name', destinationPath: '/new%20name' })
  })

  it('encodes every value of the repeatable folder filter before joining them', () => {
    const built = buildRequest('listLogs', [], { folder: ['/a b', '/c'] }, WORKSPACE)
    expect(built.query.folderPaths).toBe('/a%20b,/c')
  })

  it('leaves a field the contract has not marked untouched', () => {
    // `files upload` and `knowledge documents upload` take a LOCAL path; the
    // marker is what keeps the encoder away from one.
    const local = './My Docs/report.pdf'
    expect(coerce(local, { kind: 'string' }, {}, 'file')).toBe(local)
  })
})
