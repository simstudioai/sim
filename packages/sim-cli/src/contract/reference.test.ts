/** @vitest-environment node */
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

  it('extracts all successful JSON variants but excludes errors and empty responses', () => {
    const schema: ReferenceSchema = { type: 'object', properties: { data: { type: 'string' } } }
    const doc = document(schema)
    const responses = doc.paths['/items/{id}']!.post!.responses!
    responses['202'] = { content: { 'application/json': { schema: { type: 'integer' } } } }
    responses['204'] = {}
    responses['400'] = { content: { 'application/json': { schema: { const: 'error' } } } }
    expect(commandReference([doc], operation, new Map())).toEqual({ shape: 'string|integer' })
  })

  it('keeps arrays of alternatives grouped, nullable values, and exactly one data envelope', () => {
    const schema: ReferenceSchema = {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
            value: { type: 'string', nullable: true },
          },
        },
      },
    }
    expect(commandReference([document(schema)], operation, new Map()).shape).toBe(
      '{data:(string|integer)[],value?:string|null}'
    )
  })

  it('resolves shared and recursive schema definitions and fails on broken references', () => {
    const doc = document({ $ref: '#/components/schemas/Envelope' })
    doc.components = {
      schemas: {
        Envelope: { properties: { data: { $ref: '#/components/schemas/Node' } } },
        Node: {
          type: 'object',
          required: ['children'],
          properties: {
            children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
    }
    expect(commandReference([doc], operation, new Map()).shape).toBe('{children:Node[]}')
    doc.components.schemas!.Node = { $ref: '#/components/schemas/Missing' }
    expect(() => commandReference([doc], operation, new Map())).toThrow('Unresolved reference')
    doc.components.schemas!.Node = { $ref: '#/components/schemas/Node' }
    expect(() => commandReference([doc], operation, new Map())).toThrow('Circular schema alias')
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

  it('an absent file share retains the data envelope in real CLI stdout', async () => {
    const result = await runEmbeddedCli(['--output', 'json', 'files', 'share', 'get', 'file-1'], {
      endpoint: 'https://sim.internal.test',
      apiKey: 'test-key',
      workspaceId: 'workspace-1',
      transport: async () =>
        new Response(JSON.stringify({ data: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ data: null })
    const schema: ReferenceSchema = {
      properties: {
        data: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
      },
      required: ['data'],
    }
    expect(commandReference([document(schema)], operation, new Map()).shape).toBe(
      'string|{data:null}'
    )
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

  it.each(['0', '1'])(
    'matches embedded list stdout at limit %s and retains clipping across pages',
    async (limit) => {
      const first = { id: 'workflow-1', name: 'First', truncated: true }
      const second = { id: 'workflow-2', name: 'Second' }
      let requests = 0
      const result = await runEmbeddedCli(
        ['--output', 'json', 'workflows', 'list', '--limit', limit],
        {
          endpoint: 'https://sim.internal.test',
          apiKey: 'test-key',
          workspaceId: 'a2e3ab27-2f9d-4b8a-a2f2-3c47a1b0c9d1',
          transport: async (input) => {
            requests++
            const url = new URL(String(input))
            const later = url.searchParams.get('cursor') === 'next'
            return Response.json({
              data: later ? [second] : [first],
              nextCursor: later ? null : 'next',
              truncated: false,
              toolNamesTruncated: !later,
              scope: 'must not appear on stdout',
              notTruncated: true,
              isNeverTruncated: true,
              nonBooleanTruncated: 'not a boolean',
            })
          },
        }
      )
      expect(result.exitCode, result.stderr).toBe(0)
      expect(requests).toBe(limit === '0' ? 2 : 1)
      const stdout = JSON.parse(result.stdout)
      expect(stdout).toEqual({
        data: limit === '0' ? [first, second] : [first],
        nextCursor: limit === '0' ? null : 'next',
        truncated: false,
        toolNamesTruncated: true,
      })
      const shape = commandReference([document(pageSchema)], operation, new Map(), true).shape!
      for (const key of Object.keys(stdout))
        expect(shape).toMatch(new RegExp(`(?:\\{|,)${key}\\??:`))
      for (const hidden of ['scope', 'notTruncated', 'isNeverTruncated', 'nonBooleanTruncated']) {
        expect(shape).not.toContain(`${hidden}:`)
        expect(shape).not.toContain(`${hidden}?:`)
      }
    }
  )
})
