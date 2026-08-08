import { describe, expect, it } from 'vitest'
import {
  ChatStructuredParser,
  parseChatStructured,
  renderChatStructured,
} from './chat-structured.js'

const ESC = String.fromCharCode(27)

function parseChunks(chunks: string[]) {
  const parser = new ChatStructuredParser()
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.finish()]
}

describe('ChatStructuredParser', () => {
  it('parses every official tag when wrappers are split across chunks', () => {
    const content = [
      'Answer ',
      '<thinking>private</thinking>',
      '<options>{"1":{"title":"Next","description":"Continue"}}</options>',
      '<question>{"type":"single_select","prompt":"Choose","options":[{"id":"a","label":"A"}]}</question>',
      '<credential>{"type":"link","provider":"Slack","value":"https://sim.ai/connect?id=1"}</credential>',
      '<workspace_resource>{"type":"workflow","id":"wf_1","title":"Daily sync"}</workspace_resource>',
      '<usage_upgrade>{"reason":"quota","action":"upgrade_plan","message":"Upgrade now"}</usage_upgrade>',
      '<mothership-error>{"message":"Unavailable","code":"MODEL_DOWN"}</mothership-error>',
    ].join('')

    const segments = parseChunks([...content])

    expect(segments.map((segment) => segment.kind).filter((kind) => kind !== 'text')).toEqual([
      'thinking',
      'options',
      'question',
      'credential',
      'workspace_resource',
      'usage_upgrade',
      'mothership-error',
    ])
  })

  it('does not treat a closing marker inside a JSON string as the tag boundary', () => {
    const segments = parseChunks([
      '<opt',
      'ions>{"1":{"title":"Show </options> literally","description":"escaped \\\"quote\\\""}}</opt',
      'ions>',
    ])

    expect(segments).toEqual([
      {
        kind: 'options',
        choices: [
          {
            value: 'Show </options> literally',
            label: 'Show </options> literally',
            description: 'escaped "quote"',
          },
        ],
      },
    ])
  })

  it('preserves valid-looking structured examples inside inline and fenced code', () => {
    const inline = '`<options>{"1":{"title":"A","description":"B"}}</options>`'
    const fenced =
      '```json\n<question>{"type":"single_select","prompt":"P","options":[{"id":"a","label":"A"}]}</question>\n```'
    const content = `${inline}\n${fenced}`

    expect(renderChatStructured(parseChunks([...content])).text).toBe(content)
  })

  it('strips malformed options and preserves unknown tags as sanitized text', () => {
    const content = `before <options>{bad${ESC}[2A</options> <future>${ESC}]0;pwned\u0007ok</future>`

    const result = renderChatStructured(parseChatStructured(content))

    expect(result.text).toContain('before<future>')
    expect(result.text).toContain('<future>ok</future>')
    expect(result.text).not.toContain('interactive response')
    expect(result.text).not.toContain(ESC)
  })

  it('holds incomplete wrappers until finish and then preserves them', () => {
    const parser = new ChatStructuredParser()

    expect(parser.push('answer <quest')).toEqual([{ kind: 'text', text: 'answer ' }])
    expect(parser.push('ion>{"type":"single_select"')).toEqual([])
    expect(parser.finish()).toEqual([
      { kind: 'text', text: 'Sim Chat requested an interactive response.' },
    ])
  })

  it('drops an unclosed thinking wrapper when the stream finishes', () => {
    const parser = new ChatStructuredParser()

    expect(parser.push('answer <thinking>still reasoning about')).toEqual([
      { kind: 'text', text: 'answer ' },
    ])
    expect(parser.finish()).toEqual([])
  })

  it('recovers useful prompts from invalid but parseable question payloads', () => {
    const segments = parseChatStructured(
      '<question>[{"type":"single_select","prompt":"Which\\nservice?","options":[]},{"prompt":"Deploy where?"}]</question>'
    )

    expect(segments).toEqual([{ kind: 'text', text: 'Which service?\n\nDeploy where?' }])
  })

  it('recovers a prompt from an otherwise complete question missing its closing tag', () => {
    const parser = new ChatStructuredParser()

    expect(
      parser.push(
        '<question>{"type":"single_select","prompt":"Continue?","options":[{"id":"yes","label":"Yes"}]}'
      )
    ).toEqual([])
    expect(parser.finish()).toEqual([{ kind: 'text', text: 'Continue?' }])
  })

  it('rejects question payloads beyond the interaction bounds and bounds prompt recovery', () => {
    const fourQuestions = Array.from({ length: 4 }, (_, index) => ({
      type: 'single_select',
      prompt: `Question ${index + 1}`,
      options: [{ id: 'yes', label: 'Yes' }],
    }))
    const tooManyOptions = {
      type: 'single_select',
      prompt: 'Pick one',
      options: Array.from({ length: 21 }, (_, index) => ({
        id: `option-${index}`,
        label: `Option ${index}`,
      })),
    }

    expect(parseChatStructured(`<question>${JSON.stringify(fourQuestions)}</question>`)).toEqual([
      { kind: 'text', text: 'Question 1\n\nQuestion 2\n\nQuestion 3' },
    ])
    expect(parseChatStructured(`<question>${JSON.stringify(tooManyOptions)}</question>`)).toEqual([
      { kind: 'text', text: 'Pick one' },
    ])
  })

  it('accepts question values at their limits and rejects overlong prompt, id, and label fields', () => {
    const boundedQuestion = {
      type: 'multi_select',
      prompt: 'p'.repeat(1024),
      options: Array.from({ length: 20 }, (_, index) => ({
        id: `${index}-${'i'.repeat(157)}`,
        label: 'l'.repeat(160),
      })),
    }
    const atLimits = parseChatStructured(
      `<question>${JSON.stringify([boundedQuestion, boundedQuestion, boundedQuestion])}</question>`
    )

    expect(atLimits).toHaveLength(1)
    expect(atLimits[0]?.kind).toBe('question')
    if (atLimits[0]?.kind !== 'question') throw new Error('Expected a question segment')
    expect(atLimits[0].questions).toHaveLength(3)
    expect(atLimits[0].questions[0]?.options).toHaveLength(20)

    for (const invalid of [
      { ...boundedQuestion, prompt: 'p'.repeat(1025) },
      { ...boundedQuestion, options: [{ id: 'i'.repeat(161), label: 'Valid' }] },
      { ...boundedQuestion, options: [{ id: 'valid', label: 'l'.repeat(161) }] },
    ]) {
      const segments = parseChatStructured(`<question>${JSON.stringify(invalid)}</question>`)
      expect(segments.some((segment) => segment.kind === 'question')).toBe(false)
    }
  })

  it('strips an incomplete options wrapper at end of stream', () => {
    const parser = new ChatStructuredParser()

    expect(parser.push('answer <options>{"1":{"title":"Next"')).toEqual([
      { kind: 'text', text: 'answer ' },
    ])
    expect(parser.finish()).toEqual([{ kind: 'options', choices: [] }])
  })

  it('keeps a CRLF stable when its bytes arrive in separate string fragments', () => {
    expect(renderChatStructured(parseChunks(['first\r', '\nsecond'])).text).toBe('first\nsecond')
  })

  it('strips options even when their decoded values contain controls', () => {
    const result = renderChatStructured(
      '<options>{"1":{"title":"Safe\\u001b[2A title","description":"D"}}</options>'
    )

    expect(result).toMatchObject({ text: '', interactions: [] })
  })

  it('sanitizes directly supplied segments as a defense-in-depth boundary', () => {
    const result = renderChatStructured([
      { kind: 'text', text: `safe${ESC}[2A text` },
      {
        kind: 'options',
        choices: [{ value: `next${ESC}c`, label: `Next${ESC}]0;x\u0007`, description: 'D' }],
      },
    ])

    expect(result).toMatchObject({ text: 'safe text', interactions: [] })
  })

  it('flattens interactive prompts, labels, and descriptions onto terminal-safe lines', () => {
    const result = renderChatStructured(
      [
        '<options>{"1":{"title":"Inspect\\nlogs","description":"Find\\t recent\\nerrors"}}</options>',
        '<question>{"type":"single_select","prompt":"Which\\nservice?","options":[{"id":"a\\nb","label":"API\\nworker"}]}</question>',
      ].join(''),
      { printMode: false }
    )

    expect(result.interactions).toEqual([
      {
        kind: 'question',
        questions: [
          {
            type: 'single_select',
            prompt: 'Which service?',
            options: [{ id: 'a b', label: 'API worker' }],
          },
        ],
      },
    ])
  })
})

describe('renderChatStructured', () => {
  it('strips options while preserving question interactions and print text', () => {
    const result = renderChatStructured(
      [
        '<options>{"1":{"title":"Inspect logs","description":"Find errors"}}</options>',
        '<question>[{"type":"multi_select","prompt":"Pick services","options":[{"id":"api","label":"API"},{"id":"other","label":"Something else"}]}]</question>',
      ].join('\n')
    )

    expect(result.text).toBe('Pick services')
    expect(result.interactions).toEqual([
      {
        kind: 'question',
        questions: [
          {
            type: 'multi_select',
            prompt: 'Pick services',
            options: [{ id: 'api', label: 'API' }],
          },
        ],
      },
    ])
  })

  it('strips options without producing an interaction outside print mode', () => {
    const result = renderChatStructured(
      'before<options>{"1":{"title":"Next","description":"Continue"}}</options>after',
      { printMode: false }
    )

    expect(result.text).toBe('beforeafter')
    expect(result.interactions).toEqual([])
  })

  it('removes whitespace surrounding hidden options at the end of print output', () => {
    const options = '<options>{"1":{"title":"Next","description":"Continue"}}</options>'

    expect(renderChatStructured(`Answer\n\n${options}\n\n`).text).toBe('Answer')
    expect(renderChatStructured(`before \n${options}\n after`).text).toBe('beforeafter')
    expect(renderChatStructured('Answer\n\n<options>{"1":{"title":"Next"').text).toBe('Answer')
  })

  it('renders workspace resources as names without terminal links or URL suffixes', () => {
    const result = renderChatStructured(
      '<workspace_resource>{"type":"workflow","id":"wf /1","title":"My workflow"}</workspace_resource>'
    )

    expect(result.text).toBe('My workflow')
    expect(result.text).not.toContain(ESC)
    expect(result.text).not.toContain('https://')
  })

  it('shows a path-only file title without resolving or appending its VFS path', () => {
    const result = renderChatStructured(
      '<workspace_resource>{"type":"file","path":"files/Reports/Q4%20Report.csv","title":"Q4"}</workspace_resource>'
    )

    expect(result.text).toBe('Q4')
  })

  it('rejects unsafe credential protocols and control-bearing links', () => {
    const unsafeProtocol = renderChatStructured(
      '<credential>{"type":"link","provider":"Slack","value":"javascript:alert(1)"}</credential>'
    )
    const controlBearing = renderChatStructured(
      '<credential>{"type":"link","provider":"Slack","value":"https://safe.test/\\u001b]8;;https://evil.test"}</credential>'
    )

    expect(unsafeProtocol.text).toBe('Open Sim to connect Slack.')
    expect(unsafeProtocol.text).not.toContain(ESC)
    expect(controlBearing.text).toBe('Open Sim to complete the requested credential action.')
    expect(controlBearing.text).not.toContain(ESC)
  })

  it('renders credential links as a plain action without exposing the destination', () => {
    const content =
      '<credential>{"type":"link","provider":"Slack","value":"https://sim.example.evil.test/connect"}</credential>'
    const result = renderChatStructured(content)

    expect(result.text).toBe('Open Sim to connect Slack.')
    expect(result.text).not.toContain('sim.example.evil.test')
    expect(result.text).not.toContain(ESC)
  })

  it('sanitizes workspace titles before rendering a plain resource name', () => {
    const result = renderChatStructured(
      '<workspace_resource>{"type":"table","id":"table_1","title":"Orders\\u001b]0;owned\\u0007 safe"}</workspace_resource>'
    )

    expect(result.text).toBe('Orders safe')
    expect(result.text).not.toContain(ESC)
  })

  it('never renders credential secret values', () => {
    const result = renderChatStructured(
      '<credential>{"type":"sim_key","provider":"Sim","value":"secret-value"}</credential>'
    )

    expect(result.text).toBe('Open Sim to configure a Sim API key.')
    expect(result.text).not.toContain('secret-value')
  })

  it.each([
    ['env_key', 'Open Sim to configure Slack environment credentials.'],
    ['oauth_key', 'Open Sim to connect Slack with OAuth.'],
    ['credential_id', 'Open Sim to select Slack credentials.'],
  ])('renders %s as a safe action without its value', (type, expected) => {
    const result = renderChatStructured(
      `<credential>{"type":"${type}","provider":"Slack","value":"never-print-me"}</credential>`
    )

    expect(result.text).toBe(expected)
    expect(result.text).not.toContain('never-print-me')
  })

  it('hides thinking and safely renders usage and mothership errors', () => {
    const result = renderChatStructured(
      'Answer<thinking>secret reasoning</thinking><usage_upgrade>{"reason":"quota","action":"increase_limit","message":"Increase limit"}</usage_upgrade><mothership-error>{"message":"Retry later","code":"BUSY","provider":"x"}</mothership-error>'
    )

    expect(result.text).toBe('Answer\n\nUsage limit reached: Increase limit\n\nRetry later (BUSY)')
    expect(result.text).not.toContain('secret reasoning')
  })
})
