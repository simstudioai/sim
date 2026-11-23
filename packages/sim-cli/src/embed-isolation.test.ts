import { describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from './embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

describe('embedded CLI output ownership', () => {
  it('leaves host logging and process functions untouched through parallel streamed calls', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = process.exit
    try {
      const results = await Promise.all(
        ['first', 'second'].map((name) =>
          runEmbeddedCli(['files', 'get', name], {
            ...identity,
            transport: async () => {
              console.log('host request %s', name)
              await Promise.resolve()
              console.error('host diagnostic %s', name)
              return new Response(
                new ReadableStream<Uint8Array>({
                  async start(controller) {
                    await Promise.resolve()
                    process.stdout.write('host stream output')
                    process.stderr.write('host stream diagnostic')
                    controller.enqueue(Buffer.from(JSON.stringify({ name })))
                    controller.close()
                  },
                }),
                { headers: { 'content-type': 'application/json' } }
              )
            },
          })
        )
      )
      expect(results).toEqual(
        ['first', 'second'].map((name) => ({
          exitCode: 0,
          stdout: JSON.stringify({ name }),
          stderr: '',
        }))
      )
      expect(console.log).toBe(log)
      expect(console.error).toBe(error)
      expect(process.stdout.write).toBe(stdout)
      expect(process.stderr.write).toBe(stderr)
      expect(process.exit).toBe(exit)
      expect(log).toHaveBeenCalledTimes(2)
      expect(error).toHaveBeenCalledTimes(2)
      expect(stdout).toHaveBeenCalledWith('host stream output')
      expect(stderr).toHaveBeenCalledWith('host stream diagnostic')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('keeps a download adapter diagnostic outside the CLI JSON result', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await runEmbeddedCli(
      ['files', 'get', 'file', '--output-file', 'saved.json'],
      { ...identity, transport: async () => new Response('{}') },
      {
        writeFile: async (_path, stream) => {
          console.log('host saving file')
          await new Response(stream).text()
          console.log('host file saved')
        },
      }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ path: 'saved.json', status: 'saved' })
    expect(log).toHaveBeenCalledTimes(2)
    expect(result.stderr).toBe('')
  })

  it('captures subcommand help and usage errors through Commander output configuration', async () => {
    const [help, invalid] = await Promise.all([
      runEmbeddedCli(['files', 'get', '--help'], identity),
      runEmbeddedCli(['files', 'get'], identity),
    ])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('Usage:')
    expect(help.stderr).toBe('')
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stdout).toBe('')
    expect(invalid.stderr).toContain('missing required argument')
  })

  it('answers a guessed flag with the command flags, and an id that opens with a dash with the escape', async () => {
    const transport = async () => {
      throw new Error('a parse error must not reach the API')
    }
    const [guessed, dashedId, noArguments, noOptions] = await Promise.all([
      runEmbeddedCli(['tables', 'rows', 'batch-delete', 'tbl_1', '--ids', 'row_1', '--yes'], {
        ...identity,
        transport,
      }),
      runEmbeddedCli(['audit-logs', 'get', '-X9abc'], { ...identity, transport }),
      runEmbeddedCli(['logs', 'list', '-X9abc'], { ...identity, transport }),
      runEmbeddedCli(['workspaces', 'get', 'ws_1', '--verbose'], { ...identity, transport }),
    ])
    expect(guessed.exitCode).toBe(1)
    expect(guessed.stderr).toContain("unknown option '--ids'")
    expect(guessed.stderr).toContain('Options for sim tables rows batch-delete:')
    expect(guessed.stderr).toContain('--row <value...>')
    expect(dashedId.exitCode).toBe(1)
    expect(dashedId.stderr).toContain('Example: sim audit-logs get -- -X9abc')
    expect(dashedId.stderr).not.toContain('Options for')
    // With no positional to escape into, an id-shaped token is just an unknown option.
    expect(noArguments.exitCode).toBe(1)
    expect(noArguments.stderr).toContain('Options for sim logs list:')
    expect(noArguments.stderr).not.toContain('Example:')
    // An empty list reads as truncated output rather than as an answer.
    expect(noOptions.exitCode).toBe(1)
    expect(noOptions.stderr).toContain('sim workspaces get takes no options.')
    expect(noOptions.stderr).not.toContain('Options for')
  })

  it('answers a value typed where a flag belongs with the command line that takes it', async () => {
    const transport = async () => {
      throw new Error('a parse error must not reach the API')
    }
    const [renamed, kbAsPositional, queryAsPositional, siblingFlag, handWritten] =
      await Promise.all([
        runEmbeddedCli(['files', 'rename', 'wf_1', 'report.pdf'], { ...identity, transport }),
        runEmbeddedCli(['knowledge', 'search', 'kb_1', '--query', 'leave'], {
          ...identity,
          transport,
        }),
        runEmbeddedCli(['knowledge', 'search', 'leave policy', '--kb', 'kb_1'], {
          ...identity,
          transport,
        }),
        runEmbeddedCli(['tables', 'rows', 'list', 'tbl_1', '--filter', '{}'], {
          ...identity,
          transport,
        }),
        runEmbeddedCli(['files', 'upload', 'a.png', '--path', 'files/a.png'], {
          ...identity,
          transport,
        }),
      ])
    expect(renamed.exitCode).toBe(1)
    expect(renamed.stderr).toContain('"report.pdf" was passed as a positional; pass it as --name')
    expect(renamed.stderr).toContain('Example: sim files rename <fileId> --name <value>')
    expect(kbAsPositional.stderr).toContain('"kb_1" was passed as a positional; pass it as --kb')
    expect(queryAsPositional.exitCode).toBe(1)
    expect(queryAsPositional.stderr).toContain('Example: sim knowledge search --kb <value...>')
    expect(queryAsPositional.stderr).toContain('Options for sim knowledge search:')
    expect(siblingFlag.stderr).toContain('--filter is an option of:\n')
    expect(siblingFlag.stderr).toContain(
      '  sim tables rows query — Query rows with a filter and sort'
    )
    expect(handWritten.exitCode).toBe(1)
    expect(handWritten.stderr).toContain('Options for sim files upload:')
  })

  it('names the shape a body variant received and the flag that takes it', async () => {
    const transport = async () => {
      throw new Error('a shape error must not reach the API')
    }
    const [wrapped, oneRow, rowList] = await Promise.all([
      runEmbeddedCli(['tables', 'rows', 'create', 'tbl_1', '--rows', '{"rows":[{"a":1}]}'], {
        ...identity,
        transport,
      }),
      runEmbeddedCli(['tables', 'rows', 'create', 'tbl_1', '--rows', '{"a":1}'], {
        ...identity,
        transport,
      }),
      runEmbeddedCli(['tables', 'rows', 'create', 'tbl_1', '--data', '[{"a":1}]'], {
        ...identity,
        transport,
      }),
    ])
    expect(wrapped.exitCode).toBe(1)
    expect(wrapped.stderr).toContain(`e.g. --rows '[{"key":"value"}]'; got a JSON object`)
    expect(wrapped.stderr).toContain('Pass the array under its "rows" key itself')
    expect(oneRow.stderr).toContain('For that shape use --data.')
    expect(rowList.stderr).toContain('--data must be a JSON object')
    expect(rowList.stderr).toContain('For that shape use --rows.')
  })
})
