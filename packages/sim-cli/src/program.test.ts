import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { buildProgram } from './program'
import { cliVersion } from './version'

/** Parses argv against a program whose output and exits are captured, not taken. */
async function parse(
  argv: string[],
  program: Command = buildProgram()
): Promise<{ out: string; code: string | null }> {
  let out = ''
  const capture = (command: Command) => {
    command.exitOverride()
    command.configureOutput({
      writeOut: (text) => {
        out += text
      },
      writeErr: () => {},
    })
    command.commands.forEach(capture)
  }
  capture(program)

  try {
    await program.parseAsync(['node', 'sim', ...argv])
    return { out, code: null }
  } catch (error) {
    return { out, code: (error as { code?: string }).code ?? null }
  }
}

describe('the root version flag', () => {
  /**
   * The silent no-op this exists to end: Commander matched the root's own
   * `--version` inside `sim workflows rollback <id> --version 1`, printed the
   * CLI version, and exited 0 without issuing a request — so a CI step reading
   * the exit code saw a rollback that had never happened.
   */
  it('refuses a value instead of answering for a subcommand', async () => {
    const { out, code } = await parse(['workflows', 'rollback', 'wf_1', '--version', '1'])

    expect(out).not.toContain(cliVersion())
    expect(code).toBe('commander.error')
  })

  /** `[unused]` was a user-visible placeholder that read like a mistake. */
})

/**
 * `sim <group> <unknown> --help` exited 0 printing the group's help, so a probe
 * that reads the exit code to ask "does this command exist?" was told yes.
 */
describe('help typed after a command that does not exist', () => {
  it('refuses it inside a group', async () => {
    const { out, code } = await parse(['workspaces', 'zzzz', '--help'])

    expect(code).toBe('commander.unknownCommand')
    expect(out).not.toContain('Manage workspaces')
  })
})

/** Commander keeps lifecycle hooks on a private field and offers no getter. */
function preActionHooks(program: Command): Array<(a: Command, b: Command) => unknown> {
  const { _lifeCycleHooks: hooks } = program as Command & {
    _lifeCycleHooks?: Record<string, Array<(a: Command, b: Command) => unknown>>
  }
  return hooks?.preAction ?? []
}

describe('the update check', () => {
  /**
   * The notice must cost `--version` and `--help` nothing. Commander answers
   * both during parsing, before any action hook runs, so the guarantee is
   * structural — this holds it in place if the check is ever moved.
   *
   * It swaps in a sentinel hook rather than watching for a request or a cache
   * file. Those side effects never appear from inside a checkout no matter
   * what runs, because the check suppresses itself there — so asserting on
   * them would pass even if the hook fired, which is precisely the regression
   * this is meant to catch.
   */
  it('fires no preAction hook for the two commands commander answers while parsing', async () => {
    let fired = 0
    const program = buildProgram()
    const hooks = preActionHooks(program)
    expect(hooks).toHaveLength(1)
    hooks.splice(0, hooks.length, () => {
      fired += 1
    })

    await parse(['--version'], program)
    await parse(['--help'], program)
    expect(fired).toBe(0)

    const dir = mkdtempSync(join(tmpdir(), 'sim-cli-program-'))
    const previousConfigDir = process.env.SIM_CONFIG_DIR
    process.env.SIM_CONFIG_DIR = dir
    try {
      await parse(['configure', '--set-output', 'json'], program)
      expect(fired).toBe(1)
    } finally {
      if (previousConfigDir === undefined) Reflect.deleteProperty(process.env, 'SIM_CONFIG_DIR')
      else process.env.SIM_CONFIG_DIR = previousConfigDir
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
