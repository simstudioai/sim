import { describe, expect, it } from 'vitest'
import { detectCodingAgent } from './coding-agent'

describe('detectCodingAgent', () => {
  it('reports nothing for a person at a terminal', () => {
    expect(detectCodingAgent({ TERM_PROGRAM: 'iTerm.app', SHELL: '/bin/zsh' })).toBeUndefined()
  })

  it.each([
    [{ CLAUDECODE: '1' }, 'claude-code'],
    [{ CLAUDE_CODE: '1' }, 'claude-code'],
    [{ CLAUDECODE: '1', CLAUDE_CODE_IS_COWORK: '1' }, 'cowork'],
    [{ CODEX_THREAD_ID: 'thr_1' }, 'codex'],
    [{ CODEX_SANDBOX: 'seatbelt' }, 'codex'],
    [{ CODEX_CI: '1' }, 'codex'],
    [{ GEMINI_CLI: '1' }, 'gemini-cli'],
    [{ COPILOT_CLI: '1' }, 'copilot-cli'],
    [{ OPENCODE: '1' }, 'opencode'],
    [{ ANTIGRAVITY_AGENT: '1' }, 'antigravity'],
    [{ AUGMENT_AGENT: '1' }, 'augment-cli'],
    [{ CURSOR_TRACE_ID: 'abc' }, 'cursor'],
    [{ CURSOR_AGENT: '1' }, 'cursor-cli'],
    [{ CURSOR_EXTENSION_HOST_ROLE: 'agent-exec' }, 'cursor-cli'],
  ])('recognises %o as %s', (env, expected) => {
    expect(detectCodingAgent(env)).toBe(expected)
  })

  it('names Amp rather than the Claude Code marker it also sets', () => {
    expect(detectCodingAgent({ AGENT: 'amp', CLAUDECODE: '1' })).toBe('amp')
  })

  it('names the Cursor IDE over the Cursor CLI signal', () => {
    expect(detectCodingAgent({ CURSOR_TRACE_ID: 'abc', CURSOR_AGENT: '1' })).toBe('cursor')
  })

  it('reads the declaration Claude Code sets on its shells as claude-code', () => {
    expect(
      detectCodingAgent({
        AI_AGENT: 'claude-code_2-1-270_agent',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      })
    ).toBe('claude-code')
  })

  it('lets an agent declare its own name over every vendor marker', () => {
    expect(detectCodingAgent({ AI_AGENT: 'Some-Agent', CLAUDECODE: '1' })).toBe('some-agent')
  })

  it('keeps only the name from a declaration that carries a version and role', () => {
    expect(detectCodingAgent({ AI_AGENT: 'claude-code_2-1-268_agent', CLAUDECODE: '1' })).toBe(
      'claude-code'
    )
  })

  it('keeps an underscored name that carries no version', () => {
    expect(detectCodingAgent({ AI_AGENT: 'github_copilot_vscode_agent' })).toBe(
      'github_copilot_vscode_agent'
    )
    expect(detectCodingAgent({ AI_AGENT: 'my_agent_2' })).toBe('my_agent')
    expect(detectCodingAgent({ AI_AGENT: '_', CLAUDECODE: '1' })).toBe('_')
  })

  it('ignores a declared name that is not a well-formed token', () => {
    expect(detectCodingAgent({ AI_AGENT: 'not a token', CLAUDECODE: '1' })).toBe('claude-code')
    expect(detectCodingAgent({ AI_AGENT: 'x'.repeat(65) })).toBeUndefined()
  })

  it('ignores signals that describe where a person works rather than an agent driving it', () => {
    expect(
      detectCodingAgent({
        REPL_ID: 'abc',
        GOOSE_PROVIDER: 'x',
        TERM_PROGRAM: 'kiro',
        PATH: '/home/me/.pi/agent/bin:/usr/bin',
        AGENT: 'goose',
        OPENCODE_CLIENT: 'vscode',
      })
    ).toBeUndefined()
  })

  it('ignores a cursor role that is not the agent executor', () => {
    expect(detectCodingAgent({ CURSOR_EXTENSION_HOST_ROLE: 'ui' })).toBeUndefined()
  })
})
