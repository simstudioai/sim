/**
 * @vitest-environment node
 */
import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { buildProgram } from './program'
import { CLI_VERSION } from './version'

/** Parses argv against a program whose output and exits are captured, not taken. */
async function parse(argv: string[]): Promise<{ out: string; code: string | null }> {
  const program = buildProgram()
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
   * Both exclusions are load-bearing: `files restore` registers a positional
   * while hosting a subcommand, and `profiles` acts on its own, so an operand
   * there is not an unknown command.
   */
  it('leaves a command that legitimately takes an operand alone', async () => {
    expect((await parse(['files', 'restore', 'wf_1', '--help'])).code).toBe(
      'commander.helpDisplayed'
    )
    expect((await parse(['profiles', 'zzzz', '--help'])).code).toBe('commander.helpDisplayed')
  })
})
