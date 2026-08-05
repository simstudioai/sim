import { describe, expect, it } from 'bun:test'
import {
  isMissingDependencyError,
  missingDependenciesMessage,
  retrySetupCommand,
} from './launcher.ts'

describe('setup launcher', () => {
  it('recognizes missing packages without masking application import errors', () => {
    expect(
      isMissingDependencyError({
        code: 'ERR_MODULE_NOT_FOUND',
        message: "Cannot find package '@clack/prompts' from '/repo/scripts/setup/prompter.ts'",
      })
    ).toBe(true)
    expect(
      isMissingDependencyError({
        code: 'ERR_MODULE_NOT_FOUND',
        message: "Cannot find module './missing-application-file.ts'",
      })
    ).toBe(false)
    expect(isMissingDependencyError(new Error('Invalid setup configuration'))).toBe(false)
  })

  it('prints the install command and the public retry command', () => {
    expect(retrySetupCommand(['setup', 'status'])).toBe('bun run setup status')
    expect(retrySetupCommand(['doctor'])).toBe('bun run sim doctor')
    expect(missingDependenciesMessage('bun run setup status')).toContain('Run: bun install')
    expect(missingDependenciesMessage('bun run setup status')).toContain(
      'Then retry: bun run setup status'
    )
  })
})
