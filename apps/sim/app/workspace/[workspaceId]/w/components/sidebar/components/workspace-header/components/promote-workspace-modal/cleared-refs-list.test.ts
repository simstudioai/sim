/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'
import { selectVisibleClearedRefs } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/cleared-refs-list'

type ReferenceRef = Extract<ForkClearedRef, { cause: 'reference' }>
type WorkflowRef = Extract<ForkClearedRef, { cause: 'workflow' }>
type DependentRef = Extract<ForkClearedRef, { cause: 'dependent' }>

const base = {
  targetWorkflowId: 'wf-tgt',
  workflowName: 'Workflow',
  blockId: 'block-1',
  blockLabel: 'Block',
  sourceLabel: 'Source',
}

const referenceRef = (
  kind: ReferenceRef['kind'],
  sourceId: string,
  fieldLabel = 'Field'
): ReferenceRef => ({ ...base, fieldLabel, cause: 'reference', kind, sourceId })

const workflowRef = (sourceId: string, fieldLabel = 'Workflow'): WorkflowRef => ({
  ...base,
  fieldLabel,
  cause: 'workflow',
  kind: 'workflow',
  sourceId,
})

const dependentRef = (
  parentKind: DependentRef['parentKind'],
  parentSourceId: string,
  fieldLabel = 'Field'
): DependentRef => ({
  ...base,
  fieldLabel,
  cause: 'dependent',
  kind: parentKind,
  sourceId: parentSourceId,
  parentKind,
  parentSourceId,
})

// The modal's predicate is `mapped || copied`; here we model each disposition as a resolved key so
// the document-under-KB case is exercised for both a copied parent and a mapped parent.
const resolvedKeys = (...keys: string[]) => {
  const set = new Set(keys)
  return (kind: string, sourceId: string) => set.has(`${kind}:${sourceId}`)
}

const documentDependent = dependentRef('knowledge-base', 'kb-1', 'Document')

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
    const labelDependent = dependentRef('credential', 'cred-1', 'Label')
    // A mapped credential remaps to a different account, so the account-scoped label is cleared
    // regardless - the entry must stay even though the parent is "resolved".
    expect(selectVisibleClearedRefs([labelDependent], resolvedKeys('credential:cred-1'))).toEqual([
      labelDependent,
    ])
    expect(selectVisibleClearedRefs([labelDependent], resolvedKeys())).toEqual([labelDependent])
  })

  it('keeps a table-anchored dependent even when the table is copied/mapped (column still clears)', () => {
    const columnDependent = dependentRef('table', 'tbl-1', 'Column')
    expect(selectVisibleClearedRefs([columnDependent], resolvedKeys('table:tbl-1'))).toEqual([
      columnDependent,
    ])
  })

  it('drops the parent KB reference AND its child document together when the KB is resolved', () => {
    const kbReference = referenceRef('knowledge-base', 'kb-1', 'Knowledge Base')
    expect(
      selectVisibleClearedRefs(
        [kbReference, documentDependent],
        resolvedKeys('knowledge-base:kb-1')
      )
    ).toEqual([])
  })

  it('applies the same predicate to a reference entry (drops resolved, keeps unresolved)', () => {
    const credentialReference = referenceRef('credential', 'cred-1')
    expect(
      selectVisibleClearedRefs([credentialReference], resolvedKeys('credential:cred-1'))
    ).toEqual([])
    expect(selectVisibleClearedRefs([credentialReference], resolvedKeys())).toEqual([
      credentialReference,
    ])
  })

  it('always keeps a workflow reference (it cannot be resolved in the modal)', () => {
    const workflowReference = workflowRef('wf-other')
    expect(
      selectVisibleClearedRefs([workflowReference], resolvedKeys('workflow:wf-other'))
    ).toEqual([workflowReference])
  })
})
