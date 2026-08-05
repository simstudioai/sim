/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  RESOURCE_KINDS,
  type ResourceKind,
  shareSource,
  type UnavailableReason,
  workspaceSource,
} from '@/resources'

const REASONS: readonly UnavailableReason[] = ['missing', 'transient']

/** Every kind that can actually construct a share source (seed is not `never`). */
const SHAREABLE_KINDS = ['file', 'table', 'interface'] as const

function makeShareSource(kind: (typeof SHAREABLE_KINDS)[number]) {
  switch (kind) {
    case 'file':
      return shareSource({
        kind: 'file',
        token: 'tok_1',
        grantId: 'mod_1',
        seed: { name: 'notes.md', type: 'text/markdown', size: 12, version: 7 },
      })
    case 'table':
      return shareSource({
        kind: 'table',
        token: 'tok_1',
        grantId: 'mod_2',
        seed: { name: 'Leads', columns: [{ id: 'col_1', name: 'email', type: 'string' }] },
      })
    case 'interface':
      return shareSource({
        kind: 'interface',
        token: 'tok_1',
        grantId: 'mod_3',
        seed: {
          name: 'Support desk',
          layout: { version: 1, grid: { rows: 1, cols: 1 }, modules: [] },
          modules: {},
        },
      })
  }
}

describe('workspaceSource', () => {
  it('carries the workspace address and namespaces the cache by it', () => {
    const source = workspaceSource({
      kind: 'file',
      workspaceId: 'ws_1',
      resourceId: 'file_1',
    })

    expect(source.via).toBe('workspace')
    expect(source.workspaceId).toBe('ws_1')
    expect(source.resourceId).toBe('file_1')
    expect(source.cacheScope).toBe('workspace:ws_1:file:file_1')
  })

  it('gives different resources different cache scopes', () => {
    const a = workspaceSource({ kind: 'file', workspaceId: 'ws_1', resourceId: 'file_1' })
    const b = workspaceSource({ kind: 'file', workspaceId: 'ws_1', resourceId: 'file_2' })
    const c = workspaceSource({ kind: 'table', workspaceId: 'ws_1', resourceId: 'file_1' })

    expect(new Set([a.cacheScope, b.cacheScope, c.cacheScope]).size).toBe(3)
  })

  it('names each unavailable reason distinctly', () => {
    const source = workspaceSource({ kind: 'file', workspaceId: 'ws_1', resourceId: 'file_1' })

    expect(source.unavailableCopy('missing')).toMatch(/deleted or moved/i)
    expect(source.unavailableCopy('transient')).toMatch(/try again/i)
  })

  it('names the resource by kind in its copy', () => {
    const knowledge = workspaceSource({
      kind: 'knowledge',
      workspaceId: 'ws_1',
      resourceId: 'kb_1',
    })
    const schedule = workspaceSource({ kind: 'schedule', workspaceId: 'ws_1', resourceId: 'sch_1' })

    expect(knowledge.unavailableCopy('missing')).toContain('knowledge base')
    expect(schedule.unavailableCopy('missing')).toContain('scheduled task')
  })

  it('resolves a self link to its own workspace route', () => {
    const source = workspaceSource({ kind: 'interface', workspaceId: 'ws_1', resourceId: 'int_1' })

    expect(source.hrefFor({ to: 'self' })).toBe('/workspace/ws_1/interfaces/int_1')
  })

  it('resolves a cross-resource link for every kind', () => {
    const source = workspaceSource({ kind: 'file', workspaceId: 'ws_1', resourceId: 'file_1' })

    expect(source.hrefFor({ to: 'resource', kind: 'file', id: 'file_2' })).toBe(
      '/workspace/ws_1/files/file_2/view'
    )
    expect(source.hrefFor({ to: 'resource', kind: 'table', id: 'tbl_1' })).toBe(
      '/workspace/ws_1/tables/tbl_1'
    )
    expect(source.hrefFor({ to: 'resource', kind: 'knowledge', id: 'kb_1' })).toBe(
      '/workspace/ws_1/knowledge/kb_1'
    )
    expect(source.hrefFor({ to: 'resource', kind: 'log', id: 'exec_1' })).toBe(
      '/workspace/ws_1/logs?executionId=exec_1'
    )
    expect(source.hrefFor({ to: 'resource', kind: 'schedule', id: 'sch_1' })).toBe(
      '/workspace/ws_1/scheduled-tasks?taskId=sch_1'
    )
  })

  it('escapes ids so a hostile id cannot graft extra path or query onto the route', () => {
    const source = workspaceSource({
      kind: 'file',
      workspaceId: 'ws_1',
      resourceId: '../../admin?x=1',
    })

    expect(source.hrefFor({ to: 'self' })).toBe(
      '/workspace/ws_1/files/..%2F..%2Fadmin%3Fx%3D1/view'
    )
  })

  it('returns an href for every kind', () => {
    for (const kind of RESOURCE_KINDS) {
      const source = workspaceSource({ kind, workspaceId: 'ws_1', resourceId: 'id_1' })
      expect(source.hrefFor({ to: 'self' })).toContain('/workspace/ws_1/')
    }
  })
})

describe('shareSource', () => {
  it('carries the token address and never a workspace id', () => {
    const source = makeShareSource('file')

    expect(source.via).toBe('share')
    expect(source.token).toBe('tok_1')
    expect(source.grantId).toBe('mod_1')
    expect('workspaceId' in source).toBe(false)
    expect('resourceId' in source).toBe(false)
    expect(source.workspaceId).toBeUndefined()
    expect(source.resourceId).toBeUndefined()
  })

  it('cannot satisfy a workspace-addressed consumer', () => {
    const source = makeShareSource('file')

    // @ts-expect-error — a share source has no workspace id; the token is not one.
    const addressed: { workspaceId: string } = source

    expect(addressed.workspaceId).toBeUndefined()
  })

  it('keeps the server-resolved seed', () => {
    const source = makeShareSource('file')

    expect(source.seed).toEqual({
      name: 'notes.md',
      type: 'text/markdown',
      size: 12,
      version: 7,
    })
  })

  it('never mentions a workspace or an account in its unavailable copy', () => {
    for (const kind of SHAREABLE_KINDS) {
      const source = makeShareSource(kind)
      for (const reason of REASONS) {
        expect(source.unavailableCopy(reason)).not.toMatch(/workspace|permission|access/i)
      }
    }
  })

  it('still distinguishes a transient failure, which leaks nothing', () => {
    const source = makeShareSource('file')

    expect(source.unavailableCopy('transient')).toMatch(/try again/i)
    expect(source.unavailableCopy('transient')).not.toBe(source.unavailableCopy('missing'))
  })

  it('returns null for every link, so no workspace route can be hand-built', () => {
    for (const kind of SHAREABLE_KINDS) {
      const source = makeShareSource(kind)
      expect(source.hrefFor({ to: 'self' })).toBeNull()
      for (const target of RESOURCE_KINDS) {
        expect(source.hrefFor({ to: 'resource', kind: target, id: 'id_1' })).toBeNull()
      }
    }
  })

  it('separates two grants of one kind under one token', () => {
    const a = shareSource({
      kind: 'file',
      token: 'tok_1',
      grantId: 'mod_a',
      seed: { name: 'a.md', type: 'text/markdown', size: 1, version: 1 },
    })
    const b = shareSource({
      kind: 'file',
      token: 'tok_1',
      grantId: 'mod_b',
      seed: { name: 'b.md', type: 'text/markdown', size: 1, version: 1 },
    })

    expect(a.cacheScope).not.toBe(b.cacheScope)
  })

  it('never collides with a workspace cache scope', () => {
    const share = makeShareSource('file')
    const workspace = workspaceSource({ kind: 'file', workspaceId: 'ws_1', resourceId: 'file_1' })

    expect(share.cacheScope).not.toBe(workspace.cacheScope)
  })

  it('rejects kinds with no public surface at compile time', () => {
    // @ts-expect-error — 'knowledge' seeds `never`: no share source can exist for it.
    const knowledge = shareSource({ kind: 'knowledge', token: 't', grantId: 'g', seed: {} })
    // @ts-expect-error — 'log' seeds `never`.
    const log = shareSource({ kind: 'log', token: 't', grantId: 'g', seed: {} })
    // @ts-expect-error — 'schedule' seeds `never`.
    const schedule = shareSource({ kind: 'schedule', token: 't', grantId: 'g', seed: {} })

    expect([knowledge.via, log.via, schedule.via]).toEqual(['share', 'share', 'share'])
  })
})

describe('RESOURCE_KINDS', () => {
  it('has no organizational or session-scoped entries', () => {
    const kinds: readonly string[] = RESOURCE_KINDS

    expect(kinds).not.toContain('folder')
    expect(kinds).not.toContain('workflow')
  })

  it('is unique', () => {
    const kinds: readonly ResourceKind[] = RESOURCE_KINDS

    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
