import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as exitCodes from '../../exit-codes'
import { sourceExitCodesHelp } from './source-exit-codes'
import { WORKFLOW_TREE } from './workflow-dir'
import { WORKSPACE_TREE } from './workspace-source-dir'

/**
 * Every code a source command can exit with: each `*_EXIT_CODE` the CLI defines except the
 * run-wait timeout (4), which no source command returns, plus 0, 1 and Ctrl-C's 130.
 */
const SOURCE_EXIT_CODES = [
  0,
  1,
  ...Object.entries(exitCodes)
    .filter(([name]) => name.endsWith('_EXIT_CODE') && name !== 'STILL_RUNNING_EXIT_CODE')
    .map(([, code]) => code as number),
  130,
].sort((a, b) => a - b)

const WORKFLOW_SDK_README = readFileSync(
  join(import.meta.dirname, '../../../../workflow-sdk/README.md'),
  'utf8'
)

const SCRIPTING_DOCS = readFileSync(
  join(import.meta.dirname, '../../../../../apps/docs/content/docs/cli/scripting.mdx'),
  'utf8'
)

/** The codes of each `| Code | <commands> |` table in the scripting docs, by its header cell. */
const DOCS_TABLES = new Map(
  SCRIPTING_DOCS.split(/\n\s*\n/).flatMap((block) => {
    const header = block.match(/^\| Code \| (.+) \|$/m)
    if (!header) return []
    const codes = [...block.matchAll(/^\| `(\d+)` \|/gm)].map((match) => Number(match[1]))
    return [[header[1], codes] as const]
  })
)

function docsTable(heading: string): number[] {
  const codes = DOCS_TABLES.get(heading)
  if (!codes) throw new Error(`scripting.mdx has no exit-code table headed ${heading}`)
  return codes
}

describe('the exit-code tables an agent or a reader relies on', () => {
  it.each([
    ['the workflow directory guide', WORKFLOW_TREE.agents],
    ['the workspace directory guide', WORKSPACE_TREE.agents],
    ['the workflow SDK README', WORKFLOW_SDK_README],
  ])('%s lists every code a source command exits with', (_name, text) => {
    const listed = [...text.matchAll(/^\| (\d+) \|/gm)].map((match) => Number(match[1]))
    expect(listed).toEqual(SOURCE_EXIT_CODES)
  })
})

describe('the exit-code tables of the CLI scripting docs', () => {
  it.each([
    ['workflows source apply', '`sim workflows source apply` or `create`'],
    ['workflows source create', '`sim workflows source apply` or `create`'],
    ['workflows source get', '`sim workflows source get --dir` or `sim workspaces source get`'],
    ['workspaces source get', '`sim workflows source get --dir` or `sim workspaces source get`'],
    ['workspaces source apply', '`sim workspaces source apply`'],
  ] as const)('list every code %s names in its --help', (command, heading) => {
    const help = sourceExitCodesHelp(command).replace(/\s+/g, ' ')
    const named = [...help.matchAll(/(?:: |; )(\d+) /g)].map((match) => Number(match[1]))
    expect(named.length).toBeGreaterThan(0)
    expect(docsTable(heading)).toEqual(expect.arrayContaining(named))
  })

  it('name only codes a source command exits with', () => {
    const sourceTables = [...DOCS_TABLES].filter(([heading]) => heading.includes(' source '))
    expect(sourceTables.length).toBeGreaterThanOrEqual(5)
    for (const [, codes] of sourceTables)
      expect(SOURCE_EXIT_CODES).toEqual(expect.arrayContaining(codes))
  })
})

describe('the exit codes a get names in its --help', () => {
  it.each(['workflows source get', 'workspaces source get'] as const)(
    '%s names exit 13 for a missing or refused login',
    (command) => {
      expect(sourceExitCodesHelp(command).replace(/\s+/g, ' ')).toContain(
        `${exitCodes.AUTH_REQUIRED_EXIT_CODE} not logged in`
      )
    }
  )
})
