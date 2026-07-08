/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import {
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
} from '@/app/workspace/[workspaceId]/settings/components/forks/components/fork-sync/dependent-value'

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
  sourceValue: '',
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

describe('effectiveCopyDependentValue', () => {
  const copyField = (overrides: Partial<ForkDependentReconfig> = {}) =>
    field({
      parentKind: 'knowledge-base',
      parentSourceId: 'kb-src',
      parentContextKey: 'knowledgeBaseId',
      subBlockKey: 'documentSelector',
      selectorKey: 'knowledge.documents',
      title: 'Document',
      ...overrides,
    })

  it('seeds from the raw source reference when nothing is stored (the copy will contain it)', () => {
    const f = copyField({ currentValue: '', sourceValue: 'doc-src' })
    expect(effectiveCopyDependentValue(f, {})).toBe('doc-src')
  })

  it('prefers the stored value over the source reference (a saved re-pick survives reload)', () => {
    const f = copyField({ currentValue: 'doc-saved', sourceValue: 'doc-src' })
    expect(effectiveCopyDependentValue(f, {})).toBe('doc-saved')
  })

  it('an in-session re-pick wins over both', () => {
    const f = copyField({ currentValue: 'doc-saved', sourceValue: 'doc-src' })
    expect(effectiveCopyDependentValue(f, { [dependentKey(f)]: 'doc-picked' })).toBe('doc-picked')
  })

  it('an explicit empty re-pick is respected (a required field then gates as usual)', () => {
    const f = copyField({ currentValue: '', sourceValue: 'doc-src' })
    expect(effectiveCopyDependentValue(f, { [dependentKey(f)]: '' })).toBe('')
  })

  it('is blank when the source never referenced anything and nothing was stored', () => {
    const f = copyField({ currentValue: '', sourceValue: '' })
    expect(effectiveCopyDependentValue(f, {})).toBe('')
  })
})
