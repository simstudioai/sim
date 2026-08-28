/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  buildCodexExecCommand,
  CODEX_DISABLED_FEATURES,
  CODEX_HOME_DIR,
  CODEX_PROMPT_PATH,
  DEFAULT_CODEX_MODEL,
  parseCodexModel,
  parseCodexReasoningEffort,
} from '@/executor/handlers/codex/core/command'

describe('buildCodexExecCommand', () => {
  it('builds a first-turn command that persists an isolated Codex session', () => {
    const result = buildCodexExecCommand({
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      networkAccess: false,
    })

    expect(result.envs).toEqual({
      CODEX_HOME: CODEX_HOME_DIR,
      CODEX_MODEL: 'gpt-5.6-terra',
      CODEX_REASONING_EFFORT: 'high',
      CODEX_NETWORK_ACCESS: 'false',
    })
    expect(result.command).toContain('codex exec')
    expect(result.command).toContain('--json')
    expect(result.command).not.toContain('--ephemeral')
    expect(result.command).toContain('--ignore-user-config')
    expect(result.command).toContain('--ignore-rules')
    expect(result.command).toContain('--strict-config')
    expect(result.command).toContain('--sandbox workspace-write')
    expect(result.command).toContain(`- < ${CODEX_PROMPT_PATH}`)
    expect(result.command).toContain('shell_environment_policy.inherit="core"')
    expect(result.command).toContain('shell_environment_policy.ignore_default_excludes=false')
    for (const feature of CODEX_DISABLED_FEATURES) {
      expect(result.command).toContain(`features.${feature}=false`)
    }
    expect(result.command).not.toContain('gpt-5.6-terra')
    expect(result.command).toContain('rm -rf "$CODEX_HOME"')
    expect(result.envs).not.toHaveProperty('CODEX_THREAD_ID')
  })

  it('builds a resume command without deleting the retained Codex home', () => {
    const result = buildCodexExecCommand({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      networkAccess: true,
      threadId: '019f-session-id',
    })

    expect(result.envs.CODEX_THREAD_ID).toBe('019f-session-id')
    expect(result.command).toContain('resume "$CODEX_THREAD_ID" -')
    expect(result.command).toContain('if [ ! -d "$CODEX_HOME/sessions" ]')
    expect(result.command).not.toContain('--ephemeral')
  })

  it('defaults model and reasoning to the pinned catalog defaults', () => {
    expect(parseCodexModel(undefined)).toBe(DEFAULT_CODEX_MODEL)
    expect(parseCodexReasoningEffort(undefined)).toBe('medium')
  })

  it('rejects unsupported and shell-shaped model values', () => {
    expect(() => parseCodexModel('gpt-future')).toThrow('Unsupported Codex model')
    expect(() => parseCodexModel('gpt-5.6-sol; touch /tmp/pwned')).toThrow(
      'Unsupported Codex model'
    )
    expect(() => parseCodexReasoningEffort('high; env')).toThrow(
      'Unsupported Codex reasoning effort'
    )
  })
})
