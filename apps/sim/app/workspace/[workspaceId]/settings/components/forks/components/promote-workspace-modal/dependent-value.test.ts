/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import {
  dependentKey,
  effectiveDependentValue,
} from '@/app/workspace/[workspaceId]/settings/components/forks/components/promote-workspace-modal/dependent-value'

const field = (overrides: Partial<ForkDependentReconfig> = {}): ForkDependentReconfig => ({
  parentKind: 'credential',
  parentSourceId: 'cred-1',
  parentContextKey: 'oauthCredential',
  targetWorkflowId: 'wf-1',
  targetBlockId: 'blk-1',
  blockName: 'Gmail',
  subBlockKey: 'folder',
  selectorKey: 'gmail.labels',
  title: 'Label',
  currentValue: 'INBOX',
  required: false,
  consumesContextKeys: [],
  context: {},
  ...overrides,
})

describe('dependentKey', () => {
  it('keys by target workflow + block + subblock', () => {
    expect(
      dependentKey(field({ targetWorkflowId: 'w', targetBlockId: 'b', subBlockKey: 's' }))
    ).toBe('w:b:s')
  })
})

describe('effectiveDependentValue', () => {
  it('returns the in-session re-pick when present', () => {
    const f = field()
    expect(effectiveDependentValue(f, { [dependentKey(f)]: 'Label_42' }, false)).toBe('Label_42')
  })

  it('returns the stored currentValue when no re-pick and the parent is unchanged', () => {
    expect(effectiveDependentValue(field({ currentValue: 'INBOX' }), {}, false)).toBe('INBOX')
  })

  it('returns blank when the parent changed (the stored value no longer resolves)', () => {
    expect(effectiveDependentValue(field({ currentValue: 'INBOX' }), {}, true)).toBe('')
  })

  it('an in-session re-pick wins even when the parent changed', () => {
    const f = field({ currentValue: 'INBOX' })
    expect(effectiveDependentValue(f, { [dependentKey(f)]: 'Label_99' }, true)).toBe('Label_99')
  })

  it('an explicit empty re-pick is respected (not treated as absent)', () => {
    const f = field({ currentValue: 'INBOX' })
    expect(effectiveDependentValue(f, { [dependentKey(f)]: '' }, false)).toBe('')
  })
})
