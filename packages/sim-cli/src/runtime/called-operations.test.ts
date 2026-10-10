import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OperationClient } from './called-operations'

describe('a declared operation client', () => {
  /**
   * The generated handler reaches its client through the command, so its calls are typed
   * as any operation. A call outside the declaration has to be refused before it goes
   * out, or the inventory would describe a command that calls more than it says.
   */
  it('refuses an operation its command did not declare, before any request', async () => {
    const request = vi.fn()
    const client = new OperationClient(
      { request, requestRaw: vi.fn(), requireWorkspace: vi.fn() },
      new Set(['getMeta']),
      'sim meta status'
    )

    await expect(client.request('listWorkspaces')).rejects.toThrow(
      '"sim meta status" calls listWorkspaces, which it does not declare'
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('addresses a declared operation by its route and method, encoding each id', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} })
    const client = new OperationClient(
      { request, requestRaw: vi.fn(), requireWorkspace: vi.fn() },
      new Set(['setSecret']),
      'sim secrets set'
    )

    await client.request('setSecret', { params: { name: 'a/b?c' }, body: { value: 'x' } })

    expect(request).toHaveBeenCalledWith('/api/v2/secrets/a%2Fb%3Fc', {
      method: 'PUT',
      body: { value: 'x' },
    })
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
