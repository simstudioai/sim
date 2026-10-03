import { describe, expect, it } from 'vitest'
import { detectCodingAgent } from './coding-agent'

describe('detectCodingAgent', () => {
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

  it('ignores a declared name that is not a well-formed token', () => {
    expect(detectCodingAgent({ AI_AGENT: 'not a token', CLAUDECODE: '1' })).toBe('claude-code')
    expect(detectCodingAgent({ AI_AGENT: 'x'.repeat(65) })).toBeUndefined()
  })
})
