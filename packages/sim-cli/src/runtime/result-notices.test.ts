import { describe, expect, it } from 'vitest'
import { runEmbeddedCli } from '../embed'

/**
 * What the CLI adds to a successful result, read the way an agent reads it: `--output json` with
 * stderr merged into the capture (`2>&1`), which has to stay one parseable document. An embedded
 * run always answers in JSON; a person's table is covered in `result.test.ts`.
 */

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

function run(argv: string[], body: unknown) {
  return runEmbeddedCli(argv, { ...identity, transport: async () => Response.json(body) })
}

/** stdout and stderr as one capture, the way `2>&1` hands them to a parser. */
function merged(result: { stdout: string; stderr: string }): unknown {
  return JSON.parse(result.stdout + result.stderr)
}

describe('a successful result the CLI states something about', () => {
  it.each([
    {
      what: 'a single result the server clipped',
      argv: ['files', 'read', 'file_1'],
      body: { data: { fileId: 'file_1', name: 'a.txt', text: 'abc', truncated: true } },
      shown: { fileId: 'file_1', name: 'a.txt', text: 'abc', truncated: true },
    },
    {
      what: 'a page whose envelope scopes the whole list',
      argv: ['billing', 'logs'],
      body: { data: [{ id: 'log_1', creditCost: 2 }], nextCursor: null, scope: 'user' },
    },
    {
      what: 'a page the server clipped',
      argv: ['workflow-mcp-servers', 'list'],
      body: { data: [{ id: 'mcp_1', toolCount: 40 }], nextCursor: null, toolNamesTruncated: true },
    },
  ])(
    'keeps $what one JSON document under 2>&1, carrying the fact',
    async ({ argv, body, shown }) => {
      const result = await run([...argv, '--output', 'json'], body)
      expect(result.exitCode).toBe(0)
      expect(merged(result)).toEqual(shown ?? body)
    }
  )
})

describe('a command reached by its renamed spellings', () => {
  const argv = ['tables', 'rows', 'find', 'tbl_1', '--q', 'needle']
  const answer = { data: { matches: [], truncated: false } }
  const COMMAND_RENAMED =
    'command "sim tables rows find" has been renamed to "sim tables rows search". The old name still works.'
  const FLAG_RENAMED = 'flag "--q" has been renamed to "--query". The old name still works.'

  it('carries both warnings in the JSON result as one note, so 2>&1 still parses', async () => {
    const result = await run([...argv, '--output', 'json'], answer)
    expect(result.exitCode).toBe(0)
    expect(merged(result)).toEqual({
      matches: [],
      truncated: false,
      note: `${COMMAND_RENAMED}\n${FLAG_RENAMED}`,
    })
  })

  it('still warns on stderr when a successful answer cannot be printed', async () => {
    const result = await run([...argv, '--output', 'json'], { data: { matches: 'not a list' } })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`warning: ${COMMAND_RENAMED}\nwarning: ${FLAG_RENAMED}\n`)
  })

  it('still warns on stderr when the command fails before it has a result', async () => {
    const result = await runEmbeddedCli([...argv, '--output', 'json'], {
      ...identity,
      transport: async () =>
        Response.json({ error: { code: 'NOT_FOUND', message: 'No such table' } }, { status: 404 }),
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`warning: ${COMMAND_RENAMED}\nwarning: ${FLAG_RENAMED}\n`)
  })
})
