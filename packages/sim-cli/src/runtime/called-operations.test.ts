import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { V2OperationName } from '../generated/v2-api'
import { SimClient } from '../http/client'
import { OperationClient } from './called-operations'

interface SentRequest {
  method: string
  url: string
}

/** A real client whose transport records what reaches the wire. */
function wireClient(operations: V2OperationName[], sent: SentRequest[]) {
  const http = new SimClient({
    name: 'fixture',
    authProfile: 'fixture',
    endpoint: 'https://sim.example',
    apiKey: 'fixture-key',
    oauth: null,
    workspaceId: 'ws-1',
    output: 'json',
    sources: { endpoint: 'flag', credential: 'flag', workspaceId: 'flag', output: 'flag' },
    transport: async (input, init) => {
      sent.push({ method: init?.method ?? 'GET', url: String(input) })
      return new Response(JSON.stringify({ data: {} }), {
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return new OperationClient(http, new Set(operations), 'sim secrets set')
}

describe('a declared operation client', () => {
  /**
   * The generated handler reaches its client through the command, so its calls are typed
   * as any operation. A call outside the declaration has to be refused before it goes
   * out, or the inventory would describe a command that calls more than it says.
   */
  it('refuses an operation its command did not declare, before any request', async () => {
    const sent: SentRequest[] = []

    await expect(wireClient(['setSecret'], sent).request('listWorkspaces')).rejects.toThrow(
      '"sim secrets set" calls listWorkspaces, which it does not declare'
    )
    expect(sent).toEqual([])
  })

  it('sends a declared operation to its route with its method, encoding each id', async () => {
    const sent: SentRequest[] = []

    await wireClient(['setSecret'], sent).request('setSecret', {
      params: { name: 'a/b?c' },
      body: { value: 'x' },
    })

    expect(sent).toEqual([{ method: 'PUT', url: 'https://sim.example/api/v2/secrets/a%2Fb%3Fc' }])
  })
})

/**
 * The inventory is only as true as the declarations, and a declaration only binds a
 * command that cannot reach the API another way. A raw client is the one way around
 * it, so building one stays confined to the places that wrap it in a declaration.
 */
it('leaves no command a raw client to call the API with', () => {
  const root = join(import.meta.dirname, '..')
  const construct = 'new SimClient('
  const connectRaw = 'clientFrom('
  const allowed: Record<string, string[]> = {
    'context.ts': [construct, connectRaw],
    'runtime/called-operations.ts': [connectRaw],
    // The public embed API hands server code a client of its own; no command uses it.
    'embed.ts': [construct],
    // Rebuilt for cleanup through `over`, which keeps the session's declaration.
    'transfer/upload-session.ts': [construct],
  }
  const raw: string[] = []
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
    const file = join(entry.parentPath, entry.name)
    const name = relative(root, file)
    if (name.startsWith('test/') || name.startsWith('generated/')) continue
    const text = readFileSync(file, 'utf8')
    for (const call of [construct, connectRaw]) {
      if (text.includes(call) && !allowed[name]?.includes(call)) raw.push(`${name}: ${call}`)
    }
  }
  expect(raw).toEqual([])
})
