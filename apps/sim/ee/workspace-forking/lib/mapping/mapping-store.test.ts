/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildForkResolver,
  type ForkMappingRow,
  type ForkMappingUpsert,
  orientCopiedResourceMappings,
} from '@/ee/workspace-forking/lib/mapping/mapping-store'

const credentialRow: ForkMappingRow = {
  id: 'm1',
  childWorkspaceId: 'ws-child',
  resourceType: 'oauth_credential',
  parentResourceId: 'cred-parent',
  childResourceId: 'cred-child',
}

const copiedEntry: ForkMappingUpsert = {
  resourceType: 'knowledge_document',
  parentResourceId: 'runtime-source-doc',
  childResourceId: 'runtime-target-doc',
}

describe('orientCopiedResourceMappings', () => {
  it('keeps fork/pull source-parent mappings in canonical orientation', () => {
    expect(orientCopiedResourceMappings(true, [copiedEntry])).toEqual({
      entries: [copiedEntry],
      deleteKeys: [],
    })
  })

  it('swaps push source-child mappings and removes the prior row keyed by that child', () => {
    expect(orientCopiedResourceMappings(false, [copiedEntry])).toEqual({
      entries: [
        {
          resourceType: 'knowledge_document',
          parentResourceId: 'runtime-target-doc',
          childResourceId: 'runtime-source-doc',
        },
      ],
      deleteKeys: [{ resourceType: 'knowledge_document', childResourceId: 'runtime-source-doc' }],
    })
  })

  it('does not produce a push mapping for an unmapped null target', () => {
    expect(
      orientCopiedResourceMappings(false, [{ ...copiedEntry, childResourceId: null }])
    ).toEqual({ entries: [], deleteKeys: [] })
  })
})

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
