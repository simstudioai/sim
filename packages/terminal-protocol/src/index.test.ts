import { describeRunningCommand } from '@sim/terminal-protocol'
import { describe, expect, it } from 'vitest'

describe('describeRunningCommand', () => {
  it('drops the cd/export preamble an agent-launched terminal carries', () => {
    const command =
      'cd /Users/someone/Desktop/sim && export PATH="/opt/homebrew/bin:$PATH" && claude "Fix this runtime error in this repo: file upload fails"'
    expect(describeRunningCommand(command)).toBe('claude')
  })

  it('ignores separators inside quotes', () => {
    expect(describeRunningCommand('claude "build && test; deploy | ship"')).toBe('claude')
    expect(describeRunningCommand("claude 'a && b'")).toBe('claude')
  })

  it('honors backslash escapes only where the shell does', () => {
    // Escaped quote keeps the double-quoted run open, so `&&` stays quoted.
    expect(describeRunningCommand('claude "say \\" && rm -rf /"')).toBe('claude')
    // A backslash is literal inside single quotes, so that run closes and the
    // following `&&` is a real separator.
    expect(describeRunningCommand("claude 'a\\' && jest")).toBe('jest')
  })

  it('skips environment assignments and wrapper words', () => {
    expect(describeRunningCommand('NODE_ENV=test bun test')).toBe('bun')
    expect(describeRunningCommand('sudo /usr/bin/docker compose up')).toBe('docker')
    expect(describeRunningCommand('env FOO=1 nohup python train.py')).toBe('python')
  })
})
