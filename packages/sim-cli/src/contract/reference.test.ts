import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  commandReference,
  type ReferenceDocument,
  type ReferenceSchema,
} from '#sim-cli/contract/reference'
import { runEmbeddedCli } from '#sim-cli/embed'
import { V2_OPERATIONS } from '#sim-cli/generated/v2-api'
import { cursorSlot } from '#sim-cli/runtime/request'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** Read the actual producer, including command aliases and generated API documents. */
function inventory(): { path: string[]; shape?: string; body?: string }[] {
  return JSON.parse(
    execFileSync('bun', ['run', 'packages/sim-cli/scripts/print-command-inventory.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  )
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
  it('publishes creation ids and preserves single/batch row choices from the real API', () => {
    const commands = inventory()
    const find = (path: string) => {
      const command = commands.find((entry) => entry.path.join(' ') === path)
      if (!command) throw new Error(`Command missing: ${path}`)
      return command
    }
    expect(find('tables create').shape).toContain('id:string')
    expect(find('workflows create').shape).toContain('blocks:')
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
