/**
 * @vitest-environment node
 */
import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../program'
import { searchCommands } from './search'

function searchCommandOf(program: Command): Command {
  const search = program.commands
    .find((command) => command.name() === 'cli')
    ?.commands.find((command) => command.name() === 'search')
  if (!search) throw new Error('cli search is not registered')
  return search
}

function searchReal(query: string) {
  const program = buildProgram()
  return searchCommands(program, query, searchCommandOf(program))
}

describe('sim cli search', () => {
  it.each([
    ['cancel a running workflow', 'sim workflows runs cancel'],
    ['add a column to a table', 'sim tables columns create'],
    ['who am i logged in as', 'sim whoami'],
    ['delete a knowledge base document', 'sim knowledge documents delete'],
    ['workflw deploy', 'sim workflows deploy'],
    ['store an environment variable', 'sim secrets set'],
    ['switch workspace', 'sim configure'],
    ['edit workflow blocks', 'sim workflows operations apply'],
    ['how much have i spent', 'sim billing status'],
  ])('ranks the intended command first for "%s"', (query, expected) => {
    expect(searchReal(query)[0]?.command).toBe(expected)
  })

  it('returns at most five compact matches', () => {
    const results = searchReal('workflow')

    expect(results).toHaveLength(5)
    for (const result of results) expect(Object.keys(result).sort()).toEqual(['command', 'summary'])
  })

  it('never offers itself, or its group as if it were a command', () => {
    const commands = searchReal('cli search find command task').map((r) => r.command)

    expect(commands).not.toContain('sim cli search')
    expect(commands).not.toContain('sim cli')
  })

  /** Prefix matching on `a` or `i` would otherwise match most of the index. */
  it('finds nothing for a query made only of filler words', () => {
    expect(searchReal('how do i')).toEqual([])
  })

  it('indexes leaves only, skipping hidden commands and flags', () => {
    const program = new Command('sim')
    const group = program.command('widgets').description('Manage widgets')
    group.command('list').description('List widgets')
    group.command('purge', { hidden: true }).description('Purge widgets')
    group
      .command('rename')
      .description('Rename a widget')
      .addOption(new Command().createOption('--frobnicate', 'Secret knob').hideHelp())

    expect(searchCommands(program, 'purge', new Command())).toEqual([])
    expect(searchCommands(program, 'frobnicate', new Command())).toEqual([])
    expect(searchCommands(program, 'widgets', new Command()).map((r) => r.command)).toEqual(
      expect.arrayContaining(['sim widgets list', 'sim widgets rename'])
    )
    expect(searchCommands(program, 'manage', new Command()).map((r) => r.command)).not.toContain(
      'sim widgets'
    )
  })
})

describe('a trailing qualifier', () => {
  it('is shown but not ranked', () => {
    const program = new Command('sim')
    const widgets = program.command('widgets')
    widgets
      .command('delete')
      .description('Delete a widget (OAuth login or personal API key required)')
    widgets.command('read').description('Read a widget')

    expect(searchCommands(program, 'login', new Command())).toEqual([])
    expect(searchCommands(program, 'delete widget', new Command())[0]).toEqual({
      command: 'sim widgets delete',
      summary: 'Delete a widget (OAuth login or personal API key required)',
    })
  })
})

describe('the agent discovery note', () => {
  function helpOf(argv: string[], env: NodeJS.ProcessEnv): string {
    const program = buildProgram({ env })
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
      program.parse(['node', 'sim', ...argv])
    } catch {}
    return out
  }

  it('leads root and group help when an agent runs the CLI', () => {
    expect(helpOf(['--help'], { CLAUDECODE: '1' })).toMatch(/^=== AGENT COMMAND DISCOVERY ===/)
    expect(helpOf(['workflows', '--help'], { CLAUDECODE: '1' })).toContain('sim cli search')
  })

  it('stays off leaf help, where the command is already found', () => {
    expect(helpOf(['workflows', 'runs', 'get', '--help'], { CLAUDECODE: '1' })).not.toContain(
      'AGENT COMMAND DISCOVERY'
    )
  })

  it('is never shown to a person', () => {
    expect(helpOf(['--help'], {})).not.toContain('AGENT COMMAND DISCOVERY')
  })
})
