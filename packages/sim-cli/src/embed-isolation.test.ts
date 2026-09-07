import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from './embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }
afterEach(() => vi.restoreAllMocks())

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
})
