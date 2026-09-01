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
  getDisplayedDependentFields,
  isDependentConfigurationActionable,
  isDependentInvalidated,
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

const mappedRepickContext = (previousValue: string) => ({
  previousValue,
  baselineValueFor: (dependent: ForkDependentReconfig) => dependent.currentValue,
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

  it('keeps a custom-block input\'s stored value even though its parent always "changed"', () => {
    // These fields exist BECAUSE the block's type was repointed, so `parentChanged` is always
    // true — but the stored value is the user's configuration for that exact target (the
    // storage key namespaces it by target type), not a stale pick against an old parent.
    // Blanking it here desyncs the rendered value from the Sync gate and the submitted
    // payload: required fields look filled but keep Sync disabled, and optional ones submit
    // empty and wipe the stored mapping.
    const customBlockField = field({
      parentKind: 'custom-block',
      parentSourceId: 'custom_block_uat0001',
      currentValue: 'configured for the target',
    })

    expect(effectiveDependentValue(customBlockField, {}, true)).toBe('configured for the target')
  })

  it('still blanks a custom-block input the user explicitly cleared', () => {
    const f = field({ parentKind: 'custom-block', currentValue: 'stored' })
    expect(effectiveDependentValue(f, { [dependentKey(f)]: null }, true)).toBe('')
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
      'site-new',
      mappedRepickContext('site-old')
    )

    expect(next).toEqual({
      [dependentKey(site)]: 'site-new',
      [dependentKey(drive)]: null,
      [dependentKey(spreadsheet)]: null,
      [dependentKey(sheet)]: null,
      [dependentKey(unrelated)]: 'still-keep-me',
    })
    expect(effectiveDependentValue(drive, next, false)).toBe('')
    expect(effectiveCopyDependentValue(sheet, next)).toBe('')
  })

  it('re-picking the value the field already had leaves its descendants alone', () => {
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      currentValue: 'sheet-doc',
      providesContextKey: 'spreadsheetId',
    })
    const range = field({
      subBlockKey: 'range',
      currentValue: 'Sheet1!A1:D',
      consumesContextKeys: ['spreadsheetId'],
    })

    const next = applyDependentRepick(
      {},
      spreadsheet,
      [spreadsheet, range],
      'sheet-doc',
      mappedRepickContext(effectiveDependentValue(spreadsheet, {}, false))
    )

    expect(next).toEqual({})
    expect(effectiveDependentValue(range, next, false)).toBe('Sheet1!A1:D')
  })

  it('only changes the selected field when it provides no selector context', () => {
    const leaf = field({ subBlockKey: 'issueKey', currentValue: 'ISSUE-1' })
    const unrelated = field({ subBlockKey: 'label', currentValue: 'keep-me' })

    expect(
      applyDependentRepick(
        { [dependentKey(unrelated)]: 'still-keep-me' },
        leaf,
        [leaf, unrelated],
        'ISSUE-2',
        mappedRepickContext('ISSUE-1')
      )
    ).toEqual({
      [dependentKey(leaf)]: 'ISSUE-2',
      [dependentKey(unrelated)]: 'still-keep-me',
    })
  })

  it('does not clear a descendant belonging to another nested tool instance', () => {
    const projectOne = field({
      subBlockKey: 'tools[0].projectId',
      dependencyScope: 'tools[0]',
      providesContextKey: 'projectId',
    })
    const issueOne = field({
      subBlockKey: 'tools[0].issueKey',
      dependencyScope: 'tools[0]',
      consumesContextKeys: ['projectId'],
    })
    const projectTwo = field({
      subBlockKey: 'tools[1].projectId',
      dependencyScope: 'tools[1]',
      providesContextKey: 'projectId',
    })
    const issueTwo = field({
      subBlockKey: 'tools[1].issueKey',
      dependencyScope: 'tools[1]',
      consumesContextKeys: ['projectId'],
    })
    const previous = {
      [dependentKey(issueOne)]: 'P1-1',
      [dependentKey(issueTwo)]: 'P2-1',
    }

    expect(
      applyDependentRepick(
        previous,
        projectOne,
        [projectOne, issueOne, projectTwo, issueTwo],
        'P1-NEW',
        mappedRepickContext('INBOX')
      )
    ).toEqual({
      [dependentKey(projectOne)]: 'P1-NEW',
      [dependentKey(issueOne)]: null,
      [dependentKey(issueTwo)]: 'P2-1',
    })
  })

  it('restores the stored chain when a provider is changed and then returned to baseline', () => {
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      currentValue: 'doc-old',
      providesContextKey: 'spreadsheetId',
    })
    const range = field({
      subBlockKey: 'range',
      currentValue: 'A1:D50',
      consumesContextKeys: ['spreadsheetId'],
    })

    const changed = applyDependentRepick(
      {},
      spreadsheet,
      [spreadsheet, range],
      'doc-new',
      mappedRepickContext('doc-old')
    )
    const restored = applyDependentRepick(
      changed,
      spreadsheet,
      [spreadsheet, range],
      'doc-old',
      mappedRepickContext('doc-new')
    )

    expect(changed).toEqual({
      [dependentKey(spreadsheet)]: 'doc-new',
      [dependentKey(range)]: null,
    })
    expect(restored).toEqual({})
    expect(effectiveDependentValue(range, restored, false)).toBe('A1:D50')
  })

  it('keeps an intentional empty pick distinct from automatic invalidation', () => {
    const label = field({ subBlockKey: 'label', currentValue: 'INBOX' })

    const next = applyDependentRepick({}, label, [label], '', mappedRepickContext('INBOX'))

    expect(isDependentInvalidated(label, next)).toBe(false)
    expect(next[dependentKey(label)]).toBe('')
    expect(effectiveDependentValue(label, next, false)).toBe('')
  })

  it('does not restore an Excel sheet while its drive still differs from baseline', () => {
    const drive = field({
      subBlockKey: 'driveId',
      currentValue: 'drive-old',
      providesContextKey: 'driveId',
    })
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      currentValue: 'workbook-old',
      consumesContextKeys: ['driveId'],
      providesContextKey: 'spreadsheetId',
    })
    const sheet = field({
      subBlockKey: 'sheetName',
      currentValue: 'Sheet1',
      consumesContextKeys: ['driveId', 'spreadsheetId'],
    })

    const driveChanged = applyDependentRepick(
      {},
      drive,
      [drive, spreadsheet, sheet],
      'drive-new',
      mappedRepickContext('drive-old')
    )
    const spreadsheetRepicked = applyDependentRepick(
      driveChanged,
      spreadsheet,
      [drive, spreadsheet, sheet],
      'workbook-new',
      mappedRepickContext('')
    )
    const spreadsheetRestored = applyDependentRepick(
      spreadsheetRepicked,
      spreadsheet,
      [drive, spreadsheet, sheet],
      'workbook-old',
      mappedRepickContext('workbook-new')
    )

    expect(spreadsheetRestored).toEqual({
      [dependentKey(drive)]: 'drive-new',
      [dependentKey(sheet)]: null,
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

  it('shows a required field that a parent re-pick blanked (it blocks Sync)', () => {
    const spreadsheet = field({
      subBlockKey: 'spreadsheetId',
      currentValue: 'doc-old',
      providesContextKey: 'spreadsheetId',
    })
    const sheet = field({
      subBlockKey: 'sheetName',
      required: true,
      currentValue: 'Sheet1',
      consumesContextKeys: ['spreadsheetId'],
    })
    const next = applyDependentRepick(
      {},
      spreadsheet,
      [spreadsheet, sheet],
      'doc-new',
      mappedRepickContext(effectiveDependentValue(spreadsheet, {}, false))
    )

    // The sync gate reads the same blank the selector shows, so the field gates and is visible.
    expect(effectiveDependentValue(sheet, next, false)).toBe('')
    expect(
      isDependentConfigurationActionable(sheet, next, {
        parentResolved: true,
        parentChanged: false,
        copying: false,
      })
    ).toBe(true)
  })

  it('shows a required field the user emptied themselves (it blocks Sync)', () => {
    const sheet = field({ subBlockKey: 'sheetName', required: true, currentValue: 'Sheet1' })
    const next = applyDependentRepick({}, sheet, [sheet], '', mappedRepickContext('Sheet1'))

    expect(effectiveDependentValue(sheet, next, false)).toBe('')
    expect(
      isDependentConfigurationActionable(sheet, next, {
        parentResolved: true,
        parentChanged: false,
        copying: false,
      })
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

  it('finds a required child provider only within the same nested tool instance', () => {
    const projectOne = field({
      subBlockKey: 'tools[0].projectId',
      dependencyScope: 'tools[0]',
      providesContextKey: 'projectId',
    })
    const projectTwo = field({
      subBlockKey: 'tools[1].projectId',
      dependencyScope: 'tools[1]',
      providesContextKey: 'projectId',
    })
    const issueOne = field({
      subBlockKey: 'tools[0].issueKey',
      dependencyScope: 'tools[0]',
      currentValue: '',
      required: true,
      consumesContextKeys: ['projectId'],
    })

    expect(
      getActionableDependentFields(
        [projectOne, projectTwo, issueOne],
        {},
        unchangedMappedParent
      ).map((dependent) => dependent.subBlockKey)
    ).toEqual(['tools[0].projectId', 'tools[0].issueKey'])
  })
})

describe('getDisplayedDependentFields', () => {
  const unchangedMappedParent = {
    parentResolved: true,
    parentChanged: false,
    copying: false,
  }

  it('reveals configured and optional fields only after the explicit edit action', () => {
    const configuredRequired = field({ subBlockKey: 'projectId', required: true })
    const optional = field({ subBlockKey: 'issueKey', currentValue: '', required: false })

    expect(
      getDisplayedDependentFields([configuredRequired, optional], {}, unchangedMappedParent, false)
    ).toEqual([])
    expect(
      getDisplayedDependentFields([configuredRequired, optional], {}, unchangedMappedParent, true)
    ).toEqual([configuredRequired, optional])
  })

  it('never shows selectors before their parent mapping is resolved', () => {
    expect(
      getDisplayedDependentFields(
        [field()],
        {},
        { ...unchangedMappedParent, parentResolved: false },
        true
      )
    ).toEqual([])
  })
})
