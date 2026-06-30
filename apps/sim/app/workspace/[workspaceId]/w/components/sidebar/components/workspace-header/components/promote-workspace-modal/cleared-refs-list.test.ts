/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'
import { selectVisibleClearedRefs } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/cleared-refs-list'

const ref = (overrides: Partial<ForkClearedRef>): ForkClearedRef => ({
  targetWorkflowId: 'wf-tgt',
  workflowName: 'Workflow',
  blockId: 'block-1',
  blockLabel: 'Block',
  fieldLabel: 'Field',
  kind: 'credential',
  sourceId: 'src-1',
  sourceLabel: 'Source',
  cause: 'reference',
  parentKind: null,
  parentSourceId: null,
  ...overrides,
})

// The modal's predicate is `mapped || copied`; here we model each disposition separately so the
// document-under-KB case is exercised for BOTH a copied parent and a mapped parent.
const resolvedKeys = (...keys: string[]) => {
  const set = new Set(keys)
  return (kind: string, sourceId: string) => set.has(`${kind}:${sourceId}`)
}

const documentDependent = ref({
  cause: 'dependent',
  fieldLabel: 'Document',
  kind: 'knowledge-base',
  sourceId: 'kb-1',
  parentKind: 'knowledge-base',
  parentSourceId: 'kb-1',
})

describe('selectVisibleClearedRefs', () => {
  it('drops a document dependent when its parent KB is selected for copy', () => {
    expect(
      selectVisibleClearedRefs([documentDependent], resolvedKeys('knowledge-base:kb-1'))
    ).toEqual([])
  })

  it('drops a document dependent when its parent KB is mapped', () => {
    // Map vs copy both resolve the parent through the same predicate; modeled identically here.
    expect(
      selectVisibleClearedRefs([documentDependent], resolvedKeys('knowledge-base:kb-1'))
    ).toEqual([])
  })

  it('keeps a document dependent while its parent KB is neither mapped nor copied', () => {
    expect(selectVisibleClearedRefs([documentDependent], resolvedKeys())).toEqual([
      documentDependent,
    ])
  })

  it('keeps a credential-anchored dependent even when the credential is mapped (label still clears)', () => {
    const labelDependent = ref({
      cause: 'dependent',
      fieldLabel: 'Label',
      kind: 'credential',
      sourceId: 'cred-1',
      parentKind: 'credential',
      parentSourceId: 'cred-1',
    })
    // A mapped credential remaps to a different account, so the account-scoped label is cleared
    // regardless - the entry must stay even though the parent is "resolved".
    expect(selectVisibleClearedRefs([labelDependent], resolvedKeys('credential:cred-1'))).toEqual([
      labelDependent,
    ])
    expect(selectVisibleClearedRefs([labelDependent], resolvedKeys())).toEqual([labelDependent])
  })

  it('keeps a table-anchored dependent even when the table is copied/mapped (column still clears)', () => {
    const columnDependent = ref({
      cause: 'dependent',
      fieldLabel: 'Column',
      kind: 'table',
      sourceId: 'tbl-1',
      parentKind: 'table',
      parentSourceId: 'tbl-1',
    })
    expect(selectVisibleClearedRefs([columnDependent], resolvedKeys('table:tbl-1'))).toEqual([
      columnDependent,
    ])
  })

  it('drops the parent KB reference AND its child document together when the KB is resolved', () => {
    const kbReference = ref({
      cause: 'reference',
      fieldLabel: 'Knowledge Base',
      kind: 'knowledge-base',
      sourceId: 'kb-1',
    })
    expect(
      selectVisibleClearedRefs(
        [kbReference, documentDependent],
        resolvedKeys('knowledge-base:kb-1')
      )
    ).toEqual([])
  })

  it('applies the same predicate to a reference entry (drops resolved, keeps unresolved)', () => {
    const credentialReference = ref({ cause: 'reference', kind: 'credential', sourceId: 'cred-1' })
    expect(
      selectVisibleClearedRefs([credentialReference], resolvedKeys('credential:cred-1'))
    ).toEqual([])
    expect(selectVisibleClearedRefs([credentialReference], resolvedKeys())).toEqual([
      credentialReference,
    ])
  })

  it('always keeps a workflow reference (it cannot be resolved in the modal)', () => {
    const workflowReference = ref({ cause: 'workflow', kind: 'workflow', sourceId: 'wf-other' })
    expect(
      selectVisibleClearedRefs([workflowReference], resolvedKeys('workflow:wf-other'))
    ).toEqual([workflowReference])
  })

  it('keeps a dependent missing its parent identity (defensive)', () => {
    const orphanDependent = ref({ cause: 'dependent', parentKind: null, parentSourceId: null })
    expect(selectVisibleClearedRefs([orphanDependent], resolvedKeys())).toEqual([orphanDependent])
  })
})
