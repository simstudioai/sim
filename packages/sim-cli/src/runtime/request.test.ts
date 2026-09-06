import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SimApiError } from '../http/client'
import { deriveCommandPath } from './derive'
import { buildRequest, coerce, type FieldSpec } from './request'

const WORKSPACE = 'ws_local'

describe('buildRequest', () => {
  /**
   * `recursive` is the one string-backed toggle the API turns on by itself —
   * it defaults to true as soon as a search is set. Its `--no-` twin has to
   * reach the wire as an explicit false, or searching a single folder without
   * descending into it is unsayable from the terminal.
   */
  it('sends an explicit false for a negated string-backed toggle', async () => {
    const built = await buildRequest(
      'listFiles',
      [],
      { folderPath: '/Reports', search: 'q3', recursive: false },
      WORKSPACE
    )
    expect(built.query.recursive).toBe(false)
  })

  it('sends true when the same toggle is set positively', async () => {
    const built = await buildRequest('listFiles', [], { recursive: true }, WORKSPACE)
    expect(built.query.recursive).toBe(true)
  })

  it('substitutes path params from positional args and injects the workspace', async () => {
    expect(await buildRequest('upsertTableRow', ['tbl_1'], { data: '{"a":1}' }, WORKSPACE)).toEqual(
      {
        path: '/api/v2/tables/tbl_1/rows/upsert',
        query: {},
        body: { workspaceId: WORKSPACE, data: { a: 1 } },
      }
    )
  })

  it('puts the workspace in whichever slot the contract declares it', async () => {
    // Same field, different slot: body for upsert above, query here.
    const built = await buildRequest('listTables', [], {}, WORKSPACE)
    expect(built.query).toEqual({ workspaceId: WORKSPACE })
    expect(built.body).toBeUndefined()
  })

  it('omits an optional profile workspace when all workspaces are requested', async () => {
    const built = await buildRequest('listBillingLogs', [], { allWorkspaces: true }, WORKSPACE)
    expect(built.query).not.toHaveProperty('workspaceId')
  })

  it('maps a contract flag alias back to its field name', async () => {
    const built = await buildRequest(
      'upsertTableRow',
      ['t'],
      { data: '{}', on: 'email' },
      WORKSPACE
    )
    expect(built.body).toMatchObject({ conflictTarget: 'email' })
  })

  it('comma-joins a list flag the route splits, which the type calls a string', async () => {
    const built = await buildRequest('listLogs', [], { workflow: ['wf_1', 'wf_2'] }, WORKSPACE)
    expect(built.query.workflowIds).toBe('wf_1,wf_2')
  })

  // Keys here are camelCase because that is what commander stores — feeding
  // flag-shaped keys is what let the camelCase mismatch through review.
  it('coerces numeric flags out of the strings argv gives', async () => {
    const built = await buildRequest('listLogs', [], { minDurationMs: '250' }, WORKSPACE)
    expect(built.query.minDurationMs).toBe(250)
  })

  it('omits absent optional fields so the server applies its own default', async () => {
    // Except where the contract asks for one, as `details` does below.
    const built = await buildRequest('listLogs', [], {}, WORKSPACE)
    expect(built.query).toEqual({ workspaceId: WORKSPACE, details: 'full' })
    expect(built.query).not.toHaveProperty('order')
  })

  it('asks for the detail level its own declared columns read from', async () => {
    // `logs list` renders `workflow.name`, which the API sends only at `full`,
    // so the default request left the workflow column empty on every row.
    const built = await buildRequest('listLogs', [], {}, WORKSPACE)
    expect(built.query.details).toBe('full')
  })

  it('lets an explicit detail level override the contract default', async () => {
    const built = await buildRequest('listLogs', [], { details: 'basic' }, WORKSPACE)
    expect(built.query.details).toBe('basic')
  })

  it('never sends a field the contract marked omit', async () => {
    // `stream` would switch the response to SSE, which the JSON client cannot read.
    const built = await buildRequest('executeWorkflow', ['wf_1'], { stream: true }, WORKSPACE)
    expect(built.body ?? {}).not.toHaveProperty('stream')
  })

  it('sends an empty object when a declared body has no provided fields', async () => {
    expect((await buildRequest('executeWorkflow', ['wf_1'], {}, WORKSPACE)).body).toEqual({})
  })

  it('percent-encodes path params so an id cannot retarget the request', async () => {
    expect((await buildRequest('getTable', ['a/b?c'], {}, WORKSPACE)).path).toBe(
      '/api/v2/tables/a%2Fb%3Fc'
    )
  })

  it('fills a configured workspace path segment from the profile', async () => {
    expect((await buildRequest('getWorkspace', [], {}, WORKSPACE)).path).toBe(
      `/api/v2/workspaces/${WORKSPACE}`
    )
  })

  it('combines nested resource path arguments in route order', async () => {
    expect(await buildRequest('getKnowledgeDocument', ['kb_1', 'doc_1'], {}, WORKSPACE)).toEqual({
      path: '/api/v2/knowledge/kb_1/documents/doc_1',
      query: { workspaceId: WORKSPACE },
      body: undefined,
    })
  })

  it('still sends an explicit zero, which is a value the caller chose', async () => {
    expect((await buildRequest('listLogs', [], { minCost: '0' }, WORKSPACE)).query).toMatchObject({
      minCost: 0,
    })
    expect(
      (await buildRequest('readFileText', ['wf_1'], { maxBytes: '0' }, WORKSPACE)).query
    ).toMatchObject({ maxBytes: 0 })
  })

  it('still sends an empty body string, which is how a description is cleared', async () => {
    expect(
      (await buildRequest('updateWorkflow', ['wf_1'], { description: '' }, WORKSPACE)).body
    ).toEqual({
      description: '',
    })
    // A body string carries a blank on both spellings: it is the value, not a
    // filter, and it is the one kind the numeric refusal below must not reach.
    expect(
      (await buildRequest('updateWorkflow', ['wf_1'], { description: ' ' }, WORKSPACE)).body
    ).toEqual({
      description: ' ',
    })
  })

  describe('failures, all before any network call', () => {
    it('rejects a missing path arg', async () => {
      await expect(buildRequest('getTable', [], {}, WORKSPACE)).rejects.toThrow('Missing <tableId>')
    })

    it('rejects a profile-backed workspace path when no workspace is configured', async () => {
      await expect(buildRequest('getWorkspace', [], {}, null)).rejects.toThrow(
        'No workspace set. Pass --workspace, or run: sim configure --set-workspace <id>'
      )
    })

    /**
     * The URL builder skips an empty value, so a blank filter was not sent and
     * not refused either — `logs list --status ""` came back unfiltered while
     * `--workflow ""` (a list flag) had always been an error.
     */
    it('rejects an empty query filter the way it rejects an empty list entry', async () => {
      await expect(buildRequest('listLogs', [], { status: '' }, WORKSPACE)).rejects.toThrow(
        '--status cannot be empty'
      )
      await expect(buildRequest('listLogs', [], { workflowName: '' }, WORKSPACE)).rejects.toThrow(
        '--workflow-name cannot be empty'
      )
    })

    /**
     * `Number('')` is `0`, so a blank numeric filter coerced into a real one:
     * `--max-cost ""` asked for runs costing at most nothing and answered `0`
     * rows, the same silent-wrong-result the blank-string refusal exists to
     * remove.
     */
    it('rejects a blank numeric query filter, which coercion would read as 0', async () => {
      await expect(buildRequest('listLogs', [], { maxCost: '' }, WORKSPACE)).rejects.toThrow(
        '--max-cost cannot be empty'
      )
      await expect(buildRequest('listLogs', [], { minDurationMs: '' }, WORKSPACE)).rejects.toThrow(
        '--min-duration-ms cannot be empty'
      )
      await expect(
        buildRequest('readFileText', ['wf_1'], { maxBytes: '' }, WORKSPACE)
      ).rejects.toThrow('--max-bytes cannot be empty')
    })

    /**
     * The same coercion, in the other slot. `tables rows batch-delete --limit
     * ""` sent `"limit":0` — a cap on a destructive operation that the caller
     * never typed — so the refusal follows the field's declared kind rather
     * than the slot it sits in. The body string above stays sendable.
     */
    it('rejects a blank numeric body field, which coercion would read as 0 too', async () => {
      await expect(
        buildRequest('deleteTableRows', ['tbl_1'], { filter: '{"all":[]}', limit: '' }, WORKSPACE)
      ).rejects.toThrow('--limit cannot be empty')
      await expect(
        buildRequest('deleteTableRows', ['tbl_1'], { filter: '{"all":[]}', limit: ' ' }, WORKSPACE)
      ).rejects.toThrow('--limit cannot be empty')
      await expect(
        buildRequest('searchKnowledge', [], { kb: ['kb_1'], topK: '' }, WORKSPACE)
      ).rejects.toThrow('--top-k cannot be empty')
      await expect(
        buildRequest('rollbackWorkflow', ['wf_1'], { toVersion: ' ' }, WORKSPACE)
      ).rejects.toThrow('--to-version cannot be empty')
    })

    /**
     * A quoted space is invisible in a shell and reached the wire as every
     * blank the empty string did — `--max-cost " "` as a real `0` ceiling,
     * `--deployed-only " "` as an explicit `false`, `--status " "` as the
     * `%20` the route reads as blank and answers `400`.
     */
    it('rejects a whitespace-only query filter, which is blank on the wire too', async () => {
      await expect(buildRequest('listLogs', [], { status: ' ' }, WORKSPACE)).rejects.toThrow(
        '--status cannot be empty'
      )
      await expect(buildRequest('listLogs', [], { maxCost: ' ' }, WORKSPACE)).rejects.toThrow(
        '--max-cost cannot be empty'
      )
      await expect(
        buildRequest('listLogs', [], { minDurationMs: '\t' }, WORKSPACE)
      ).rejects.toThrow('--min-duration-ms cannot be empty')
      await expect(
        buildRequest('listWorkflows', [], { deployedOnly: '  ' }, WORKSPACE)
      ).rejects.toThrow('--deployed-only cannot be empty')
    })

    /** Only an all-whitespace value is blank; the surrounding spaces are the caller's. */
    it('still sends a query value that has content around its whitespace', async () => {
      expect(
        (await buildRequest('listLogs', [], { workflowName: ' q3 ' }, WORKSPACE)).query
      ).toMatchObject({ workflowName: ' q3 ' })
    })

    /**
     * A paginating `limit` is the walk size, not a filter, and the pager reads
     * it from the flags itself — refusing a blank one in wording that says what
     * `0` means there. Left to it rather than pre-empted with a generic
     * refusal, whitespace included: the pager trims before it decides. True in
     * either slot — `queryRows` carries its cursor in the body, so the numeric
     * refusal above must step aside there for the same reason.
     */
    it('leaves a blank paginating limit to the pager, which words it better', async () => {
      await expect(
        buildRequest('listWorkflows', [], { limit: '' }, WORKSPACE)
      ).resolves.toHaveProperty('query.limit', 0)
      await expect(
        buildRequest('listWorkflows', [], { limit: ' ' }, WORKSPACE)
      ).resolves.toHaveProperty('query.limit', 0)
      await expect(
        buildRequest('queryRows', ['tbl_1'], { limit: '' }, WORKSPACE)
      ).resolves.toHaveProperty('body.limit', 0)
      await expect(
        buildRequest('queryRows', ['tbl_1'], { limit: ' ' }, WORKSPACE)
      ).resolves.toHaveProperty('body.limit', 0)
    })

    it('rejects a missing required flag', async () => {
      await expect(buildRequest('upsertTableRow', ['t'], {}, WORKSPACE)).rejects.toThrow(
        '--data is required'
      )
    })

    it('names a missing nested parent path argument clearly', async () => {
      await expect(buildRequest('getKnowledgeDocument', [], {}, WORKSPACE)).rejects.toThrow(
        'Missing <knowledgeBaseId>'
      )
    })

    it('rejects malformed JSON, naming the flag the caller typed', async () => {
      await expect(
        buildRequest('upsertTableRow', ['t'], { data: '{oops' }, WORKSPACE)
      ).rejects.toThrow('--data must be valid JSON')
    })

    it('rejects a value outside an enum', async () => {
      await expect(buildRequest('listLogs', [], { level: 'warn' }, WORKSPACE)).rejects.toThrow(
        '--level must be one of: info, error'
      )
    })

    it('rejects a non-numeric number', async () => {
      await expect(buildRequest('listLogs', [], { minCost: 'lots' }, WORKSPACE)).rejects.toThrow(
        '--min-cost must be a number'
      )
    })

    it('explains an unset workspace in terms of how to set one', async () => {
      await expect(buildRequest('listTables', [], {}, null)).rejects.toThrow(SimApiError)
      await expect(buildRequest('listTables', [], {}, null)).rejects.toThrow(
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
  it('joins a string field the route splits', async () => {
    const built = await buildRequest('listLogs', [], { workflow: ['wf_1', 'wf_2'] }, WORKSPACE)
    expect(built.query.workflowIds).toBe('wf_1,wf_2')
  })

  it('keeps an array field as an array', async () => {
    // Joining these produced a string where the wire wants an array, so
    // `--row a b` failed validation — and so did a single `--row a`.
    const built = await buildRequest('deleteTableRows', ['tbl_1'], { row: ['r1', 'r2'] }, WORKSPACE)
    expect(built.body?.rowIds).toEqual(['r1', 'r2'])
  })

  it('keeps a single repeated value as a one-element array, not a bare string', async () => {
    const built = await buildRequest('deleteTableRows', ['tbl_1'], { row: ['r1'] }, WORKSPACE)
    expect(built.body?.rowIds).toEqual(['r1'])
  })

  it('sends the array branch of a string-or-array union', async () => {
    // `knowledgeBaseIds` accepts either; joining made "kb_1,kb_2" a single id.
    const built = await buildRequest(
      'searchKnowledge',
      [],
      { kb: ['kb_1', 'kb_2'], query: 'refunds' },
      WORKSPACE
    )
    expect(built.body?.knowledgeBaseIds).toEqual(['kb_1', 'kb_2'])
  })

  it('reads one list value per line from @path', async () => {
    const path = join(tmpdir(), 'sim-cli-list-values.txt')
    writeFileSync(path, 'file_1\nfile_2\n')
    expect(await coerce(`@${path}`, { kind: 'array' }, { list: true }, 'file-ids')).toEqual([
      'file_1',
      'file_2',
    ])
    rmSync(path)
  })

  /**
   * Without an escape a list value that starts with `@` has no spelling at all:
   * `--tag @urgent` can only be read as a request to open a file named
   * `urgent`. The escape belongs to the shared reader, so every `@`-aware flag
   * has it — `secrets set --value` documented `@@` but implemented it alone.
   */
  it('takes @@ as a literal leading @ in a list value', async () => {
    expect(await coerce(['@@urgent', 'plain'], { kind: 'array' }, { list: true }, 'tag')).toEqual([
      '@urgent',
      'plain',
    ])
  })

  it('still reads a single @ in a list value as a file', async () => {
    await expect(coerce('@urgent', { kind: 'array' }, { list: true }, 'tag')).rejects.toThrow(
      /cannot read urgent/
    )
  })

  /**
   * `--allowed-emails @example.org` is the natural spelling of a domain
   * pattern, and the `@` convention reads it as a file. The escape existed; the
   * failure never mentioned it.
   */
  it('points at @@ when an @ list value names no file', async () => {
    await expect(
      coerce(['@example.org'], { kind: 'array' }, { list: true }, 'allowed-emails')
    ).rejects.toThrow(/cannot read example\.org.*write @@example\.org/s)
  })

  it('rejects empty lines in a list file', async () => {
    const path = join(tmpdir(), 'sim-cli-list-empty-line.txt')
    writeFileSync(path, 'file_1\n\nfile_2')
    await expect(coerce(`@${path}`, { kind: 'array' }, { list: true }, 'file-ids')).rejects.toThrow(
      /empty value on line 2/
    )
    rmSync(path)
  })
})

describe('contract-provided choices', () => {
  it('validates an enum the generator could not recover', async () => {
    const field: FieldSpec = { kind: 'enum' }
    const flag = { choices: ['vector', 'hybrid'] } as const
    expect(await coerce('hybrid', field, flag, 'search-mode')).toBe('hybrid')
    await expect(coerce('semantic', field, flag, 'search-mode')).rejects.toThrow(
      '--search-mode must be one of: vector, hybrid'
    )
  })
})

describe('JSON flags that name a file', () => {
  const field: FieldSpec = { kind: 'object' }

  it('reads @path', async () => {
    const path = join(tmpdir(), 'sim-cli-arg.json')
    writeFileSync(path, '{"version":"1.0","state":{"blocks":{}}}')
    expect(await coerce(`@${path}`, field, {}, 'workflow')).toEqual({
      version: '1.0',
      state: { blocks: {} },
    })
    rmSync(path)
  })

  it('still accepts inline JSON', async () => {
    expect(await coerce('{"a":1}', field, {}, 'workflow')).toEqual({ a: 1 })
  })

  it('names the file it could not read', async () => {
    await expect(coerce('@/nope/missing.json', field, {}, 'workflow')).rejects.toThrow(
      /cannot read \/nope\/missing\.json/
    )
  })

  it('says which file the bad JSON came from', async () => {
    const path = join(tmpdir(), 'sim-cli-bad.json')
    writeFileSync(path, 'not json')
    await expect(coerce(`@${path}`, field, {}, 'workflow')).rejects.toThrow(
      /read from .*sim-cli-bad\.json/
    )
    rmSync(path)
  })

  it('points at @ when a bare filename was passed instead', async () => {
    // `--workflow export.json` is the natural first guess; "must be valid JSON"
    // alone never reveals that passing a file is supported at all.
    const path = join(tmpdir(), 'sim-cli-bare.json')
    writeFileSync(path, '{}')
    await expect(coerce(path, field, {}, 'workflow')).rejects.toThrow(
      new RegExp(`pass it as @${path}`)
    )
    rmSync(path)
    await expect(coerce('export.json', field, {}, 'workflow')).rejects.toThrow(/pass @path/)
  })

  it('does not suggest a path for malformed inline JSON', async () => {
    await expect(coerce('{"a":', field, {}, 'workflow')).rejects.not.toThrow(/@path/)
  })
})

describe('folder paths are typed by the name the app shows', () => {
  it('encodes a space so the visible folder name is what the caller types', async () => {
    const built = await buildRequest('listWorkflows', [], { folder: '/Folder 1' }, WORKSPACE)
    expect(built.query.folderPath).toBe('/Folder%201')
  })

  it('leaves an already-encoded path alone, because that is the form it prints', async () => {
    // `workflows ls` prints the wire form in its `ref` column and the README
    // uses it, so the value people paste back must not become `%2520`.
    const built = await buildRequest('listWorkflows', [], { folder: '/Folder%201' }, WORKSPACE)
    expect(built.query.folderPath).toBe('/Folder%201')
  })

  it('encodes each segment and keeps the separators between them', async () => {
    const built = await buildRequest(
      'listTables',
      [],
      { folder: '/cli-test-a/nested one' },
      WORKSPACE
    )
    expect(built.query.folderPath).toBe('/cli-test-a/nested%20one')
  })

  it('still treats the leading slash as optional', async () => {
    const built = await buildRequest(
      'createTableFolder',
      [],
      { path: 'cli-test-noslash' },
      WORKSPACE
    )
    expect(built.body).toMatchObject({ path: 'cli-test-noslash' })
  })

  it('escapes the characters encodeURIComponent leaves raw', async () => {
    // The route re-encodes each segment and demands a byte-for-byte match, and
    // `encodeURIComponent` alone leaves `!'()*` alone — so `/Q1 (draft)` went
    // out as `/Q1%20(draft)` and came back "Path must be a canonical folder
    // path". Folder names like these are ordinary.
    const built = await buildRequest(
      'createTableFolder',
      [],
      { path: "/Q1 (draft)/Sam's !*" },
      WORKSPACE
    )
    expect(built.body).toMatchObject({ path: '/Q1%20%28draft%29/Sam%27s%20%21%2A' })
  })

  it('spells out a dot segment, which the API refuses to read as a relative path', async () => {
    const built = await buildRequest('createTableFolder', [], { path: '/./..' }, WORKSPACE)
    expect(built.body).toMatchObject({ path: '/%2E/%2E%2E' })
  })

  it('leaves the canonical form it prints unchanged when pasted back', async () => {
    // Every one of these is what the CLI's own `ref` column shows, so it is what
    // people paste into the next command; re-encoding it must be a no-op.
    for (const name of ['Q1 (draft)', "Sam's stuff", 'wow!', 'a*b', '.', '..', '50% off']) {
      const canonical = (
        await buildRequest('createTableFolder', [], { path: `/${name}` }, WORKSPACE)
      ).body?.path as string
      const again = await buildRequest('createTableFolder', [], { path: canonical }, WORKSPACE)
      expect(again.body).toMatchObject({ path: canonical })
    }
  })

  it('encodes a literal percent that is not an escape', async () => {
    const built = await buildRequest('createTableFolder', [], { path: '/50% off' }, WORKSPACE)
    expect(built.body).toMatchObject({ path: '/50%25%20off' })
  })

  it('encodes both ends of a folder move', async () => {
    const built = await buildRequest(
      'relocateTableFolder',
      [],
      { path: '/old name', destination: '/new name' },
      WORKSPACE
    )
    expect(built.body).toMatchObject({ path: '/old%20name', destinationPath: '/new%20name' })
  })

  it('encodes every value of the repeatable folder filter before joining them', async () => {
    const built = await buildRequest('listLogs', [], { folder: ['/a b', '/c'] }, WORKSPACE)
    expect(built.query.folderPaths).toBe('/a%20b,/c')
  })

  it('leaves a field the contract has not marked untouched', async () => {
    // `files upload` and `knowledge documents upload` take a LOCAL path; the
    // marker is what keeps the encoder away from one.
    const local = './My Docs/report.pdf'
    expect(await coerce(local, { kind: 'string' }, {}, 'file')).toBe(local)
  })
})

describe('the word null typed into a string flag', () => {
  /**
   * There is no flag that sends JSON `null`: `--no-<flag>` is spoken for by the
   * boolean negations, so a field the contract clears with null is cleared from
   * the terminal only as far as an empty string goes. What a caller types is
   * text, and `coerce` keeps it that way rather than guessing at the value.
   */
  it('stays the four characters, while an empty string stays empty', async () => {
    expect(await coerce('null', { kind: 'string' }, {}, 'description')).toBe('null')
    expect(await coerce('', { kind: 'string' }, {}, 'description')).toBe('')
  })
})

describe('contract-declared headers', () => {
  it('builds a header slot from the flag the contract declares', async () => {
    const built = await buildRequest('getFileUpload', ['up_1'], { uploadToken: 'tok_1' }, WORKSPACE)
    expect(built.headers).toEqual({ 'upload-token': 'tok_1' })
  })

  it('raises before the request when a required header is absent', async () => {
    await expect(buildRequest('getFileUpload', ['up_1'], {}, WORKSPACE)).rejects.toThrow(
      /--upload-token is required/
    )
  })

  /**
   * Absent rather than empty: the client builds its own header block, and an
   * empty object spread over it must not be what a headerless request looks
   * like.
   */
  it('omits the slot for an operation that declares no headers', async () => {
    expect(await buildRequest('listTables', [], {}, WORKSPACE)).not.toHaveProperty('headers')
  })

  /**
   * `upload-token` is omitted from the flags of `tables imports get`: the token
   * is a per-transfer credential the CLI never prints, and the session it
   * addresses is opened and finished inside one `sim files upload`. An omitted
   * field is dropped even when a value is keyed by its name, so nothing the
   * caller can type puts the slot back.
   */
  it('builds no header for a field the CLI contract omits', async () => {
    expect(
      await buildRequest('getTableImport', ['imp_1'], { uploadToken: 'tok_1' }, WORKSPACE)
    ).not.toHaveProperty('headers')
    // Paired with an operation that declares one, so the absence above means
    // "omitted" rather than "this never builds a header slot at all".
    expect(
      (await buildRequest('getFileUpload', ['up_1'], { uploadToken: 'tok_1' }, WORKSPACE)).headers
    ).toEqual({ 'upload-token': 'tok_1' })
  })
})
