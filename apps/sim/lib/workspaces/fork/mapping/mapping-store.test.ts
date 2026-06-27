/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildForkResolver, type ForkMappingRow } from '@/lib/workspaces/fork/mapping/mapping-store'

const credentialRow: ForkMappingRow = {
  id: 'm1',
  childWorkspaceId: 'ws-child',
  resourceType: 'oauth_credential',
  parentResourceId: 'cred-parent',
  childResourceId: 'cred-child',
}

describe('buildForkResolver', () => {
  it('resolves source->target for a pull (source is parent)', () => {
    const resolve = buildForkResolver([credentialRow], { sourceIsParent: true })
    expect(resolve('credential', 'cred-parent')).toBe('cred-child')
  })

  it('resolves source->target for a push (source is child)', () => {
    const resolve = buildForkResolver([credentialRow], { sourceIsParent: false })
    expect(resolve('credential', 'cred-child')).toBe('cred-parent')
  })

  it('skips unmapped rows (null childResourceId)', () => {
    const resolve = buildForkResolver([{ ...credentialRow, childResourceId: null }], {
      sourceIsParent: true,
    })
    expect(resolve('credential', 'cred-parent')).toBeNull()
  })

  it('drops a mapped target that no longer exists in the target workspace', () => {
    const resolve = buildForkResolver([credentialRow], {
      sourceIsParent: true,
      // target cred-child was deleted after the mapping was saved
      validTargetIdsByKind: { credential: new Set<string>() },
    })
    expect(resolve('credential', 'cred-parent')).toBeNull()
  })

  it('keeps a mapped target that still exists in the target workspace', () => {
    const resolve = buildForkResolver([credentialRow], {
      sourceIsParent: true,
      validTargetIdsByKind: { credential: new Set(['cred-child']) },
    })
    expect(resolve('credential', 'cred-parent')).toBe('cred-child')
  })

  it('does not existence-check kinds absent from validTargetIdsByKind', () => {
    const resolve = buildForkResolver([credentialRow], {
      sourceIsParent: true,
      validTargetIdsByKind: { table: new Set<string>() },
    })
    expect(resolve('credential', 'cred-parent')).toBe('cred-child')
  })

  it('falls back to identity for a workspace env key present in the target', () => {
    const resolve = buildForkResolver([], {
      sourceIsParent: true,
      sourceEnvKeys: new Set(['API_KEY']),
      targetEnvKeys: new Set(['API_KEY']),
    })
    expect(resolve('env-var', 'API_KEY')).toBe('API_KEY')
  })

  it('leaves a personal (non-source-workspace) env key as-is', () => {
    const resolve = buildForkResolver([], {
      sourceIsParent: true,
      sourceEnvKeys: new Set(['WORKSPACE_KEY']),
      targetEnvKeys: new Set(),
    })
    expect(resolve('env-var', 'PERSONAL_KEY')).toBe('PERSONAL_KEY')
  })
})
