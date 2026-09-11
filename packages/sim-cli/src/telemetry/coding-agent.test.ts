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
    [{ GEMINI_CLI: '1' }, 'gemini-cli'],
    [{ CURSOR_AGENT: '1' }, 'cursor'],
    [{ CURSOR_TRACE_ID: 'abc' }, 'cursor'],
    [{ CURSOR_EXTENSION_HOST_ROLE: 'agent-exec' }, 'cursor'],
    [{ OPENCODE: '1', AGENT: '1' }, 'opencode'],
    [{ CLINE_ACTIVE: 'true' }, 'cline'],
    [{ OZ_RUN_ID: 'run_1' }, 'warp'],
    [{ PI_CODING_AGENT: 'true' }, 'pi'],
  ])('recognises %o as %s', (env, expected) => {
    expect(detectCodingAgent(env)).toBe(expected)
  })

  it('names Amp rather than the Claude Code marker it also sets', () => {
    expect(detectCodingAgent({ AGENT: 'amp', CLAUDECODE: '1' })).toBe('amp')
    expect(detectCodingAgent({ AMP_CURRENT_THREAD_ID: 'T-1', CLAUDECODE: '1' })).toBe('amp')
  })

  it('lets an agent declare its own name over every vendor marker', () => {
    expect(detectCodingAgent({ AI_AGENT: 'Some-Agent', CLAUDECODE: '1' })).toBe('some-agent')
  })

  it('keeps only the name from a declaration that carries a version and role', () => {
    expect(detectCodingAgent({ AI_AGENT: 'claude-code_2-1-268_agent', CLAUDECODE: '1' })).toBe(
      'claude-code'
    )
  })

  it('ignores a declaration that is nothing but separators', () => {
    expect(detectCodingAgent({ AI_AGENT: '_', CLAUDECODE: '1' })).toBe('claude-code')
  })

  it('ignores a declared name that is not a well-formed token', () => {
    expect(detectCodingAgent({ AI_AGENT: 'not a token', CLAUDECODE: '1' })).toBe('claude-code')
    expect(detectCodingAgent({ AI_AGENT: 'x'.repeat(65) })).toBeUndefined()
  })

  it('ignores markers that only mean an agent is installed', () => {
    expect(detectCodingAgent({ REPL_ID: 'abc', GOOSE_PROVIDER: 'x', AIDER_API_KEY: 'k' })).toBe(
      undefined
    )
  })

  it('ignores a cursor role that is not the agent executor', () => {
    expect(detectCodingAgent({ CURSOR_EXTENSION_HOST_ROLE: 'ui' })).toBeUndefined()
  })
})
