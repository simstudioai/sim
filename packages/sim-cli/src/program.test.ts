/**
 * @vitest-environment node
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { buildProgram } from './program'
import { CLI_VERSION } from './version'

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
  it('still reports the version on its own', async () => {
    const { out, code } = await parse(['--version'])

    expect(out.trim()).toBe(CLI_VERSION)
    expect(code).toBe('commander.version')
  })

  /**
   * The silent no-op this exists to end: Commander matched the root's own
   * `--version` inside `sim workflows rollback <id> --version 1`, printed the
   * CLI version, and exited 0 without issuing a request — so a CI step reading
   * the exit code saw a rollback that had never happened.
   */
  it('refuses a value instead of answering for a subcommand', async () => {
    const { out, code } = await parse(['workflows', 'rollback', 'wf_1', '--version', '1'])

    expect(out).not.toContain(CLI_VERSION)
    expect(code).toBe('commander.error')
  })

  it('refuses the same value written with an equals sign', async () => {
    const { out, code } = await parse(['workflows', 'rollback', 'wf_1', '--version=1'])

    expect(out).not.toContain(CLI_VERSION)
    expect(code).toBe('commander.error')
  })

  /**
   * The value-taking form was caught; the bare one was not, so the same command
   * one keystroke shorter still printed a version and exited `0`.
   */
  it('refuses the bare flag typed against a subcommand', async () => {
    const { out, code } = await parse(['workflows', 'rollback', 'wf_1', '--version'])

    expect(out).not.toContain(CLI_VERSION)
    expect(code).toBe('commander.error')
  })

  /** A root option's value is not the command name, even when it looks like one. */
  it('still reports the version after a root option', async () => {
    const { out, code } = await parse(['--profile', 'workflows', '--version'])

    expect(out.trim()).toBe(CLI_VERSION)
    expect(code).toBe('commander.version')
  })

  /** `[unused]` was a user-visible placeholder that read like a mistake. */
  it('does not offer a value placeholder that reads as unintended', () => {
    const help = buildProgram().helpInformation().replace(/\s+/g, ' ')

    expect(help).not.toContain('[unused]')
    expect(help).toContain('takes no value')
  })
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

  it('refuses a command the group never had', async () => {
    const { code } = await parse(['chat-deployments', 'get', '--help'])

    expect(code).toBe('commander.unknownCommand')
  })

  it('refuses it at the root', async () => {
    const { code } = await parse(['zzzz', '--help'])

    expect(code).toBe('commander.unknownCommand')
  })

  it('still answers help for a group and for its commands', async () => {
    const group = await parse(['workspaces', '--help'])
    expect(group.code).toBe('commander.helpDisplayed')
    expect(group.out).toContain('Usage: sim workspaces')

    const leaf = await parse(['workspaces', 'get', '--help'])
    expect(leaf.code).toBe('commander.helpDisplayed')
    expect(leaf.out).toContain('Usage: sim workspaces get')
  })

  /**
   * `files restore <fileId>` is the only command in the tree that hosts a
   * subcommand and takes an operand of its own, so it is the only one the guard
   * has to step around — and it earns that with the registered positional, not
   * by acting on its own.
   */
  it('leaves the one command that legitimately takes an operand alone', async () => {
    expect((await parse(['files', 'restore', 'wf_1', '--help'])).code).toBe(
      'commander.helpDisplayed'
    )
  })

  /**
   * `profiles` acts on its own but takes no operand, and the exclusion covered
   * it anyway: `sim profiles zzznope --help` answered `0` where every other
   * group answers `1`, and without the flag it printed the profile table.
   */
  it('refuses an unknown operand under profiles, with and without --help', async () => {
    expect((await parse(['profiles', 'zzznope', '--help'])).code).toBe('commander.unknownCommand')
    expect((await parse(['profiles', 'zzznope'])).code).toBe('commander.unknownCommand')
  })

  it('still answers help for profiles and for its commands', async () => {
    const group = await parse(['profiles', '--help'])
    expect(group.code).toBe('commander.helpDisplayed')
    expect(group.out).toContain('Usage: sim profiles')

    const leaf = await parse(['profiles', 'add', '--help'])
    expect(leaf.code).toBe('commander.helpDisplayed')
    expect(leaf.out).toContain('Usage: sim profiles add')

    // `help` is commander's implicit command rather than a registered one, so
    // it is the operand the unknown-command check is most likely to mistake for
    // a typo.
    const implicit = await parse(['profiles', 'help', 'add'])
    expect(implicit.code).toBe('commander.help')
    expect(implicit.out).toContain('Usage: sim profiles add')
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

  /**
   * The positive half, and the one that matters: without it the hook can be
   * deleted from `buildProgram` and every other test still passes.
   *
   * It asserts registration rather than a resulting request, because the check
   * suppresses itself when it is running from a checkout — and inside this
   * suite `import.meta.url` IS a checkout, so the behavioural path is
   * unreachable here by construction. That path is covered directly in
   * check.test.ts and walked against the real registry from a staged global
   * install before release.
   */
  it('registers the update check as a root preAction hook', async () => {
    const program = buildProgram()
    const preAction = preActionHooks(program)

    expect(preAction).toHaveLength(1)
    await expect(preAction[0](program, program)).resolves.toBeUndefined()
  })
})
