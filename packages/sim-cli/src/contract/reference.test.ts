import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import {
  commandReference,
  type ReferenceDocument,
  type ReferenceSchema,
} from '#sim-cli/contract/reference'
import { runEmbeddedCli } from '#sim-cli/embed'
import { V2_OPERATIONS } from '#sim-cli/generated/v2-api'
import { buildProgram, UNPUBLISHED_GROUPS } from '#sim-cli/program'
import { operationOf } from '#sim-cli/runtime/called-operations'
import { cursorSlot } from '#sim-cli/runtime/request'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

interface InventoryEntry {
  path: string[]
  shape?: string
  body?: string
  mothershipUnavailable?: true
  unpublished?: true
  pathAliases?: string[][]
  renamedFrom?: string[][]
}

let produced: InventoryEntry[] | undefined

/** The requests the embedded CLI sends for `argv`, answered with one generic success. */
async function requests(argv: string[]) {
  const seen: string[] = []
  const result = await runEmbeddedCli(['--output', 'json', ...argv], {
    endpoint: 'https://sim.internal.test',
    apiKey: 'test-key',
    workspaceId: 'a2e3ab27-2f9d-4b8a-a2f2-3c47a1b0c9d1',
    transport: async (input, init) => {
      seen.push(`${init?.method ?? 'GET'} ${String(input)} ${String(init?.body ?? '')}`)
      return new Response(JSON.stringify({ data: { id: 'folder-1', count: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { exitCode: result.exitCode, stderr: result.stderr, seen }
}

/** Read the actual producer, including command aliases and generated API documents. */
function inventory(): InventoryEntry[] {
  produced ??= JSON.parse(
    execFileSync('bun', ['run', 'packages/sim-cli/scripts/print-command-inventory.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  ) as InventoryEntry[]
  return produced
}

function document(schema: ReferenceSchema): ReferenceDocument {
  return {
    paths: {
      '/items/{id}': {
        post: {
          responses: { '201': { content: { 'application/json': { schema } } } },
        },
      },
    },
  }
}

const operation = { method: 'POST', path: '/items/[id]' }

describe('CLI reference producer', () => {
  it('lists unpublished groups for the worker, marked, while --help keeps hiding them', () => {
    const commands = inventory()
    for (const group of UNPUBLISHED_GROUPS) {
      const members = commands.filter((entry) => entry.path[0] === group)
      expect(members.length).toBeGreaterThan(0)
      expect(members.every((entry) => entry.unpublished === true)).toBe(true)
      expect(buildProgram().helpInformation()).not.toMatch(new RegExp(`^\\s+${group}\\b`, 'm'))
    }
    expect(
      commands.filter((entry) => entry.unpublished && !UNPUBLISHED_GROUPS.has(entry.path[0] ?? ''))
    ).toEqual([])
  })

  it('publishes creation ids and preserves single/batch row choices from the real API', () => {
    const commands = inventory()
    const find = (path: string) => {
      const command = commands.find((entry) => entry.path.join(' ') === path)
      if (!command) throw new Error(`Command missing: ${path}`)
      return command
    }
    expect(find('tables create').shape).toContain('id:string')
    expect(find('workflows create').shape).toContain('blocks:')
    expect(find('credentials create').shape).toContain('id:string')
    const rows = find('tables rows create')
    expect(rows.body).toBe('{rows:object[]}|{data:object}')
    expect(rows.shape).toContain('id:string')
    expect(rows.shape).toContain('|')
    expect(rows.shape).toContain('rows:')
    expect(find('workflows operations apply').body).toMatch(/^\{operations:\(/)
    expect(find('workflows operations apply').body).toContain(')[]')
    expect(find('workflows operations apply').body).toContain('&')
    expect(find('tables rows query').body).toContain('filter?:')
    expect(find('tables rows query').body).not.toContain('predicate?:')
    expect(find('workflows list').shape).toContain('{data:')
    expect(find('workflows list').shape).toContain('nextCursor:string|null')
    expect(find('files get').shape).toBeUndefined()
    expect(find('files share get').shape).toContain('|{data:null}')
  })

  it('describes each command by the operation it runs, not one whose route derives the same name', () => {
    // `undeployWorkflow`, `deleteTableRows` and `deleteKnowledgeTagDefinitions` derive the
    // path their sibling owns; a lookup by path described the sibling with their output.
    const commands = inventory()
    const shape = (path: string) => commands.find((entry) => entry.path.join(' ') === path)?.shape
    expect(shape('workflows deploy')).toContain('lint:')
    expect(shape('workflows deploy')).not.toContain('archivedMcpTools')
    expect(shape('workflows undeploy')).toContain('archivedMcpTools')
    expect(shape('tables rows delete')).toContain('deleted:true')
    expect(shape('tables rows batch-delete')).toContain('deletedCount:')
    expect(shape('knowledge tags delete')).toContain('tagSlot:')
    expect(shape('knowledge tags cleanup')).toContain('unused:')
    expect(shape('workflows mv')).toContain('folderPath:')
  })

  it('marks every command that calls a route Mothership is refused', () => {
    const commands = inventory()
    const flag = (path: string) =>
      commands.find((entry) => entry.path.join(' ') === path)?.mothershipUnavailable
    expect(flag('meta status')).toBe(true)
    expect(flag('whoami')).toBe(true)
    expect(flag('profiles add')).toBe(true)
    expect(flag('files versions download')).toBe(true)
    expect(flag('chat')).toBe(true)
    expect(flag('workflows run')).toBeUndefined()
    expect(flag('workspaces get')).toBeUndefined()
    expect(flag('workspaces invitations create')).toBeUndefined()
    expect(flag('files get')).toBeUndefined()
  })

  it('publishes the aliases of each path segment, which the real CLI runs as the command', async () => {
    const commands = inventory()
    const aliasesOf = (path: string) =>
      commands.find((entry) => entry.path.join(' ') === path)?.pathAliases
    expect(aliasesOf('files move')).toEqual([['file'], ['mv']])
    expect(aliasesOf('knowledge folders list')).toEqual([['kb'], [], ['ls']])
    expect(aliasesOf('workflows deploy')).toEqual([['workflow'], []])
    expect(aliasesOf('blocks get')).toBeUndefined()

    const canonical = await requests(['files', 'move', '--file-ids', 'f1', '--to', 'folder-1'])
    expect(canonical.exitCode, canonical.stderr).toBe(0)
    expect(canonical.seen.length).toBeGreaterThan(0)
    expect(await requests(['file', 'mv', '--file-ids', 'f1', '--to', 'folder-1'])).toEqual(
      canonical
    )
  })

  it('publishes each renamed path on the command the real CLI still runs it as', async () => {
    const commands = inventory()
    const renamed = commands.flatMap((entry) =>
      (entry.renamedFrom ?? []).map((from) => ({ from, to: entry.path }))
    )
    expect(renamed.map(({ from }) => from.join(' ')).sort()).toEqual([
      'files restore create',
      'tables columns run',
      'tables count create',
      'tables rows find',
      'workflows deployment list',
    ])
    const program = buildProgram()
    const resolve = (path: readonly string[]) =>
      path.reduce<Command | undefined>(
        (node, name) =>
          node?.commands.find((child) => child.name() === name || child.aliases().includes(name)),
        program
      )
    for (const { from, to } of renamed) {
      const old = resolve(from)
      expect(old, from.join(' ')).toBeDefined()
      expect(old && operationOf(old), from.join(' ')).toBe(operationOf(resolve(to) ?? program))
    }

    const current = await requests(['tables', 'rows', 'count', 'table-1'])
    expect(current.exitCode, current.stderr).toBe(0)
    const retired = await requests(['tables', 'count', 'create', 'table-1'])
    expect(retired.exitCode, retired.stderr).toBe(0)
    expect(retired.seen).toEqual(current.seen)
  })

  it('the real CLI accepts both row bodies and prints their distinct 201 payloads', async () => {
    const identity = {
      endpoint: 'https://sim.internal.test',
      apiKey: 'test-key',
      workspaceId: 'a2e3ab27-2f9d-4b8a-a2f2-3c47a1b0c9d1',
    }
    const row = { id: 'row-1', data: { amount: 2 } }
    for (const [flag, body, payload] of [
      ['--data', { data: row.data }, row],
      ['--rows', { rows: [row.data] }, { rows: [row], insertedCount: 1 }],
    ] as const) {
      const seen: unknown[] = []
      const result = await runEmbeddedCli(
        [
          '--output',
          'json',
          'tables',
          'rows',
          'create',
          'table-1',
          flag,
          JSON.stringify(flag === '--data' ? row.data : [row.data]),
        ],
        {
          ...identity,
          transport: async (_input, init) => {
            seen.push(JSON.parse(String(init?.body)))
            return new Response(JSON.stringify({ data: payload }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            })
          },
        }
      )
      expect(result.exitCode, result.stderr).toBe(0)
      expect(seen).toEqual([{ workspaceId: identity.workspaceId, ...body }])
      expect(JSON.parse(result.stdout)).toEqual(payload)
    }
  })
})

describe('paged stdout reference parity', () => {
  const pageSchema: ReferenceSchema = {
    type: 'object',
    required: ['data', 'nextCursor'],
    properties: {
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
      },
      nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      truncated: { type: 'boolean' },
      toolNamesTruncated: { type: 'boolean' },
      scope: { type: 'string' },
      notTruncated: { type: 'boolean' },
      isNeverTruncated: { type: 'boolean' },
      nonBooleanTruncated: { type: 'string' },
    },
  }

  it('uses runtime cursor classification and exposes only fields rendered to stdout', () => {
    expect(cursorSlot(V2_OPERATIONS.listWorkflows)).not.toBeNull()
    const reference = commandReference(
      [document(pageSchema)],
      operation,
      new Map(),
      cursorSlot(V2_OPERATIONS.listWorkflows) !== null
    )
    expect(reference.shape).toBe(
      '{data:{id,name}[],nextCursor:string|null,truncated?:boolean,toolNamesTruncated?:boolean}'
    )
    expect(commandReference([document(pageSchema)], operation, new Map()).shape).toBe(
      '{id?:string,name?:string}[]'
    )
    const variants = {
      oneOf: [
        pageSchema,
        {
          ...pageSchema,
          properties: {
            ...pageSchema.properties,
            data: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
    }
    expect(commandReference([document(variants)], operation, new Map(), true).shape).toContain(
      '|{data:string[],nextCursor:string|null'
    )
  })
})
