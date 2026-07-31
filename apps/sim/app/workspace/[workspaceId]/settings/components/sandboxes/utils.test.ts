/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  emptyDraft,
  extractIssues,
  LANGUAGE_OPTIONS,
  toSubmittedLines,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'
import { FunctionBlock } from '@/blocks/blocks/function'

const languageField = FunctionBlock.subBlocks.find((subBlock) => subBlock.id === 'language')
const sandboxField = FunctionBlock.subBlocks.find((subBlock) => subBlock.id === 'sandboxId')

describe('sandbox draft defaults', () => {
  it('starts a new sandbox in the language the Function block itself defaults to', () => {
    const blockDefault = typeof languageField?.value === 'function' ? languageField.value() : null
    expect(blockDefault).toBe('javascript')
    expect(emptyDraft().language).toBe(blockDefault)
  })

  it('offers languages in the Function block dropdown order', () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(
      languageField?.options?.map((option) => (typeof option === 'string' ? option : option.id))
    )
  })

  it('starts empty so nothing is submitted by accident', () => {
    expect(emptyDraft()).toEqual({ name: '', language: 'javascript', dependencies: '' })
  })
})

describe('sandbox picker create action', () => {
  it('declares the inline create row the picker renders', () => {
    expect(sandboxField?.createAction).toBe('sandbox')
  })
})

describe('toSubmittedLines', () => {
  it('keeps blank rows so a rejection can address the line the user typed on', () => {
    expect(toSubmittedLines('axios\n\nzod')).toEqual(['axios', '', 'zod'])
  })
})

describe('extractIssues', () => {
  it('reads the per-line rejections off a failed save', () => {
    const error = { body: { issues: [{ line: 2, reason: 'not a package name' }] } }
    expect(extractIssues(error)).toEqual([{ line: 2, reason: 'not a package name' }])
  })

  it('returns nothing for an error that carries no issues', () => {
    expect(extractIssues(new Error('network'))).toEqual([])
    expect(extractIssues({ body: { issues: 'nope' } })).toEqual([])
    expect(extractIssues(undefined)).toEqual([])
  })
})
