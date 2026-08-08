import { describe, expect, it } from 'vitest'
import {
  applySuggestion,
  type ChatContext,
  contextSpans,
  extractCompletionToken,
  formatMention,
  presentContexts,
  rankSuggestions,
  resolveSlashContexts,
  SLASH_COMMANDS,
  type SuggestionItem,
  suggestionWindow,
} from './chat-suggestions.js'

const item = (value: string, description?: string): SuggestionItem => ({
  id: value,
  value,
  displayText: value,
  description,
})

describe('slash commands', () => {
  it('offers chat switching and renaming without requiring arguments to open the menu', () => {
    expect(SLASH_COMMANDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '/chats', displayText: '/chats' }),
        expect.objectContaining({ value: '/rename', displayText: '/rename <title>' }),
      ])
    )
  })
})

describe('extractCompletionToken', () => {
  it('opens a slash context at the start of any token', () => {
    expect(extractCompletionToken('/att', 4)).toMatchObject({ trigger: '/', query: 'att' })
    expect(extractCompletionToken('hi /att', 7)).toMatchObject({
      trigger: '/',
      query: 'att',
      startPos: 3,
    })
  })

  it('closes the slash context once an argument is typed', () => {
    expect(extractCompletionToken('/attach ', 8)).toBeNull()
  })

  it('opens a mention at the start or after whitespace', () => {
    expect(extractCompletionToken('@rev', 4)).toMatchObject({
      trigger: '@',
      query: 'rev',
      startPos: 0,
    })
    expect(extractCompletionToken('use @rev', 8)).toMatchObject({
      trigger: '@',
      query: 'rev',
      startPos: 4,
    })
  })

  it('closes a mention once a slash is typed, matching the client editor', () => {
    expect(extractCompletionToken('@logs/incident', 14)).toBeNull()
  })

  it('does not treat an email address as a mention', () => {
    expect(extractCompletionToken('mail foo@bar.com', 16)).toBeNull()
  })

  it('reads from the cursor, not the end of the draft', () => {
    expect(extractCompletionToken('@rev trailing', 4)).toMatchObject({ query: 'rev' })
  })

  it('returns null for a bare draft', () => {
    expect(extractCompletionToken('hello world', 11)).toBeNull()
  })
})

describe('rankSuggestions', () => {
  const candidates = [
    item('attach'),
    item('clear'),
    item('help'),
    item('paste-image'),
    item('chat'),
  ]

  it('returns everything for an empty query', () => {
    expect(rankSuggestions('', candidates)).toHaveLength(5)
  })

  it('preserves source order while filtering by substring', () => {
    const filtered = rankSuggestions('c', [item('clear'), item('c'), item('chat')])
    expect(filtered.map((entry) => entry.value)).toEqual(['clear', 'c', 'chat'])
  })

  it('matches substrings but not fuzzy subsequences', () => {
    expect(rankSuggestions('image', candidates)[0]?.value).toBe('paste-image')
    expect(rankSuggestions('pti', candidates)).toEqual([])
  })

  it('does not search descriptions', () => {
    expect(
      rankSuggestions('clipboard', [item('paste-image', 'attach from the clipboard')])
    ).toEqual([])
  })

  it('drops non-matches', () => {
    expect(rankSuggestions('zzz', candidates)).toEqual([])
  })
})

describe('suggestionWindow', () => {
  it('shows everything when the list fits', () => {
    expect(suggestionWindow(3, 0, 5)).toEqual({ start: 0, end: 3 })
  })

  it('centres the window on the selection', () => {
    expect(suggestionWindow(20, 10, 5)).toEqual({ start: 8, end: 13 })
  })

  it('clamps at both ends', () => {
    expect(suggestionWindow(20, 0, 5)).toEqual({ start: 0, end: 5 })
    expect(suggestionWindow(20, 19, 5)).toEqual({ start: 15, end: 20 })
  })
})

describe('applySuggestion', () => {
  it('replaces the trigger token and leaves a trailing space', () => {
    const token = extractCompletionToken('/att', 4)
    expect(token).not.toBeNull()
    expect(applySuggestion('/att', token!, '/attach')).toEqual({ draft: '/attach ', cursor: 8 })
  })

  it('preserves text after the cursor without doubling the separator', () => {
    const token = extractCompletionToken('use @rev and go', 8)
    expect(applySuggestion('use @rev and go', token!, '@reviewer')).toEqual({
      draft: 'use @reviewer and go',
      cursor: 13,
    })
  })
})

describe('formatMention', () => {
  it('matches the client literal insertion for single and multiword labels', () => {
    expect(formatMention('reviewer')).toBe('@reviewer')
    expect(formatMention('code reviewer')).toBe('@code reviewer')
  })
})

describe('structured tag contexts', () => {
  const workflow: ChatContext = {
    kind: 'workflow',
    workflowId: 'workflow-1',
    label: 'Release notes',
  }
  const skill: ChatContext = { kind: 'skill', skillId: 'skill-1', label: 'review' }
  const mcp: ChatContext = { kind: 'mcp', serverId: 'mcp-1', label: 'review' }

  it('finds literal multiword resource and slash spans', () => {
    expect(contextSpans('use @Release notes with /review', [workflow, skill])).toEqual([
      { start: 4, end: 18 },
      { start: 24, end: 31 },
    ])
  })

  it('drops a selected context when its exact token is gone', () => {
    expect(presentContexts('use @Release notes', [workflow])).toEqual([workflow])
    expect(presentContexts('use @Release note', [workflow])).toEqual([])
  })

  it('auto-resolves typed slash tags with skill precedence over a same-name MCP', () => {
    const candidates: SuggestionItem[] = [
      { id: 'skill', value: 'review', displayText: '/review', context: skill },
      { id: 'mcp', value: 'review', displayText: '/review', context: mcp },
    ]
    expect(resolveSlashContexts('please /REVIEW this', candidates)).toEqual([skill])
    expect(resolveSlashContexts('path/to/review', candidates)).toEqual([])
  })
})
