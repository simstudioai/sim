/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * `@/lib/auth/auth-client` builds a Better Auth client at module scope, which
 * throws when NEXT_PUBLIC_APP_URL is absent from the environment (and under
 * `isolate: false` an earlier file may have imported the graph in a polluted
 * env). These tests only exercise pure parsing/model helpers, so stub the
 * client module out entirely.
 */
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

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

const YES_NO = {
  type: 'single_select',
  prompt: 'Delete 4 archived workflows?',
  options: [
    { id: 'yes', label: 'Delete them' },
    { id: 'no', label: 'Cancel' },
  ],
}

const MULTI_SELECT = {
  type: 'multi_select',
  prompt: 'Which channels should the report go to?',
  options: [
    { id: 'slack', label: 'Slack' },
    { id: 'email', label: 'Email' },
    { id: 'sheet', label: 'Google Sheet' },
  ],
}

describe('parseQuestionTagBody', () => {
  it('normalizes a single object body to a one-element array', () => {
    expect(parseQuestionTagBody(JSON.stringify(SINGLE_SELECT))).toEqual([SINGLE_SELECT])
  })

  it('preserves array order for multi-step bodies', () => {
    const parsed = parseQuestionTagBody(JSON.stringify([SINGLE_SELECT, YES_NO, MULTI_SELECT]))
    expect(parsed).toEqual([SINGLE_SELECT, YES_NO, MULTI_SELECT])
  })

  it('accepts multi_select questions', () => {
    expect(parseQuestionTagBody(JSON.stringify(MULTI_SELECT))).toEqual([MULTI_SELECT])
  })

  it('rejects single_select without options', () => {
    expect(parseQuestionTagBody(JSON.stringify({ type: 'single_select', prompt: 'Pick' }))).toBe(
      null
    )
  })

  it('rejects empty options', () => {
    expect(
      parseQuestionTagBody(JSON.stringify({ type: 'single_select', prompt: 'Sure?', options: [] }))
    ).toBe(null)
  })

  it('rejects the removed text and confirm types', () => {
    expect(parseQuestionTagBody(JSON.stringify({ type: 'text', prompt: 'What time zone?' }))).toBe(
      null
    )
    expect(parseQuestionTagBody(JSON.stringify({ ...YES_NO, type: 'confirm' }))).toBe(null)
  })

  it('strips agent-supplied catch-all options (the card provides its own)', () => {
    const withOther = {
      ...SINGLE_SELECT,
      options: [...SINGLE_SELECT.options, { id: 'other', label: 'Something else' }],
    }
    expect(parseQuestionTagBody(JSON.stringify(withOther))).toEqual([SINGLE_SELECT])
  })

  it('rejects a question whose every option is a catch-all', () => {
    const onlyOther = {
      type: 'single_select',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'Other' },
        { id: 'b', label: 'None of the above' },
      ],
    }
    expect(parseQuestionTagBody(JSON.stringify(onlyOther))).toBe(null)
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
    expect(parseQuestionTagBody(JSON.stringify([SINGLE_SELECT, { type: 'single_select' }]))).toBe(
      null
    )
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
    const content = `<question>${JSON.stringify([SINGLE_SELECT, YES_NO, MULTI_SELECT])}</question>`
    const { segments } = parseSpecialTags(content, false)
    expect(segments).toEqual([{ type: 'question', data: [SINGLE_SELECT, YES_NO, MULTI_SELECT] }])
  })

  it('flags an unclosed question tag as pending while streaming', () => {
    const { segments, hasPendingTag } = parseSpecialTags(
      'Thinking about it. <question>[{"type":"single_sel',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Thinking about it. ' }])
  })

  it('shows prose immediately mid-stream instead of blanking the rest', () => {
    // The failure this replaces: everything after the marker stayed invisible
    // for the remainder of the stream, then reappeared when it ended.
    const content = 'The `<workspace_resource>` chip only renders for a real file.'
    const { segments, hasPendingTag } = parseSpecialTags(content, true)
    expect(hasPendingTag).toBe(false)
    expect(segments.map((s) => ('content' in s ? s.content : s.type)).join('')).toContain(
      'chip only renders for a real file.'
    )
  })

  it('still suppresses a JSON-bodied tag that is genuinely mid-stream', () => {
    const { segments, hasPendingTag } = parseSpecialTags(
      'Here you go <workspace_resource>{"type":"file","id":"abc"',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Here you go ' }])
  })

  it('bails when a foreign closing tag appears inside the body', () => {
    // Tags never nest, so a close for a different tag proves the opener was text.
    const { hasPendingTag } = parseSpecialTags(
      'see <options>[{"title":"a","description":"b"}] </question> more',
      true
    )
    expect(hasPendingTag).toBe(false)
  })

  it('does not bail on tag syntax quoted inside a JSON string', () => {
    // The false positive this guards: a question whose text legitimately quotes
    // another tag. Bailing would show raw JSON that later snaps into a card.
    const streaming = 'ok <question>[{"type":"single_select","prompt":"Use the </options> tag?"'
    expect(parseSpecialTags(streaming, true).hasPendingTag).toBe(true)
  })

  it('resolves that same question correctly once it closes', () => {
    // The other half of the guarantee: the body the streaming case refused to
    // bail on does render as a question card, so nothing flickered for nothing.
    const complete =
      'ok <question>[{"type":"single_select","prompt":"Use the </options> tag?","options":[{"id":"y","label":"Yes"},{"id":"n","label":"No"}]}]</question>'
    const { segments } = parseSpecialTags(complete, false)
    expect(segments.some((s) => s.type === 'question')).toBe(true)
  })

  it('still bails on a marker outside the JSON strings', () => {
    // Escapes must not end the string early, and a marker in real body position
    // is still evidence.
    const streaming = 'ok <question>[{"prompt":"a \\" quote"} </options>'
    expect(parseSpecialTags(streaming, true).hasPendingTag).toBe(false)
  })

  it('bails on a nested opening tag', () => {
    const { hasPendingTag } = parseSpecialTags('a <thinking>b <thinking> c', true)
    expect(hasPendingTag).toBe(false)
  })

  it('keeps suppressing an unclosed thinking tag with prose — its body is not JSON', () => {
    // Documents the deliberate gap: `thinking` bodies are prose, so the JSON
    // heuristic cannot apply and only the nesting rule can rescue it.
    const { hasPendingTag } = parseSpecialTags('a <thinking>still reasoning about', true)
    expect(hasPendingTag).toBe(true)
  })

  it('renders an unclosed tag as text once the message is complete', () => {
    const content =
      'The `<workspace_resource>` file chip only renders when its path points to a real file.'
    const { segments, hasPendingTag } = parseSpecialTags(content, false)
    expect(hasPendingTag).toBe(false)
    expect(segments).toEqual([
      { type: 'text', content: 'The `' },
      {
        type: 'text',
        content:
          '<workspace_resource>` file chip only renders when its path points to a real file.',
      },
    ])
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

describe('service_account credential tag', () => {
  it('parses a service_account tag into a credential segment', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'slack' })
    const { segments } = parseSpecialTags(`Set this up: <credential>${body}</credential>`, false)

    const credential = segments.find((segment) => segment.type === 'credential')
    expect(credential).toBeDefined()
    expect(credential).toMatchObject({
      type: 'credential',
      data: { type: 'service_account', provider: 'slack' },
    })
  })

  it('carries no value — the secret is typed into Sim’s own form, never the transcript', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'google-sheets' })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)

    const credential = segments.find((segment) => segment.type === 'credential')
    expect((credential as { data: { value?: string } }).data.value).toBeUndefined()
  })

  it('suppresses the tag while it is still streaming', () => {
    // A half-streamed tag must not flash raw JSON into the message body.
    const { segments, hasPendingTag } = parseSpecialTags(
      'Set this up: <credential>{"type": "service_a',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
    const text = segments
      .filter((segment): segment is { type: 'text'; content: string } => segment.type === 'text')
      .map((segment) => segment.content)
      .join('')
    expect(text).not.toContain('service_a')
  })
})

describe('service_account tag validation', () => {
  it('rejects a provider-less tag, which would render an unresolvable control', () => {
    const { segments } = parseSpecialTags(
      `<credential>${JSON.stringify({ type: 'service_account' })}</credential>`,
      false
    )
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
  })

  it('rejects a blank provider', () => {
    const { segments } = parseSpecialTags(
      `<credential>${JSON.stringify({ type: 'service_account', provider: '   ' })}</credential>`,
      false
    )
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
  })

  it('accepts an optional credentialId for reconnect and carries it through', () => {
    const body = JSON.stringify({
      type: 'service_account',
      provider: 'notion',
      credentialId: 'cred_abc123',
    })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)
    const credential = segments.find((segment) => segment.type === 'credential')
    expect(credential).toMatchObject({
      type: 'credential',
      data: { type: 'service_account', provider: 'notion', credentialId: 'cred_abc123' },
    })
  })

  it('rejects a non-string credentialId', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'notion', credentialId: 42 })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
  })

  it.each(['', '   '])(
    'rejects a blank credentialId (%j) so reconnect cannot target a missing credential',
    (credentialId) => {
      const body = JSON.stringify({ type: 'service_account', provider: 'notion', credentialId })
      const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)
      expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
    }
  )
})
