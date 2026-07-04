/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  parseQuestionTagBody,
  parseSpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

const SINGLE_SELECT = {
  type: 'single_select',
  prompt: 'How should I handle the duplicate emails?',
  options: [
    { id: 'keep_newest', label: 'Keep the newest entry' },
    { id: 'merge', label: 'Merge fields into one row' },
  ],
}

const CONFIRM = {
  type: 'confirm',
  prompt: 'Delete 4 archived workflows?',
  options: [
    { id: 'yes', label: 'Delete them' },
    { id: 'no', label: 'Cancel' },
  ],
}

const TEXT = { type: 'text', prompt: 'What time zone should the daily report run in?' }

describe('parseQuestionTagBody', () => {
  it('normalizes a single object body to a one-element array', () => {
    expect(parseQuestionTagBody(JSON.stringify(SINGLE_SELECT))).toEqual([SINGLE_SELECT])
  })

  it('preserves array order for multi-step bodies', () => {
    const parsed = parseQuestionTagBody(JSON.stringify([SINGLE_SELECT, CONFIRM, TEXT]))
    expect(parsed).toEqual([SINGLE_SELECT, CONFIRM, TEXT])
  })

  it('accepts text questions without options', () => {
    expect(parseQuestionTagBody(JSON.stringify(TEXT))).toEqual([TEXT])
  })

  it('rejects single_select without options', () => {
    expect(parseQuestionTagBody(JSON.stringify({ type: 'single_select', prompt: 'Pick' }))).toBe(
      null
    )
  })

  it('rejects confirm with empty options', () => {
    expect(
      parseQuestionTagBody(JSON.stringify({ type: 'confirm', prompt: 'Sure?', options: [] }))
    ).toBe(null)
  })

  it('rejects an unknown question type', () => {
    expect(parseQuestionTagBody(JSON.stringify({ ...SINGLE_SELECT, type: 'multi_select' }))).toBe(
      null
    )
  })

  it('rejects an empty prompt', () => {
    expect(parseQuestionTagBody(JSON.stringify({ ...SINGLE_SELECT, prompt: '  ' }))).toBe(null)
  })

  it('rejects a malformed option', () => {
    expect(
      parseQuestionTagBody(JSON.stringify({ ...SINGLE_SELECT, options: [{ id: 'keep_newest' }] }))
    ).toBe(null)
  })

  it('rejects an array containing one invalid question', () => {
    expect(parseQuestionTagBody(JSON.stringify([TEXT, { type: 'text' }]))).toBe(null)
  })

  it('rejects empty arrays and non-JSON bodies', () => {
    expect(parseQuestionTagBody('[]')).toBe(null)
    expect(parseQuestionTagBody('not json')).toBe(null)
  })
})

describe('parseSpecialTags with <question>', () => {
  it('extracts a complete question tag interleaved with text', () => {
    const content = `Before the tag. <question>${JSON.stringify(SINGLE_SELECT)}</question> After the tag.`
    const { segments, hasPendingTag } = parseSpecialTags(content, false)
    expect(hasPendingTag).toBe(false)
    expect(segments).toEqual([
      { type: 'text', content: 'Before the tag. ' },
      { type: 'question', data: [SINGLE_SELECT] },
      { type: 'text', content: ' After the tag.' },
    ])
  })

  it('extracts a multi-step array body as one segment', () => {
    const content = `<question>${JSON.stringify([SINGLE_SELECT, CONFIRM, TEXT])}</question>`
    const { segments } = parseSpecialTags(content, false)
    expect(segments).toEqual([{ type: 'question', data: [SINGLE_SELECT, CONFIRM, TEXT] }])
  })

  it('flags an unclosed question tag as pending while streaming', () => {
    const { segments, hasPendingTag } = parseSpecialTags(
      'Thinking about it. <question>[{"type":"single_sel',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Thinking about it. ' }])
  })

  it('strips a trailing partial opening tag while streaming', () => {
    const { segments, hasPendingTag } = parseSpecialTags('Let me ask. <ques', true)
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Let me ask. ' }])
  })

  it('drops a question tag with an invalid body but keeps surrounding text', () => {
    const { segments, hasPendingTag } = parseSpecialTags(
      'Before. <question>{"type":"single_select"}</question> After.',
      false
    )
    expect(hasPendingTag).toBe(false)
    expect(segments).toEqual([
      { type: 'text', content: 'Before. ' },
      { type: 'text', content: ' After.' },
    ])
  })
})
