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
  it('resolves source->target for a push (source is child)', () => {
    const resolve = buildForkResolver([credentialRow], { sourceIsParent: false })
    expect(resolve('credential', 'cred-child')).toBe('cred-parent')
  })

  it('drops a mapped target that no longer exists in the target workspace', () => {
    const resolve = buildForkResolver([credentialRow], {
      sourceIsParent: true,
      // target cred-child was deleted after the mapping was saved
      validTargetIdsByKind: { credential: new Set<string>() },
    })
    expect(resolve('credential', 'cred-parent')).toBeNull()
  })

  it('resolves file-folder mappings by canonical path', () => {
    const resolve = buildForkResolver(
      [
        {
          ...credentialRow,
          resourceType: 'file_folder',
          parentResourceId: '/Reports',
          childResourceId: '/Production Reports',
        },
      ],
      { sourceIsParent: true }
    )

    expect(resolve('file-folder', '/Reports')).toBe('/Production Reports')
  })

  it('falls back to identity for a workspace env key present in the target', () => {
    const resolve = buildForkResolver([], {
      sourceIsParent: true,
      sourceEnvKeys: new Set(['API_KEY']),
      targetEnvKeys: new Set(['API_KEY']),
    })
    expect(resolve('env-var', 'API_KEY')).toBe('API_KEY')
  })
})
