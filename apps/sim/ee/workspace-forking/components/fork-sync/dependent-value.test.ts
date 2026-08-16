/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import {
  applyDependentRepick,
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
  getActionableDependentFields,
  isDependentConfigurationActionable,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'

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

describe('applyDependentRepick', () => {
  it('clears direct and transitive descendants without touching unrelated fields', () => {
    const site = field({
      subBlockKey: 'siteId',
      currentValue: 'site-old',
      providesContextKey: 'siteId',
    })
    const drive = field({
      subBlockKey: 'driveId',
      currentValue: 'drive-old',
      providesContextKey: 'driveId',
      consumesContextKeys: ['siteId'],
    })
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      currentValue: 'spreadsheet-old',
      providesContextKey: 'spreadsheetId',
      consumesContextKeys: ['driveId'],
    })
    const sheet = field({
      subBlockKey: 'sheetName',
      currentValue: 'Sheet1',
      consumesContextKeys: ['spreadsheetId'],
    })
    const unrelated = field({ subBlockKey: 'label', currentValue: 'keep-me' })
    const previous = {
      [dependentKey(drive)]: 'drive-repicked',
      [dependentKey(spreadsheet)]: 'spreadsheet-repicked',
      [dependentKey(sheet)]: 'Sheet2',
      [dependentKey(unrelated)]: 'still-keep-me',
    }

    const next = applyDependentRepick(
      previous,
      site,
      [site, drive, spreadsheet, sheet, unrelated],
      'site-new'
    )

    expect(next).toEqual({
      [dependentKey(site)]: 'site-new',
      [dependentKey(drive)]: '',
      [dependentKey(spreadsheet)]: '',
      [dependentKey(sheet)]: '',
      [dependentKey(unrelated)]: 'still-keep-me',
    })
    expect(effectiveDependentValue(drive, next, false)).toBe('')
    expect(effectiveCopyDependentValue(sheet, next)).toBe('')
  })

  it('only changes the selected field when it provides no selector context', () => {
    const leaf = field({ subBlockKey: 'issueKey', currentValue: 'ISSUE-1' })
    const unrelated = field({ subBlockKey: 'label', currentValue: 'keep-me' })

    expect(
      applyDependentRepick(
        { [dependentKey(unrelated)]: 'still-keep-me' },
        leaf,
        [leaf, unrelated],
        'ISSUE-2'
      )
    ).toEqual({
      [dependentKey(leaf)]: 'ISSUE-2',
      [dependentKey(unrelated)]: 'still-keep-me',
    })
  })
})

describe('isDependentConfigurationActionable', () => {
  it('hides stored values when the mapped parent is unchanged', () => {
    expect(
      isDependentConfigurationActionable(
        field({ required: true, currentValue: 'INBOX' }),
        {},
        {
          parentResolved: true,
          parentChanged: false,
          copying: false,
        }
      )
    ).toBe(false)
  })

  it('shows a required value that is missing under an unchanged mapped parent', () => {
    expect(
      isDependentConfigurationActionable(
        field({ required: true, currentValue: '' }),
        {},
        {
          parentResolved: true,
          parentChanged: false,
          copying: false,
        }
      )
    ).toBe(true)
  })

  it('hides a missing optional value under an unchanged mapped parent', () => {
    expect(
      isDependentConfigurationActionable(
        field({ required: false, currentValue: '' }),
        {},
        {
          parentResolved: true,
          parentChanged: false,
          copying: false,
        }
      )
    ).toBe(false)
  })

  it('shows every dependent when the mapped parent changed', () => {
    expect(
      isDependentConfigurationActionable(
        field({ required: false, currentValue: 'INBOX' }),
        {},
        {
          parentResolved: true,
          parentChanged: true,
          copying: false,
        }
      )
    ).toBe(true)
  })

  it('shows every dependent when the parent will be copied', () => {
    expect(
      isDependentConfigurationActionable(
        field({ required: false, currentValue: 'INBOX' }),
        {},
        {
          parentResolved: true,
          parentChanged: false,
          copying: true,
        }
      )
    ).toBe(true)
  })

  it('hides dependents until their parent is resolved', () => {
    expect(
      isDependentConfigurationActionable(
        field({ required: true, currentValue: '' }),
        {},
        {
          parentResolved: false,
          parentChanged: false,
          copying: false,
        }
      )
    ).toBe(false)
  })
})

describe('getActionableDependentFields', () => {
  const unchangedMappedParent = {
    parentResolved: true,
    parentChanged: false,
    copying: false,
  }

  it('includes the context provider for a required missing child', () => {
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      title: 'Spreadsheet',
      currentValue: '',
      providesContextKey: 'spreadsheetId',
    })
    const sheet = field({
      subBlockKey: 'sheetName',
      title: 'Sheet',
      currentValue: '',
      required: true,
      consumesContextKeys: ['spreadsheetId'],
    })

    expect(
      getActionableDependentFields([spreadsheet, sheet], {}, unchangedMappedParent).map(
        (dependent) => dependent.subBlockKey
      )
    ).toEqual(['spreadsheetId', 'sheetName'])
  })

  it('keeps a saved context provider visible while its child needs configuration', () => {
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      title: 'Spreadsheet',
      currentValue: 'spreadsheet-target',
      providesContextKey: 'spreadsheetId',
    })
    const sheet = field({
      subBlockKey: 'sheetName',
      title: 'Sheet',
      currentValue: '',
      required: true,
      consumesContextKeys: ['spreadsheetId'],
    })

    expect(
      getActionableDependentFields([spreadsheet, sheet], {}, unchangedMappedParent).map(
        (dependent) => dependent.subBlockKey
      )
    ).toEqual(['spreadsheetId', 'sheetName'])
  })

  it('walks transitive providers and leaves unrelated optional fields hidden', () => {
    const unrelated = field({
      subBlockKey: 'optionalLabel',
      title: 'Optional label',
      currentValue: '',
    })
    const site = field({
      subBlockKey: 'siteId',
      title: 'Site',
      currentValue: '',
      providesContextKey: 'siteId',
    })
    const drive = field({
      subBlockKey: 'driveId',
      title: 'Drive',
      currentValue: '',
      providesContextKey: 'driveId',
      consumesContextKeys: ['siteId'],
    })
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      title: 'Spreadsheet',
      currentValue: '',
      required: true,
      consumesContextKeys: ['driveId'],
    })

    expect(
      getActionableDependentFields(
        [unrelated, site, drive, spreadsheet],
        {},
        unchangedMappedParent
      ).map((dependent) => dependent.subBlockKey)
    ).toEqual(['siteId', 'driveId', 'spreadsheetId'])
  })
})
