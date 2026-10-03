import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

  it('puts the workspace in whichever slot the contract declares it', async () => {
    // Same field, different slot: body for upsert above, query here.
    const built = await buildRequest('listTables', [], {}, WORKSPACE)
    expect(built.query).toEqual({ workspaceId: WORKSPACE })
    expect(built.body).toBeUndefined()
  })

  it('percent-encodes path params so an id cannot retarget the request', async () => {
    expect((await buildRequest('getTable', ['a/b?c'], {}, WORKSPACE)).path).toBe(
      '/api/v2/tables/a%2Fb%3Fc'
    )
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

  it('preserves the literal word null on string flags', async () => {
    expect(
      (await buildRequest('updateWorkflow', ['wf_1'], { description: 'null' }, WORKSPACE)).body
    ).toEqual({ description: 'null' })
  })

  describe('failures, all before any network call', () => {
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

    it('rejects malformed JSON, naming the flag the caller typed', async () => {
      await expect(
        buildRequest('upsertTableRow', ['t'], { data: '{oops' }, WORKSPACE)
      ).rejects.toThrow('--data must be valid JSON')
    })

    it.each(['Infinity', '-Infinity', '1e999'])(
      'rejects non-finite numeric input %s before JSON can turn it into null',
      async (minCost) => {
        await expect(buildRequest('listLogs', [], { minCost }, WORKSPACE)).rejects.toThrow(
          '--min-cost must be a finite number'
        )
      }
    )
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
})

describe('folder paths are typed by the name the app shows', () => {
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

  it('encodes a literal percent that is not an escape', async () => {
    const built = await buildRequest('createTableFolder', [], { path: '/50% off' }, WORKSPACE)
    expect(built.body).toMatchObject({ path: '/50%25%20off' })
  })
})

describe('contract-declared headers', () => {
  it('raises before the request when a required header is absent', async () => {
    await expect(buildRequest('getFileUpload', ['up_1'], {}, WORKSPACE)).rejects.toThrow(
      /--upload-token is required/
    )
  })
})
