import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { cacheCatalogText } from '../../test/catalog-cache'
import { contextMockFns, contextMockState } from '../../test/context-mock'
import { runWorkspaceSource } from '../../test/workspace-source-command'
import { digest } from './source-dir'
import { readWorkspaceDir } from './workspace-source-dir'

vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)

const { mockRequest } = contextMockFns

/** The apply calls: every request but the staging ones, which {@link staging} answers. */
const request = vi.fn()

/** The server's staging area for the caller: hashes held, and every staging call made. */
const staging = {
  held: new Set<string>(),
  asked: [] as string[][],
  uploaded: [] as string[][],
}

/** Answers the staging calls as the server would, from {@link staging}. */
async function stagingAnswer(path: string, options: { body?: unknown; form?: FormData }) {
  if (path.endsWith('/source/blobs/missing')) {
    const { blobs } = options.body as { blobs: Array<{ sha256: string }> }
    staging.asked.push(blobs.map((blob) => blob.sha256))
    return {
      data: {
        workspaceId: 'ws_local',
        missing: blobs.map((blob) => blob.sha256).filter((sha256) => !staging.held.has(sha256)),
      },
    }
  }
  const sent: string[] = []
  for (const [sha256, value] of options.form?.entries() ?? []) {
    const bytes = Buffer.from(await (value as File).arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
    sent.push(sha256)
    staging.held.add(sha256)
  }
  staging.uploaded.push(sent)
  return { data: { workspaceId: 'ws_local', staged: [] } }
}

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

const BASE = { version: 1, workspaceId: 'ws_local', resources: {} }
const LEADS = "// @sim-sdk 1\nexport default defineTable({ name: 'leads', columns: {} })\n"
const INGEST = "// @sim-sdk 1\nexport default workflow('Ingest', {}, () => {})\n"
/** A workflow folder's base, as a get in `workspaceId` writes it. */
const folderBase = (workspaceId: string) =>
  JSON.stringify({ workflowId: 'wf_1', workspaceId, fingerprint: 'sf1:a', catalogHash: 'c' })
const INGEST_BASE = folderBase('ws_local')

function answer(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      workspaceId: 'ws_local',
      dryRun: false,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: BASE,
      diagnostics: [],
      ...overrides,
    },
  }
}

let dir: string

function write(path: string, text: string | Buffer) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

function apply(...argv: string[]): Promise<void> {
  return runWorkspaceSource('apply', dir, ...argv)
}

function bodies(): Array<{
  files: Record<string, string>
  blobs?: Array<{ path: string; sha256: string; size: number }>
}> {
  return request.mock.calls.map((call) => call[1].body)
}

beforeEach(() => {
  contextMockState.output = 'json'
  contextMockState.workspaceSource = 'config'
  request.mockReset()
  mockRequest.mockReset()
  mockRequest.mockImplementation((path: string, options: { body?: unknown; form?: FormData }) =>
    path.includes('/source/blobs') ? stagingAnswer(path, options) : request(path, options)
  )
  staging.held.clear()
  staging.asked.length = 0
  staging.uploaded.length = 0
  dir = mkdtempSync(join(tmpdir(), 'sim-workspace-apply-'))
  write('.sim/base.json', JSON.stringify(BASE))
  write('tables/leads.ts', LEADS)
  write('workflows/ingest/workflow.ts', INGEST)
  write('workflows/ingest/.sim/base.json', INGEST_BASE)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('workspaces source apply', () => {
  it('without --yes and nobody at a terminal, prints the plan, writes nothing and exits 14', async () => {
    request.mockResolvedValue(
      answer({ dryRun: true, plan: [{ kind: 'table', key: 'leads', action: 'create' }] })
    )

    await apply('--allow-delete')

    expect(request.mock.calls.map((call) => call[1].query?.dryRun === true)).toEqual([true])
    expect(process.exitCode).toBe(14)
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(printed).toMatchObject({
      dryRun: true,
      created: [{ kind: 'table', key: 'leads' }],
      next: { command: `sim workspaces source apply --dir ${dir} --allow-delete --yes` },
    })
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('+ leads')
  })

  it('with --yes, prints the plan it applied', async () => {
    request.mockResolvedValue(
      answer({
        plan: [{ kind: 'table', key: 'leads', action: 'create' }],
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
      })
    )

    await apply('--yes')

    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('+ leads')
  })

  it('counts and lists a resource the server changed or deleted, never as unchanged, and keeps its warning in the JSON', async () => {
    const drift = (code: string, kind: string, key: string) => ({
      code,
      severity: 'warning',
      message: `${kind} ${key} drifted.`,
      kind,
      key,
    })
    request.mockResolvedValue(
      answer({
        dryRun: true,
        plan: [
          { kind: 'skill', key: 'tone', action: 'noop' },
          { kind: 'file', key: 'notes.txt', action: 'noop' },
          { kind: 'file', key: 'partial.txt', action: 'noop' },
        ],
        diagnostics: [
          drift('W_SERVER_CHANGED', 'skill', 'tone'),
          drift('W_SERVER_DELETED', 'file', 'partial.txt'),
        ],
      })
    )

    await apply('--dry-run')

    const stderr = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(stderr).toContain('skills: 1 changed on the server')
    expect(stderr).toContain('files: 1 unchanged, 1 deleted on the server')
    expect(stderr).toContain('  ! partial.txt (deleted on the server; kept as the server has it)')
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(printed.diagnostics.map((finding: { code: string }) => finding.code)).toEqual([
      'W_SERVER_CHANGED',
      'W_SERVER_DELETED',
    ])
  })

  it('puts each finding of a dry run in the JSON on stdout', async () => {
    const finding = {
      code: 'E_DECL_SHAPE',
      severity: 'error',
      message: 'tables/leads.ts does not read.',
      file: 'tables/leads.ts',
      line: 1,
      column: 1,
      kind: 'table',
      key: 'leads',
    }
    request.mockResolvedValue(answer({ dryRun: true, diagnostics: [finding] }))

    await apply('--dry-run')

    const calls = vi.mocked(console.log).mock.calls
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].join(' '))).toMatchObject({ errors: 1, diagnostics: [finding] })
  })

  it('refuses a directory holding no workspace source before sending anything', async () => {
    rmSync(join(dir, 'tables'), { recursive: true })
    rmSync(join(dir, 'workflows'), { recursive: true })

    const error = await apply('--yes').catch((caught: unknown) => caught)

    expect(error).toMatchObject({ message: expect.stringContaining('holds no workspace source') })
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses a workflow source directory before sending anything', async () => {
    write('.sim/base.json', INGEST_BASE)

    const error = await apply('--yes').catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      message: expect.stringContaining('is a workflow source directory'),
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('sends a workflow folder whole only when it was edited since the CLI wrote it', async () => {
    write(
      '.sim/written.json',
      JSON.stringify({
        files: {
          'workflows/ingest/workflow.ts': digest(INGEST),
          'workflows/ingest/.sim/base.json': digest(INGEST_BASE),
        },
      })
    )
    request.mockResolvedValue(answer())

    await apply('--yes')

    expect(Object.keys(bodies()[0].files).sort()).toEqual([
      'tables/leads.ts',
      'workflows/ingest/.sim/base.json',
    ])

    write('workflows/ingest/workflow.ts', `${INGEST}// edited\n`)
    request.mockClear()
    await apply('--yes')

    expect(Object.keys(bodies()[0].files)).toContain('workflows/ingest/workflow.ts')
  })

  it('sends an unchanged workflow folder copied from another workspace whole', async () => {
    const copied = folderBase('ws_other')
    write('workflows/ingest/.sim/base.json', copied)
    write(
      '.sim/written.json',
      JSON.stringify({
        files: {
          'workflows/ingest/workflow.ts': digest(INGEST),
          'workflows/ingest/.sim/base.json': digest(copied),
        },
      })
    )
    request.mockResolvedValue(answer())

    await apply('--yes')

    expect(bodies()[0].files['workflows/ingest/workflow.ts']).toBe(INGEST)
  })

  it('promotes with --to: the target binds by key, and the directory stays bound to its own workspace', async () => {
    const prodBase = {
      version: 1,
      workspaceId: 'ws_prod',
      resources: {
        'table:leads': { id: 'tbl_prod', fingerprint: `rf1:${'a'.repeat(64)}` },
        'table:audit': { id: 'tbl_audit', fingerprint: `rf1:${'b'.repeat(64)}` },
        'workflow:ingest': { id: 'wf_prod' },
      },
    }
    const prodFolderBase = JSON.stringify({
      ...JSON.parse(folderBase('ws_prod')),
      workflowId: 'wf_prod',
    })
    write('workflows/ingest/.sim/lock.json', '{"version":1,"blocks":{},"variables":{}}')
    write(
      '.sim/written.json',
      JSON.stringify({
        files: {
          'workflows/ingest/workflow.ts': digest(INGEST),
          'workflows/ingest/.sim/base.json': digest(INGEST_BASE),
        },
      })
    )
    const before = readFileSync(join(dir, '.sim/base.json'), 'utf8')
    request.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path === '/api/v2/workspaces/ws_prod/source' && options.body === undefined) {
        return {
          data: {
            workspaceId: 'ws_prod',
            kinds: ['table', 'workflow'],
            files: {
              'tables/leads.ts': LEADS,
              'tables/audit.ts': LEADS,
              'workflows/ingest/workflow.ts': INGEST,
              'workflows/ingest/.sim/base.json': prodFolderBase,
            },
            blobs: [],
            base: prodBase,
            skipped: [],
            diagnostics: [],
          },
        }
      }
      return answer({
        workspaceId: 'ws_prod',
        applied: [{ kind: 'table', key: 'leads', action: 'update', id: 'tbl_prod' }],
        files: { 'tables/leads.ts': '// reprinted by prod\n' },
        base: prodBase,
      })
    })

    await apply('--to', 'ws_prod', '--yes')

    const post = request.mock.calls.find(([, options]) => options.body !== undefined)
    const sent = post?.[1].body
    expect(sent.base).toEqual({
      ...prodBase,
      resources: {
        'table:leads': prodBase.resources['table:leads'],
        'workflow:ingest': prodBase.resources['workflow:ingest'],
      },
    })
    expect(sent.files).toEqual({
      'tables/leads.ts': LEADS,
      'workflows/ingest/workflow.ts': INGEST,
      'workflows/ingest/.sim/base.json': prodFolderBase,
    })
    expect(readFileSync(join(dir, '.sim/base.json'), 'utf8')).toBe(before)
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(LEADS)
  })

  it('records what a promotion left in the target, and compares the next promotion with it rather than the target as read then', async () => {
    const leads = (fingerprint: string) => ({
      id: 'tbl_prod',
      fingerprint: `rf1:${fingerprint.repeat(64)}`,
    })
    let live = { version: 1, workspaceId: 'ws_prod', resources: { 'table:leads': leads('a') } }
    request.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path === '/api/v2/workspaces/ws_prod/source' && options.body === undefined) {
        return {
          data: {
            workspaceId: 'ws_prod',
            kinds: ['table'],
            files: { 'tables/leads.ts': LEADS },
            blobs: [],
            base: live,
            skipped: [],
            diagnostics: [],
          },
        }
      }
      return answer({ workspaceId: 'ws_prod', base: live })
    })

    await apply('--to', 'ws_prod', '--only', 'tables', '--dry-run')
    expect(existsSync(join(dir, '.sim/targets/ws_prod.json'))).toBe(false)
    await apply('--to', 'ws_prod', '--only', 'tables', '--yes')
    expect(JSON.parse(readFileSync(join(dir, '.sim/targets/ws_prod.json'), 'utf8'))).toMatchObject({
      version: 1,
      workspaceId: 'ws_prod',
      resources: { 'table:leads': leads('a') },
    })

    live = { ...live, resources: { 'table:leads': leads('b') } }
    request.mockClear()
    await apply('--to', 'ws_prod', '--only', 'tables', '--yes')

    const post = request.mock.calls.find(([, options]) => options.body !== undefined)
    expect(post?.[1].body.base.resources['table:leads']).toEqual(leads('a'))
  })

  it('counts the changes that delete data in a dry run, and says re-applying an older directory does not restore it', async () => {
    request.mockResolvedValue(
      answer({
        dryRun: true,
        plan: [
          {
            kind: 'table',
            key: 'leads',
            action: 'update',
            destructive: { what: 'rows', counts: { rows: 40 } },
          },
          {
            kind: 'skill',
            key: 'tone',
            action: 'delete',
            destructive: { what: 'skill', counts: {} },
          },
          { kind: 'workflow', key: 'ingest', action: 'update' },
        ],
      })
    )

    await apply('--dry-run')

    const summary = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(summary).toMatchObject({ deleted: 1, destructive: 2 })
    const stderr = vi
      .mocked(console.error)
      .mock.calls.map((call) => call.join(' '))
      .join('\n')
    expect(stderr).toContain('2 change(s) delete data that applying an older directory')
  })

  it('prints a delete refused for want of --allow-delete as refused, not unchanged', async () => {
    request.mockResolvedValue(
      answer({
        dryRun: true,
        plan: [
          { kind: 'skill', key: 'tone', action: 'noop' },
          { kind: 'skill', key: 'brief', action: 'noop' },
        ],
        diagnostics: [
          {
            code: 'E_APPLY_DELETE_NOT_ALLOWED',
            severity: 'error',
            message: 'skills/tone is no longer declared; deleting "tone" needs --allow-delete.',
            kind: 'skill',
            key: 'tone',
          },
        ],
      })
    )

    await apply('--dry-run')

    const stderr = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(stderr).toContain('skills: 1 delete refused, 1 unchanged')
    expect(stderr).toContain('  - tone — refused, needs --allow-delete')
  })

  it('prints a --to dry run with its findings in the JSON result', async () => {
    request.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path === '/api/v2/workspaces/ws_prod/source' && options.body === undefined) {
        return {
          data: {
            workspaceId: 'ws_prod',
            kinds: ['table', 'workflow'],
            files: {},
            blobs: [],
            base: { version: 1, workspaceId: 'ws_prod', resources: {} },
            skipped: [],
            diagnostics: [],
          },
        }
      }
      return answer({
        workspaceId: 'ws_prod',
        dryRun: true,
        plan: [{ kind: 'table', key: 'leads', action: 'create' }],
        diagnostics: [
          {
            code: 'W_UNDECLARED',
            severity: 'warning',
            message: 'kept',
            kind: 'table',
            key: 'audit',
          },
        ],
      })
    })

    await apply('--to', 'ws_prod', '--dry-run')

    const summary = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(summary).toMatchObject({
      workspaceId: 'ws_prod',
      dryRun: true,
      created: [{ kind: 'table', key: 'leads' }],
      diagnostics: [expect.objectContaining({ code: 'W_UNDECLARED', key: 'audit' })],
    })
  })

  it('a --to dry run warns of what the target deleted since the last promotion, gives stale findings a promotion hint, and names each target-only delete', async () => {
    const leads = { id: 'tbl_prod', fingerprint: `rf1:${'a'.repeat(64)}` }
    const dropped = { id: 'tbl_dropped', fingerprint: `rf1:${'d'.repeat(64)}` }
    write(
      '.sim/targets/ws_prod.json',
      JSON.stringify({
        version: 1,
        workspaceId: 'ws_prod',
        resources: {
          'table:leads': leads,
          'table:gone': { id: 'tbl_gone', fingerprint: `rf1:${'c'.repeat(64)}` },
          'table:dropped': dropped,
        },
        workflows: {},
      })
    )
    write('tables/gone.ts', LEADS.replace("'leads'", "'gone'"))
    request.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path === '/api/v2/workspaces/ws_prod/source' && options.body === undefined) {
        return {
          data: {
            workspaceId: 'ws_prod',
            kinds: ['table'],
            files: {
              'tables/leads.ts': LEADS,
              'tables/prod-only.ts': LEADS,
              'tables/dropped.ts': LEADS,
            },
            blobs: [],
            base: {
              version: 1,
              workspaceId: 'ws_prod',
              resources: {
                'table:leads': leads,
                'table:prod-only': { id: 'tbl_only' },
                'table:dropped': dropped,
              },
            },
            skipped: [],
            diagnostics: [],
          },
        }
      }
      return answer({
        workspaceId: 'ws_prod',
        dryRun: true,
        plan: [
          { kind: 'table', key: 'gone', action: 'noop' },
          { kind: 'table', key: 'leads', action: 'noop' },
          { kind: 'table', key: 'prod-only', action: 'delete' },
          { kind: 'table', key: 'dropped', action: 'delete' },
          { kind: 'table', key: 'hotfixed', action: 'noop' },
        ],
        diagnostics: [
          {
            code: 'W_SERVER_CHANGED',
            severity: 'warning',
            message: 'tables/hotfixed changed on the server since this directory was read.',
            hint: 'Run `sim workspaces source get` into a fresh directory to see what changed.',
            kind: 'table',
            key: 'hotfixed',
          },
          {
            code: 'W_SERVER_DELETED',
            severity: 'warning',
            message: 'tables/gone was deleted on the server; the apply keeps it deleted.',
            kind: 'table',
            key: 'gone',
          },
          {
            code: 'E_APPLY_STALE',
            severity: 'error',
            message: 'tables/leads changed on the server since this directory was read.',
            hint: 'Run `sim workspaces source get` into a fresh directory, reapply your edit there, and apply again.',
            kind: 'table',
            key: 'leads',
          },
        ],
      })
    })

    await apply(
      '--to',
      'ws_prod',
      '--only',
      'tables',
      '--allow-delete',
      '--delete-target-only',
      '--dry-run'
    )

    const summary = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    const byCode = (code: string) =>
      summary.diagnostics.filter((finding: { code: string }) => finding.code === code)
    expect(byCode('W_PROMOTE_TARGET_DELETED')).toEqual([
      expect.objectContaining({ kind: 'table', key: 'gone' }),
    ])
    expect(byCode('W_SERVER_DELETED')).toEqual([])
    expect(byCode('W_PROMOTE_DELETES_TARGET_ONLY')).toEqual([
      expect.objectContaining({ kind: 'table', key: 'prod-only' }),
    ])
    const [stale] = byCode('E_APPLY_STALE')
    expect(stale.hint).toContain('.sim/targets/ws_prod.json')
    expect(stale.hint).not.toContain('fresh directory')
    expect(stale.hint).toContain('sim workspaces source get --workspace ws_prod')
    expect(stale.hint).not.toContain('.sim/targets/ws_prod.json first')
    const [drifted] = byCode('W_SERVER_CHANGED')
    expect(drifted.hint).toContain('sim workspaces source get --workspace ws_prod')
    const stderr = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(stderr).toContain('  ! gone (deleted on the server; kept as the server has it)')
    expect(stderr).toContain('  ! leads (changed on the server; your edit is refused as stale)')
    expect(stderr).not.toContain('resource(s) that only workspace ws_prod holds')
  })

  it('a --to with --allow-delete keeps what only the target holds, naming it, and points at --delete-target-only', async () => {
    const leads = { id: 'tbl_prod', fingerprint: `rf1:${'a'.repeat(64)}` }
    write(
      '.sim/targets/ws_prod.json',
      JSON.stringify({
        version: 1,
        workspaceId: 'ws_prod',
        resources: { 'table:leads': leads, 'table:dropped': { id: 'tbl_dropped' } },
        workflows: {},
      })
    )
    const sent: unknown[] = []
    request.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path === '/api/v2/workspaces/ws_prod/source' && options.body === undefined) {
        return {
          data: {
            workspaceId: 'ws_prod',
            kinds: ['table'],
            files: {
              'tables/leads.ts': LEADS,
              'tables/dropped.ts': LEADS,
              'tables/audit.ts': LEADS,
            },
            blobs: [],
            base: {
              version: 1,
              workspaceId: 'ws_prod',
              resources: {
                'table:leads': leads,
                'table:dropped': { id: 'tbl_dropped' },
                'table:audit': { id: 'tbl_audit' },
              },
            },
            skipped: [],
            diagnostics: [],
          },
        }
      }
      sent.push(options.body)
      return answer({
        workspaceId: 'ws_prod',
        dryRun: true,
        plan: [
          { kind: 'table', key: 'leads', action: 'noop' },
          { kind: 'table', key: 'dropped', action: 'delete' },
          { kind: 'table', key: 'audit', action: 'noop' },
        ],
        diagnostics: [
          {
            code: 'W_UNDECLARED',
            severity: 'warning',
            message:
              '"audit" (table audit) is on the server but not in this directory; it is kept.',
            kind: 'table',
            key: 'audit',
          },
        ],
      })
    })

    await apply('--to', 'ws_prod', '--only', 'tables', '--allow-delete', '--dry-run')

    const [body] = sent as Array<{ base: { resources: Record<string, unknown> } }>
    expect(Object.keys(body.base.resources).sort()).toEqual(['table:dropped', 'table:leads'])
    const summary = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    const [kept] = summary.diagnostics.filter(
      (finding: { code: string }) => finding.code === 'W_UNDECLARED'
    )
    expect(kept).toMatchObject({ key: 'audit' })
    expect(kept.hint).toContain('--delete-target-only')
    expect(
      summary.diagnostics.filter(
        (finding: { code: string }) => finding.code === 'W_PROMOTE_DELETES_TARGET_ONLY'
      )
    ).toEqual([])
  })

  it('refuses --delete-target-only without --to or without --allow-delete', async () => {
    await expect(apply('--to', 'ws_prod', '--delete-target-only', '--yes')).rejects.toThrow(
      /needs --allow-delete/
    )
    await expect(apply('--allow-delete', '--delete-target-only', '--yes')).rejects.toThrow(
      /needs --to/
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('names only the target-only deletes a promotion that stopped part-way wrote', async () => {
    const target = {
      version: 1,
      workspaceId: 'ws_prod',
      resources: { 'table:one': { id: 'tbl_one' }, 'table:two': { id: 'tbl_two' } },
    }
    request.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path === '/api/v2/workspaces/ws_prod/source' && options.body === undefined) {
        return {
          data: {
            workspaceId: 'ws_prod',
            kinds: ['table'],
            files: { 'tables/one.ts': LEADS, 'tables/two.ts': LEADS },
            blobs: [],
            base: target,
            skipped: [],
            diagnostics: [],
          },
        }
      }
      return answer({
        workspaceId: 'ws_prod',
        base: target,
        plan: [
          { kind: 'table', key: 'one', action: 'delete' },
          { kind: 'table', key: 'two', action: 'delete' },
        ],
        applied: [{ kind: 'table', key: 'one', action: 'delete' }],
        failed: { kind: 'table', key: 'two', code: 'E_APPLY_FAILED', message: 'failed' },
      })
    })

    await apply(
      '--to',
      'ws_prod',
      '--only',
      'tables',
      '--allow-delete',
      '--delete-target-only',
      '--yes'
    )

    const summary = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(
      summary.diagnostics
        .filter((finding: { code: string }) => finding.code === 'W_PROMOTE_DELETES_TARGET_ONLY')
        .map((finding: { key: string }) => finding.key)
    ).toEqual(['one'])
  })

  it('refuses --to naming the workspace the directory was read from', async () => {
    await expect(apply('--to', 'ws_local', '--yes')).rejects.toThrow(/apply it without --to/)
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses while another command holds the directory, and takes over a lock its dead owner left', async () => {
    request.mockResolvedValue(answer())
    mkdirSync(join(dir, '.sim/command.lock'))
    write('.sim/command.lock/owner.json', JSON.stringify({ pid: process.pid, host: hostname() }))

    const busy = await apply('--yes').then(
      () => null,
      (error: unknown) => error
    )
    expect(busy).toBeInstanceOf(SimApiError)
    expect(busy).toMatchObject({ code: 'SOURCE_DIR_BUSY', exitCode: 10 })
    expect(request).not.toHaveBeenCalled()

    const exited = spawnSync(process.execPath, ['-e', '0'])
    write('.sim/command.lock/owner.json', JSON.stringify({ pid: exited.pid, host: hostname() }))
    await apply('--yes')

    expect(request).toHaveBeenCalled()
    expect(existsSync(join(dir, '.sim/command.lock'))).toBe(false)
  })

  it('dry-runs a directory no one may write, and refuses to apply it with the reason, not a crash', async () => {
    request.mockResolvedValue(answer({ dryRun: true }))
    for (const path of ['', '.sim', 'tables', 'workflows', 'workflows/ingest']) {
      chmodSync(join(dir, path), 0o555)
    }
    try {
      await apply('--dry-run')
      expect(request).toHaveBeenCalledTimes(1)

      const refused = await apply('--yes').then(
        () => null,
        (error: unknown) => error
      )
      expect(refused).toBeInstanceOf(SimApiError)
      expect(refused).toMatchObject({ code: 'SOURCE_DIR_UNWRITABLE' })
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      for (const path of ['', '.sim', 'tables', 'workflows', 'workflows/ingest']) {
        chmodSync(join(dir, path), 0o755)
      }
    }
  })

  it('refuses a base a merge conflict broke, naming the way out, before sending anything', async () => {
    write('.sim/base.json', '<<<<<<< HEAD\n{"version":1}\n')

    const refused = await apply('--dry-run').then(
      () => null,
      (error: unknown) => error
    )

    expect(refused).toMatchObject({
      code: 'SOURCE_BASE_INVALID',
      message: expect.stringContaining('sim workspaces source get --dir <fresh dir>'),
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps the code file of a tool the apply reprinted as stored(), warns, and never sends it again', async () => {
    const schema = "{ type: 'function', function: { name: 'lookup', parameters: {} } }"
    const declaration = (call: 'codeFile' | 'stored', code: string) =>
      `// @sim-sdk 1\nimport { ${call}, defineTool } from '@sim/workflow-sdk/workspace'\n\nexport default defineTool({ title: 'Lookup', schema: ${schema}, code: ${code} })\n`
    write('tools/lookup.ts', declaration('codeFile', "codeFile('./lookup.js')"))
    write('tools/lookup.js', 'return 1\n')
    write('tools/other.js', 'return 2\n')
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'custom-tool', key: 'lookup', action: 'update', id: 'tool_1' }],
        files: { 'tools/lookup.ts': declaration('stored', 'stored()') },
      })
    )

    await apply('--yes')

    expect(bodies()[0].files['tools/lookup.js']).toBe('return 1\n')
    // The person's only copy of the code: like a workflow's function file, it is never deleted.
    expect(readFileSync(join(dir, 'tools/lookup.js'), 'utf8')).toBe('return 1\n')
    expect(readFileSync(join(dir, 'tools/other.js'), 'utf8')).toBe('return 2\n')
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
      'warning: tools/lookup.js is no longer named by tools/lookup.ts'
    )
    const record = JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8'))
    expect(Object.keys(record.files)).toContain('tools/lookup.ts')
    expect(Object.keys(record.files)).not.toContain('tools/lookup.js')

    request.mockResolvedValue(answer({ dryRun: true }))
    await apply('--dry-run')
    expect(Object.keys(bodies()[1].files)).not.toContain('tools/lookup.js')
  })

  it('removes the function files an applied workflow no longer uses, keeping files the CLI never wrote', async () => {
    const lock = (codeFiles: string[]) =>
      `${JSON.stringify({ version: 1, blocks: Object.fromEntries(codeFiles.map((file, index) => [`b${index}`, { id: `blk_${index}`, codeFile: file }])), variables: {} })}\n`
    // A hand-edited lock names mine.js too; the CLI never wrote it, so it is never pruned.
    write(
      'workflows/ingest/.sim/lock.json',
      lock(['functions/score.js', 'functions/old.js', 'functions/mine.js'])
    )
    write('workflows/ingest/functions/score.js', 'return 1\n')
    write('workflows/ingest/functions/old.js', 'return 2\n')
    write('workflows/ingest/functions/mine.js', 'return 3\n')
    write(
      '.sim/written.json',
      JSON.stringify({
        files: {
          'workflows/ingest/functions/score.js': digest('return 1\n'),
          'workflows/ingest/functions/old.js': digest('return 2\n'),
        },
      })
    )
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'workflow', key: 'ingest', action: 'update', id: 'wf_1' }],
        files: {
          'workflows/ingest/workflow.ts': INGEST,
          'workflows/ingest/functions/score.js': 'return 1\n',
          'workflows/ingest/.sim/lock.json': lock(['functions/score.js']),
          'workflows/ingest/.sim/base.json': '{}\n',
        },
      })
    )

    await apply('--yes')

    expect(existsSync(join(dir, 'workflows/ingest/functions/old.js'))).toBe(false)
    expect(existsSync(join(dir, 'workflows/ingest/functions/score.js'))).toBe(true)
    expect(existsSync(join(dir, 'workflows/ingest/functions/mine.js'))).toBe(true)
    const written = JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files
    expect(Object.keys(written)).not.toContain('workflows/ingest/functions/old.js')
  })

  it('never prunes a lock entry that names the functions folder rather than a function file', async () => {
    const lock = (codeFiles: string[]) =>
      `${JSON.stringify({ version: 1, blocks: Object.fromEntries(codeFiles.map((file, index) => [`b${index}`, { id: `blk_${index}`, codeFile: file }])), variables: {} })}\n`
    write('workflows/ingest/.sim/lock.json', lock(['functions/', 'functions/score.js']))
    write('workflows/ingest/functions/score.js', 'return 1\n')
    write('workflows/ingest/functions/mine.js', 'return 3\n')
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'workflow', key: 'ingest', action: 'update', id: 'wf_1' }],
        files: {
          'workflows/ingest/workflow.ts': INGEST,
          'workflows/ingest/functions/score.js': 'return 1\n',
          'workflows/ingest/.sim/lock.json': lock(['functions/score.js']),
          'workflows/ingest/.sim/base.json': '{}\n',
        },
      })
    )

    await apply('--yes')

    expect(readFileSync(join(dir, 'workflows/ingest/functions/mine.js'), 'utf8')).toBe('return 3\n')
    expect(existsSync(join(dir, 'workflows/ingest/functions/score.js'))).toBe(true)
  })

  it('keeps every function file of a workflow whose new lock does not read as one', async () => {
    write(
      'workflows/ingest/.sim/lock.json',
      `${JSON.stringify({ version: 1, blocks: { b0: { id: 'blk_0', codeFile: 'functions/score.js' } }, variables: {} })}\n`
    )
    write('workflows/ingest/functions/score.js', 'return 1\n')
    request.mockResolvedValue(
      answer({
        applied: [{ kind: 'workflow', key: 'ingest', action: 'update', id: 'wf_1' }],
        files: {
          'workflows/ingest/workflow.ts': INGEST,
          'workflows/ingest/.sim/lock.json': '{ not json',
          'workflows/ingest/.sim/base.json': '{}\n',
        },
      })
    )

    await apply('--yes')

    expect(existsSync(join(dir, 'workflows/ingest/functions/score.js'))).toBe(true)
  })

  it('saves what a part-way apply wrote and exits 8', async () => {
    request.mockResolvedValue(
      answer({
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'create' },
        ],
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
        failed: { kind: 'workflow', key: 'ingest', code: 'E_APPLY_FAILED', message: 'failed' },
        files: { 'tables/leads.ts': `${LEADS}// stored\n` },
        base: { ...BASE, resources: { 'table:leads': { id: 'tbl_1' } } },
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(8)
    const printed = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(JSON.parse(printed)).toMatchObject({
      applied: 1,
      created: [{ kind: 'table', key: 'leads', id: 'tbl_1' }],
      failed: 'workflow:ingest',
    })
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// stored\n`)
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).resources).toEqual({
      'table:leads': { id: 'tbl_1' },
    })
  })

  it('after a part-way stop, reprints the plan marking each change written or not', async () => {
    request.mockResolvedValue(
      answer({
        plan: [
          { kind: 'skill', key: 'second', action: 'create' },
          { kind: 'mcp-server', key: 'bad', action: 'create' },
          { kind: 'file', key: 'partial.txt', action: 'create' },
          { kind: 'table', key: 'leads', action: 'noop' },
        ],
        applied: [{ kind: 'skill', key: 'second', action: 'create', id: 'sk_1' }],
        failed: { kind: 'mcp-server', key: 'bad', code: 'E_APPLY_FAILED', message: 'failed' },
      })
    )

    await apply('--yes')

    const stderr = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(stderr).toContain('+ second — written')
    expect(stderr).toContain('+ bad — failed, not written')
    expect(stderr).toContain('+ partial.txt — not written')
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(printed).toMatchObject({
      failed: 'mcp-server:bad',
      notWritten: ['mcp-server:bad', 'file:partial.txt'],
    })
  })

  it.each([
    ['E_APPLY_STALE', 5],
    ['E_APPLY_LOCKED', 6],
    ['E_APPLY_FORBIDDEN', 1],
    ['E_APPLY_REFUSED', 1],
    ['E_LIMIT_EXCEEDED', 7],
  ])('exits a part-way apply refused with %s as that refusal, not 8', async (code, exitCode) => {
    request.mockResolvedValue(
      answer({
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'update' },
        ],
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
        failed: { kind: 'workflow', key: 'ingest', code, message: code },
        files: { 'tables/leads.ts': `${LEADS}// stored\n` },
        base: { ...BASE, resources: { 'table:leads': { id: 'tbl_1' } } },
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(exitCode)
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// stored\n`)
  })

  it('stages only the blobs the base does not hold, then applies once naming them by hash', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write('files/b.bin', Buffer.from([4, 5]))
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.bin': {
            id: 'f1',
            blobs: { 'files/a.bin': { id: 'f1', rev: 1, sha256: sha(Buffer.from([1, 2, 3])) } },
          },
        },
      })
    )
    request.mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.asked).toEqual([[sha(Buffer.from([4, 5]))]])
    expect(staging.uploaded).toEqual([[sha(Buffer.from([4, 5]))]])
    expect(request).toHaveBeenCalledTimes(1)
    expect(bodies()[0].blobs).toEqual([
      { path: 'files/a.bin', sha256: sha(Buffer.from([1, 2, 3])), size: 3 },
      { path: 'files/b.bin', sha256: sha(Buffer.from([4, 5])), size: 2 },
    ])
    expect(request.mock.calls.every((call) => call[1].query === undefined)).toBe(true)
  })

  it('a resumed apply uploads only the blobs not already staged', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write('files/b.bin', Buffer.from([4, 5]))
    staging.held.add(sha(Buffer.from([1, 2, 3])))
    request.mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.asked[0]?.sort()).toEqual(
      [sha(Buffer.from([1, 2, 3])), sha(Buffer.from([4, 5]))].sort()
    )
    expect(staging.uploaded).toEqual([[sha(Buffer.from([4, 5]))]])
  })

  it('stages what a refusal names as missing and applies once more; any other refusal stands', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.bin': {
            id: 'f1',
            blobs: { 'files/a.bin': { id: 'f1', rev: 1, sha256: sha(Buffer.from([1, 2, 3])) } },
          },
        },
      })
    )
    const missing = new SimApiError('Rejected', 400, 'SOURCE_REJECTED', {
      code: 'SOURCE_REJECTED',
      diagnostics: [
        { code: 'E_BLOB_MISSING', severity: 'error', message: 'missing', file: 'files/a.bin' },
      ],
    })
    request.mockRejectedValueOnce(missing).mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.uploaded).toEqual([[sha(Buffer.from([1, 2, 3]))]])
    expect(request).toHaveBeenCalledTimes(2)

    request.mockReset()
    request.mockRejectedValue(missing)
    await expect(apply('--yes')).rejects.toMatchObject({ status: 400 })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('refuses a blob that changed after it was hashed, before staging or applying it', async () => {
    write('files/a.bin', Buffer.from([1, 2, 3]))
    mockRequest.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path.endsWith('/source/blobs/missing')) write('files/a.bin', Buffer.from([9, 9, 9]))
      return stagingAnswer(path, options)
    })

    await expect(apply('--yes')).rejects.toMatchObject({ code: 'SOURCE_BLOB_CHANGED' })
    expect(staging.uploaded).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('a staging request the server refuses as too large applies nothing, names the upload and the fix, and exits 7', async () => {
    write('files/a.bin', Buffer.alloc(3_000, 1))
    mockRequest.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path.endsWith('/source/blobs')) {
        throw new SimApiError('Request body is too large', 413, 'PAYLOAD_TOO_LARGE')
      }
      return path.includes('/source/blobs') ? stagingAnswer(path, options) : request(path, options)
    })

    const refused = await apply('--yes').then(
      () => null,
      (error: unknown) => error
    )

    expect(refused).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE', exitCode: 7 })
    expect((refused as SimApiError).message).toContain('files/a.bin')
    expect((refused as SimApiError).message).toContain('sim update')
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps the server’s refusal of a staging area with no room, which no CLI update or proxy fixes', async () => {
    write('files/a.bin', Buffer.alloc(3_000, 1))
    const full =
      'Staging 3000 more bytes would hold 2000000001, over the 2000000000-byte limit. Staged files expire a day after they were last staged.'
    mockRequest.mockImplementation(async (path: string, options: { body?: unknown }) => {
      if (path.endsWith('/source/blobs')) {
        throw new SimApiError(full, 413, 'PAYLOAD_TOO_LARGE', { code: 'SOURCE_STAGING_FULL' })
      }
      return path.includes('/source/blobs') ? stagingAnswer(path, options) : request(path, options)
    })

    const refused = await apply('--yes').then(
      () => null,
      (error: unknown) => error
    )

    expect(refused).toMatchObject({ status: 413, message: full })
    expect(request).not.toHaveBeenCalled()
  })

  it('uploads two files that would overflow one request body in two requests', async () => {
    write('files/a.bin', Buffer.alloc(6_000_000, 1))
    write('files/b.bin', Buffer.alloc(6_000_000, 2))
    request.mockResolvedValueOnce(answer())

    await apply('--yes')

    expect(staging.uploaded.map((batch) => batch.length)).toEqual([1, 1])
  })

  describe('rate limiting', () => {
    const limited = () =>
      new SimApiError('API rate limit exceeded', 429, 'RATE_LIMITED', undefined, 9)

    beforeEach(() => {
      write('files/a.bin', Buffer.from([1, 2, 3]))
      write('files/b.bin', Buffer.from([4, 5]))
    })

    it('a 429 while staging writes nothing and keeps the rate-limit exit; the rerun skips what landed', async () => {
      let uploads = 0
      mockRequest.mockImplementation(
        async (path: string, options: { body?: unknown; form?: FormData }) => {
          if (path.endsWith('/source/blobs') && ++uploads === 1) {
            await stagingAnswer(path, options)
            throw limited()
          }
          return path.includes('/source/blobs')
            ? stagingAnswer(path, options)
            : request(path, options)
        }
      )
      request.mockResolvedValue(answer())

      await expect(apply('--yes')).rejects.toMatchObject({ status: 429, exitCode: 9 })
      expect(request).not.toHaveBeenCalled()
      expect(existsSync(join(dir, '.sim/written.json'))).toBe(false)

      await apply('--yes')
      expect(staging.uploaded).toHaveLength(1)
      expect(request).toHaveBeenCalledTimes(1)
    })

    it('a 429 on the apply, which wrote nothing, keeps the rate-limit exit', async () => {
      request.mockRejectedValueOnce(limited())

      await expect(apply('--yes')).rejects.toMatchObject({ status: 429, exitCode: 9 })
      expect(existsSync(join(dir, '.sim/written.json'))).toBe(false)
    })

    it('marks the dry run, the apply and every staging call as safe to resend after a 429', async () => {
      request
        .mockResolvedValueOnce(answer({ dryRun: true, needBlobs: ['files/a.bin'] }))
        .mockResolvedValueOnce(answer())

      await apply('--dry-run')
      await apply('--yes')

      expect(request).toHaveBeenCalledTimes(2)
      expect(mockRequest).toHaveBeenCalledTimes(4)
      for (const call of mockRequest.mock.calls) expect(call[1].retryRateLimited).toBe(true)
    })
  })

  describe('the recorded blob digest', () => {
    const file = () => join(dir, 'files/a.bin')
    const sha = (bytes: number[]) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    /** The SHA-256 the last request named for the blob; a dry run sends it without the bytes. */
    const sentDigest = () => request.mock.lastCall?.[1].body.blobs?.[0]?.sha256

    /** Applies `files/a.bin` once, so `.sim/written.json` records its digest and stat. */
    async function applyOnce(): Promise<void> {
      write('files/a.bin', Buffer.from([1, 2, 3]))
      utimesSync(file(), 1000, 1000)
      const held = sha([1, 2, 3])
      const base = {
        ...BASE,
        resources: {
          'file:a.bin': {
            id: 'f1',
            blobs: { 'files/a.bin': { id: 'f1', rev: '1', sha256: held } },
          },
        },
      }
      request.mockResolvedValue(answer({ base }))
      await apply('--yes')
      const written = JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8'))
      expect(written.files['files/a.bin']).toBe(held)
      expect(written.stats).toBeUndefined()
      const cached = JSON.parse(readFileSync(join(dir, '.sim/cache/stats.json'), 'utf8'))
      expect(cached.stats['files/a.bin']).toMatchObject({ sha256: held })
      expect(readFileSync(join(dir, '.sim/cache/.gitignore'), 'utf8')).toBe('*\n')
    }

    it('keeps the committed record free of this machine: a no-op apply of a fresh clone leaves it byte for byte', async () => {
      await applyOnce()
      rmSync(join(dir, '.sim/cache'), { recursive: true, force: true })
      const committed = readFileSync(join(dir, '.sim/written.json'), 'utf8')

      await apply('--yes')

      expect(readFileSync(join(dir, '.sim/written.json'), 'utf8')).toBe(committed)
      expect(existsSync(join(dir, '.sim/cache/stats.json'))).toBe(true)
    })

    it('stands while the file is untouched, so the file is not read', async () => {
      await applyOnce()
      const path = join(dir, '.sim/written.json')
      const written = JSON.parse(readFileSync(path, 'utf8'))
      const recorded = 'f'.repeat(64)
      writeFileSync(path, JSON.stringify({ ...written, files: { 'files/a.bin': recorded } }))
      const statsPath = join(dir, '.sim/cache/stats.json')
      const cached = JSON.parse(readFileSync(statsPath, 'utf8'))
      cached.stats['files/a.bin'].sha256 = recorded
      writeFileSync(statsPath, JSON.stringify(cached))

      await apply('--dry-run')

      expect(sentDigest()).toBe(recorded)
    })

    it('is read again after a same-size rewrite that put its modification time back', async () => {
      await applyOnce()
      write('files/a.bin', Buffer.from([7, 8, 9]))
      utimesSync(file(), 1000, 1000)

      await apply('--dry-run')

      expect(sentDigest()).toBe(sha([7, 8, 9]))
    })
  })

  it('names the way back when a write ends without an answer, but not for a refusal', async () => {
    request.mockRejectedValueOnce(
      new SimApiError('https://sim.test did not answer within 3600s.', 0)
    )
    await expect(apply('--yes')).rejects.toThrow(`sim workspaces source get --dir ${dir} --force`)

    request.mockRejectedValueOnce(new SimApiError('Refused.', 400, 'BAD_REQUEST'))
    await expect(apply('--yes')).rejects.toThrow(/^Refused\.$/)
  })

  it('refuses a server answer naming a path outside the kind folders', async () => {
    request.mockResolvedValue(answer({ files: { '.git/hooks/pre-commit': 'rm -rf /' } }))

    await expect(apply('--yes')).rejects.toThrow(/unsafe file path/)
  })

  it('applies to the workspace the directory was read from, refusing only a --workspace naming another', async () => {
    write('.sim/base.json', JSON.stringify({ ...BASE, workspaceId: 'ws_other' }))
    request.mockResolvedValue(answer())

    await apply('--yes')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('/api/v2/workspaces/ws_other/source')

    write('.sim/base.json', JSON.stringify({ ...BASE, workspaceId: 'ws_other' }))
    contextMockState.workspaceSource = 'flag'
    await expect(apply('--yes')).rejects.toMatchObject({
      code: 'SOURCE_OTHER_WORKSPACE',
      message: expect.stringContaining('--to ws_local'),
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('names the directory by its absolute path when --dir is relative', async () => {
    const cwd = process.cwd()
    process.chdir(dirname(dir))
    try {
      contextMockState.workspaceSource = 'flag'
      write('.sim/base.json', JSON.stringify({ ...BASE, workspaceId: 'ws_other' }))
      await expect(runWorkspaceSource('apply', basename(dir), '--yes')).rejects.toMatchObject({
        message: expect.stringContaining(`${realpathSync(dir)} was read from workspace ws_other`),
      })
    } finally {
      process.chdir(cwd)
    }
  })

  it('refuses a base that records blobs no get downloaded, but sends one the user removed', async () => {
    const sha256 = 'a'.repeat(64)
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.bin': { id: 'f1', blobs: { 'files/a.bin': { id: 'f1', rev: 1, sha256 } } },
          'knowledge-base:docs': {
            id: 'kb1',
            blobs: { 'guide.pdf': { id: 'd1', rev: 1, sha256 } },
          },
        },
      })
    )
    write('files/.gitkeep', '')
    write('knowledge/.gitkeep', '')
    request.mockResolvedValue(answer())

    await expect(apply('--yes', '--allow-delete')).rejects.toMatchObject({
      code: 'SOURCE_BLOBS_NOT_FETCHED',
      message: expect.stringContaining('files/a.bin, knowledge/docs/docs/guide.pdf'),
    })
    expect(request).not.toHaveBeenCalled()

    write(
      '.sim/written.json',
      JSON.stringify({ files: { 'files/a.bin': sha256, 'knowledge/docs/docs/guide.pdf': sha256 } })
    )
    await apply('--yes', '--allow-delete')

    expect(request).toHaveBeenCalled()
  })

  it('runs from a fresh clone of the committed directory: a removed blob is a delete, and a stale base exits 5', async () => {
    const sha256 = createHash('sha256').update('hello').digest('hex')
    write('files/a.txt', 'hello')
    write('files/b.txt', 'hello')
    write(
      '.sim/base.json',
      JSON.stringify({
        ...BASE,
        resources: {
          'file:a.txt': { id: 'f1', blobs: { 'files/a.txt': { id: 'f1', rev: 1, sha256 } } },
          'file:b.txt': { id: 'f2', blobs: { 'files/b.txt': { id: 'f2', rev: 1, sha256 } } },
        },
      })
    )
    write(
      '.sim/written.json',
      JSON.stringify({ files: { 'files/a.txt': sha256, 'files/b.txt': sha256 } })
    )
    write('.sim/command.lock/owner.json', '{}')
    write('.sim/downloads/partial.bin', 'x')
    write('.gitignore', '.sim/downloads/\n.sim/command.lock/\n.sim-staging-*/\n')
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args],
        { cwd, stdio: 'pipe' }
      )
    git(dir, 'init', '-q')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'workspace')
    const clone = mkdtempSync(join(tmpdir(), 'sim-workspace-clone-'))
    git(clone, 'clone', '-q', dir, 'repo')
    const repo = join(clone, 'repo')
    expect(existsSync(join(repo, '.sim/command.lock'))).toBe(false)
    expect(existsSync(join(repo, '.sim/downloads'))).toBe(false)
    git(repo, 'rm', '-q', 'files/b.txt')
    git(repo, 'commit', '-q', '-m', 'drop b')
    request.mockResolvedValue(answer({ dryRun: true }))

    await runWorkspaceSource('apply', repo, '--dry-run', '--allow-delete')

    expect(bodies()[0].blobs?.map((blob) => blob.path)).toEqual(['files/a.txt'])
    request.mockResolvedValue(
      answer({
        dryRun: true,
        diagnostics: [
          {
            code: 'E_APPLY_STALE',
            severity: 'error',
            message: 'changed',
            kind: 'file',
            key: 'a.txt',
          },
        ],
      })
    )
    await runWorkspaceSource('apply', repo, '--dry-run')
    expect(process.exitCode).toBe(5)
    rmSync(clone, { recursive: true, force: true })
  })

  it('records the blobs an apply uploaded, so removing one later deletes it', async () => {
    const sha256 = createHash('sha256').update('hello').digest('hex')
    const other = createHash('sha256').update('stale').digest('hex')
    write('files/a.txt', 'hello')
    write('files/b.txt', 'hello')
    write('knowledge/docs/knowledge.ts', '// @sim-sdk 1\n')
    write('knowledge/docs/docs/guide.md', 'hello')
    const after = {
      ...BASE,
      resources: {
        'file:a.txt': { id: 'f1', blobs: { 'files/a.txt': { id: 'f1', rev: '1', sha256 } } },
        'file:b.txt': { id: 'f2', blobs: { 'files/b.txt': { id: 'f2', rev: '1', sha256: other } } },
        'knowledge-base:docs': {
          id: 'kb1',
          blobs: { 'guide.md': { id: 'd1', rev: '1', sha256 } },
        },
      },
    }
    request.mockResolvedValue(answer({ base: after }))

    await apply('--yes')

    expect(JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files).toEqual({
      'files/a.txt': sha256,
      'knowledge/docs/docs/guide.md': sha256,
    })
    unlinkSync(join(dir, 'files/a.txt'))
    unlinkSync(join(dir, 'knowledge/docs/docs/guide.md'))
    write('files/b.txt', 'stale')
    await expect(apply('--yes', '--allow-delete')).resolves.toBeUndefined()
  })

  it('drops the record of what an apply deleted, but keeps a delete it held', async () => {
    const gone = sha('gone')
    const kept = sha('kept')
    write('files/kept.txt', 'kept')
    const before = {
      ...BASE,
      resources: {
        'table:leads': { id: 't1' },
        'table:old': { id: 't2' },
        'table:held': { id: 't3' },
        'file:gone.txt': {
          id: 'f1',
          blobs: { 'files/gone.txt': { id: 'f1', rev: '1', sha256: gone } },
        },
        'file:kept.txt': {
          id: 'f2',
          blobs: { 'files/kept.txt': { id: 'f2', rev: '1', sha256: kept } },
        },
      },
    }
    write('.sim/base.json', JSON.stringify(before))
    const recorded = {
      'tables/leads.ts': digest(LEADS),
      'tables/old.ts': digest('old'),
      'tables/held.ts': digest('held'),
      'files/gone.txt': gone,
      'files/kept.txt': kept,
    }
    write('.sim/written.json', JSON.stringify({ version: 1, files: recorded }))
    const { 'table:old': _old, 'file:gone.txt': _gone, ...remaining } = before.resources
    request.mockResolvedValue(answer({ base: { ...BASE, resources: remaining } }))

    await apply('--yes', '--allow-delete')

    expect(JSON.parse(readFileSync(join(dir, '.sim/written.json'), 'utf8')).files).toEqual({
      'tables/leads.ts': digest(LEADS),
      'tables/held.ts': digest('held'),
      'files/kept.txt': kept,
    })
  })

  it.each([
    [['E_APPLY_LOCKED'], 6],
    [['E_PLAN_TOO_LARGE'], 7],
    [['E_LIMIT_EXCEEDED'], 7],
    [['E_LIMIT_EXCEEDED', 'E_APPLY_LOCKED', 'E_APPLY_STALE'], 5],
    [['E_DECL_SHAPE'], 1],
  ])('exits on a refused dry run as a commit refusing %j would', async (codes, exitCode) => {
    request.mockResolvedValue(
      answer({
        dryRun: true,
        diagnostics: codes.map((code) => ({ code, severity: 'error', message: code })),
      })
    )

    await apply('--dry-run')

    expect(process.exitCode).toBe(exitCode)
  })

  it('refuses a local blob over the size limit before reading it, and exits 7', async () => {
    write('files/huge.bin', '')
    truncateSync(join(dir, 'files/huge.bin'), WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1)
    request.mockResolvedValue(answer())

    await expect(apply('--yes')).rejects.toMatchObject({
      exitCode: 7,
      message: expect.stringContaining('files/huge.bin'),
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses a directory listing more binary files than one holds before hashing any, exit 7', async () => {
    write('files/a.bin', 'a')
    write('knowledge/kb/docs/b.txt', 'b')
    write('files/c.bin', 'c')
    const limits = { ...WORKSPACE_SOURCE_LIMITS, maxBlobs: 2 }

    await expect(
      readWorkspaceDir(dir, undefined, 'ws_local', { digests: {}, stats: {} }, { limits })
    ).rejects.toMatchObject({ exitCode: 7, message: expect.stringContaining('3 binary files') })
    await expect(
      readWorkspaceDir(dir, ['table'], 'ws_local', { digests: {}, stats: {} }, { limits })
    ).resolves.toMatchObject({ blobs: [] })
  })

  it('warns on stderr that a hidden file under a kind folder is not sent', async () => {
    write('files/.gitkeep', '')
    write('files/.env', 'SECRET=1')
    write('files/notes.md', 'hi')
    request.mockResolvedValue(answer())
    contextMockState.output = 'text'

    await apply('--yes')

    expect(bodies()[0].blobs?.map((blob) => blob.path)).toEqual(['files/notes.md'])
    const warned = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(warned).toContain('files/.env')
    expect(warned).not.toContain('files/.gitkeep')
  })

  it('names each file it does not send in its own warning, in the JSON result and its count', async () => {
    write('files/a:b.txt', 'x')
    write('files/q?.txt', 'x')
    write('workflows/.hidden-wf/workflow.ts', INGEST)
    request.mockResolvedValue(answer())

    await apply('--yes')

    const summary = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    const notSent = summary.diagnostics.filter(
      (finding: { code: string }) => finding.code === 'W_PATH_NOT_SENT'
    )
    expect(notSent.map((finding: { file: string }) => finding.file).sort()).toEqual([
      'files/a:b.txt',
      'files/q?.txt',
      'workflows/.hidden-wf/workflow.ts',
    ])
    expect(notSent.every((finding: { severity: string }) => finding.severity === 'warning')).toBe(
      true
    )
    expect(summary.warnings).toBe(3)
  })

  it('sends secrets.ts and credentials.ts as their kinds, and no other root file', async () => {
    const secrets =
      "// @sim-sdk 1\nexport default defineSecrets({ OPENAI_API_KEY: { description: 'Models' } })\n"
    write('secrets.ts', secrets)
    write('credentials.ts', '// @sim-sdk 1\nexport default defineCredentials({})\n')
    write('notes.ts', 'export {}\n')
    request.mockResolvedValue(answer())

    await apply('--yes')

    const body = request.mock.calls[0][1].body
    expect(body.kinds).toEqual(['secret', 'credential', 'table', 'workflow'])
    expect(body.files['secrets.ts']).toBe(secrets)
    expect(Object.keys(body.files)).toContain('credentials.ts')
    expect(Object.keys(body.files)).not.toContain('notes.ts')
  })

  it('saves what an apply wrote around the changes it held back, and exits 15 (written in part)', async () => {
    request.mockResolvedValue(
      answer({
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'create', held: true },
        ],
        applied: [{ kind: 'table', key: 'leads', action: 'create', id: 'tbl_1' }],
        files: { 'tables/leads.ts': `${LEADS}// stored\n` },
        base: { ...BASE, resources: { 'table:leads': { id: 'tbl_1' } } },
        diagnostics: [
          {
            code: 'E_SECRET_MISSING',
            severity: 'error',
            message: 'workflows/ingest is held back: it reads the secret OPENAI_API_KEY.',
            hint: 'Set it with `sim secrets set OPENAI_API_KEY --scope workspace`.',
            kind: 'workflow',
            key: 'ingest',
          },
        ],
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(15)
    const printed = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(JSON.parse(printed)).toMatchObject({ applied: 1, held: 1, errors: 1 })
    expect(readFileSync(join(dir, 'tables/leads.ts'), 'utf8')).toBe(`${LEADS}// stored\n`)
    const warned = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(warned).toContain('Held back, not written: workflow ingest')
  })

  it('names the webhook URLs of each workflow it deployed, by workflow, block and const', async () => {
    const hookUrl = 'https://sim.example/api/webhooks/trigger/abc'
    const lock = {
      version: 1,
      blocks: { leadin: { id: 'b-hook', parent: null, ident: 'hook', order: 0 } },
      variables: {},
    }
    request.mockImplementation(async (path: string) =>
      path === '/api/v2/workflows/wf_1/deployment'
        ? {
            data: {
              id: 'wf_1',
              isDeployed: true,
              webhooks: [{ blockId: 'b-hook', provider: 'generic', url: hookUrl }],
            },
          }
        : answer({
            plan: [{ kind: 'deployment', key: 'ingest', action: 'create' }],
            applied: [{ kind: 'deployment', key: 'ingest', action: 'create' }],
            files: { 'workflows/ingest/.sim/lock.json': JSON.stringify(lock) },
            base: { ...BASE, resources: { 'workflow:ingest': { id: 'wf_1' } } },
          })
    )

    await apply('--yes')

    const printed = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(JSON.parse(printed)).toMatchObject({
      urls: [{ workflow: 'ingest', block: 'leadin (hook)', url: hookUrl }],
    })
  })

  it('names the webhook URLs of a deployment-only apply by the lock the directory holds', async () => {
    const hookUrl = 'https://sim.example/api/webhooks/trigger/abc'
    const lock = {
      version: 1,
      blocks: { leadin: { id: 'b-hook', parent: null, ident: 'hook', order: 0 } },
      variables: {},
    }
    mkdirSync(join(dir, 'workflows/ingest/.sim'), { recursive: true })
    writeFileSync(join(dir, 'workflows/ingest/.sim/lock.json'), JSON.stringify(lock))
    request.mockImplementation(async (path: string) =>
      path === '/api/v2/workflows/wf_1/deployment'
        ? {
            data: {
              id: 'wf_1',
              isDeployed: true,
              webhooks: [{ blockId: 'b-hook', provider: 'generic', url: hookUrl }],
            },
          }
        : answer({
            plan: [{ kind: 'deployment', key: 'ingest', action: 'update' }],
            applied: [{ kind: 'deployment', key: 'ingest', action: 'update' }],
            files: {},
            base: { ...BASE, resources: { 'workflow:ingest': { id: 'wf_1' } } },
          })
    )

    await apply('--yes')

    const printed = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(JSON.parse(printed)).toMatchObject({
      urls: [{ workflow: 'ingest', block: 'leadin (hook)', url: hookUrl }],
    })
  })

  it('reports webhook URLs it could not read without the terminal escapes the failure carried', async () => {
    request.mockImplementation(async (path: string) => {
      if (path === '/api/v2/workflows/wf_1/deployment') {
        throw new SimApiError('gateway \u001b[2Jcleared', 502)
      }
      return answer({
        plan: [{ kind: 'deployment', key: 'ingest', action: 'update' }],
        applied: [{ kind: 'deployment', key: 'ingest', action: 'update' }],
        base: { ...BASE, resources: { 'workflow:ingest': { id: 'wf_1' } } },
      })
    })

    await apply('--yes')

    const warned = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(warned).toContain('its webhook URLs could not be read (gateway cleared)')
    expect(warned).not.toContain('\u001b')
  })

  it('fails, rather than reports success, when its webhook URL read is cancelled', async () => {
    request.mockImplementation(async (path: string) => {
      if (path === '/api/v2/workflows/wf_1/deployment') {
        throw new SimApiError('Request cancelled.', 0, 'REQUEST_CANCELLED')
      }
      return answer({
        plan: [{ kind: 'deployment', key: 'ingest', action: 'update' }],
        applied: [{ kind: 'deployment', key: 'ingest', action: 'update' }],
        base: { ...BASE, resources: { 'workflow:ingest': { id: 'wf_1' } } },
      })
    })

    await expect(apply('--yes')).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(vi.mocked(console.log)).not.toHaveBeenCalled()
  })

  it('appends the plan and its errors to the GitHub Actions step summary', async () => {
    const summary = join(dir, 'step-summary.md')
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    request.mockResolvedValue(
      answer({
        dryRun: true,
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'update', fields: ['blocks'] },
        ],
        diagnostics: [
          {
            code: 'E_APPLY_UNRESOLVED_REF',
            severity: 'error',
            message: 'Score lead | has no output teir.',
            file: 'workflows/ingest/workflow.ts',
            line: 12,
            kind: 'workflow',
            key: 'ingest',
          },
        ],
      })
    )

    await apply('--dry-run')

    const markdown = readFileSync(summary, 'utf8')
    expect(markdown).toContain('### Sim workspace plan: ws_local')
    expect(markdown).toContain('| + | tables/leads | create | planned |')
    expect(markdown).toContain('| ~ | workflows/ingest (blocks) | update | planned |')
    expect(markdown).toContain(
      '- `E_APPLY_UNRESOLVED_REF` workflows/ingest/workflow.ts:12: Score lead \\| has no output teir.'
    )
    const annotations = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .filter((line) => line.startsWith('::error'))
    expect(annotations).toEqual([
      `::error file=${join(dir, 'workflows/ingest/workflow.ts')},line=12,title=E_APPLY_UNRESOLVED_REF::Score lead | has no output teir.`,
    ])
  })

  it('says what an apply wrote in the step summary, not what it would write', async () => {
    const summary = join(dir, 'step-summary.md')
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    const created = { kind: 'table' as const, key: 'leads', action: 'create' as const }
    request.mockResolvedValue(answer({ plan: [created], applied: [created] }))

    await apply('--yes')

    const markdown = readFileSync(summary, 'utf8')
    expect(markdown).toContain('### Sim workspace apply: ws_local')
    expect(markdown).toContain('1 created, 0 updated, 0 deleted')
  })

  it('exits 1, not 15, when every change it would write was held back and nothing was written', async () => {
    request.mockResolvedValue(
      answer({
        plan: [{ kind: 'workflow', key: 'ingest', action: 'create', held: true }],
        applied: [],
        diagnostics: [
          {
            code: 'E_SECRET_MISSING',
            severity: 'error',
            message: 'workflows/ingest is held back: it reads the secret OPENAI_API_KEY.',
            kind: 'workflow',
            key: 'ingest',
          },
        ],
      })
    )

    await apply('--yes')

    expect(process.exitCode).toBe(1)
  })

  it.each([
    ['writes the rest', [{ kind: 'table', key: 'leads', action: 'create' }], 15],
    ['writes nothing else', [], 1],
  ])(
    'exits a dry run that holds a change back as the apply would: %s',
    async (_case, others, exitCode) => {
      request.mockResolvedValue(
        answer({
          dryRun: true,
          plan: [...others, { kind: 'workflow', key: 'ingest', action: 'create', held: true }],
          diagnostics: [
            {
              code: 'E_SECRET_MISSING',
              severity: 'error',
              message: 'workflows/ingest is held back: it reads the secret OPENAI_API_KEY.',
              kind: 'workflow',
              key: 'ingest',
            },
          ],
        })
      )

      await apply('--dry-run')

      expect(process.exitCode).toBe(exitCode)
    }
  )

  it('exits a dry run as refused when the server says it refuses, though its only error names a held change', async () => {
    request.mockResolvedValue(
      answer({
        dryRun: true,
        refuses: true,
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'ingest', action: 'create', held: true },
        ],
        diagnostics: [
          {
            code: 'E_SECRET_MISSING',
            severity: 'error',
            message: 'workflows/ingest is held back: it reads the secret OPENAI_API_KEY.',
            kind: 'workflow',
            key: 'ingest',
          },
        ],
      })
    )

    await apply('--dry-run')

    expect(process.exitCode).toBe(1)
  })

  it('exits a dry run as refused when a delete breaks a workflow it holds back, for a server without refuses, as the apply refuses it', async () => {
    // E_PLAN_REF_DELETED names the held workflow, but the server records it on the delete (or the
    // plan), which no hold excuses: the apply would refuse, so the dry run cannot exit 15.
    request.mockResolvedValue(
      answer({
        dryRun: true,
        plan: [
          { kind: 'table', key: 'leads', action: 'create' },
          { kind: 'workflow', key: 'parent', action: 'update', held: true },
          { kind: 'workflow', key: 'child', action: 'delete' },
        ],
        diagnostics: [
          {
            code: 'E_SECRET_MISSING',
            severity: 'error',
            message: 'workflows/parent is held back: it reads the secret OPENAI_API_KEY.',
            kind: 'workflow',
            key: 'parent',
          },
          {
            code: 'E_PLAN_REF_DELETED',
            severity: 'error',
            message: 'workflows/parent uses workflow "child", which this apply deletes.',
            kind: 'workflow',
            key: 'parent',
          },
        ],
      })
    )

    await apply('--dry-run', '--allow-delete')

    expect(process.exitCode).toBe(1)
  })

  it('saves the applied answer when the catalog of a workflow it reprinted cannot be fetched, and says its edges are unrecorded', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'sim-workspace-apply-config-'))
    vi.stubEnv('SIM_CONFIG_DIR', configDir)
    cacheCatalogText(
      configDir,
      'ws_local',
      readFileSync(join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'), 'utf8')
    )
    const storedBase = JSON.stringify({
      version: 1,
      workflowId: 'wf_1',
      workspaceId: 'ws_local',
      fingerprint: 'sf1:b',
      catalogHash: 'workflow-own-catalog',
    })
    request.mockImplementation(
      async (path: string, options: { query?: { workflowId?: string } }) => {
        if (path.endsWith('/source/catalog') && options.query?.workflowId) {
          throw new SimApiError('Service unavailable', 503, 'UNAVAILABLE')
        }
        return answer({
          plan: [{ kind: 'workflow', key: 'ingest', action: 'update' }],
          applied: [{ kind: 'workflow', key: 'ingest', action: 'update', id: 'wf_1' }],
          files: {
            'workflows/ingest/workflow.ts': `${INGEST}// stored\n`,
            'workflows/ingest/.sim/base.json': storedBase,
          },
          base: { ...BASE, resources: { 'workflow:ingest': { id: 'wf_1' } } },
        })
      }
    )

    try {
      await apply('--yes')
    } finally {
      vi.unstubAllEnvs()
      rmSync(configDir, { recursive: true, force: true })
    }

    expect(process.exitCode).toBeUndefined()
    expect(readFileSync(join(dir, 'workflows/ingest/workflow.ts'), 'utf8')).toBe(
      `${INGEST}// stored\n`
    )
    expect(readFileSync(join(dir, 'workflows/ingest/.sim/base.json'), 'utf8')).toBe(storedBase)
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).resources).toEqual({
      'workflow:ingest': { id: 'wf_1' },
    })
    expect(existsSync(join(dir, 'workflows/ingest/.sim/stored-edges.json'))).toBe(false)
    const warned = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(warned).toContain('could not fetch the block catalog of workflows/ingest')
  })
})
