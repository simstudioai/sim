import { describe, expect, it } from 'vitest'
import * as exitCodes from '../../exit-codes'
import { sourceExitCodesHelp, sourceExitCodesTable } from './source-exit-codes'
import { WORKFLOW_TREE } from './workflow-dir'
import { WORKSPACE_TREE } from './workspace-source-dir'

/**
 * Every code a source command can exit with: each `*_EXIT_CODE` the CLI defines except the
 * run-wait timeout (4), which no source command returns, plus 0 and 1.
 */
const SOURCE_EXIT_CODES = [
  0,
  1,
  ...Object.entries(exitCodes)
    .filter(([name]) => name.endsWith('_EXIT_CODE') && name !== 'STILL_RUNNING_EXIT_CODE')
    .map(([, code]) => code as number),
].sort((a, b) => a - b)

describe('the exit-code tables an agent or a reader relies on', () => {
  it.each([
    ['the workflow directory guide', WORKFLOW_TREE.agents],
    ['the workspace directory guide', WORKSPACE_TREE.agents],
  ])('%s lists every code a source command exits with', (_name, text) => {
    const listed = [...text.matchAll(/^\| (\d+) \|/gm)].map((match) => Number(match[1]))
    expect(listed).toEqual(SOURCE_EXIT_CODES)
  })
})

describe('the locked row of a directory guide', () => {
  const lockedRow = (prefix: Parameters<typeof sourceExitCodesTable>[0]) =>
    sourceExitCodesTable(prefix)
      .split('\n')
      .find((row) => row.startsWith(`| ${exitCodes.SOURCE_LOCKED_EXIT_CODE} |`))

  it('says where a workspace apply unlocks each kind of resource it can find locked', () => {
    expect(lockedRow('sim workspaces source')).toMatch(/a table\b.*a table in its settings/)
    expect(lockedRow('sim workspaces source')).toContain('a workflow in the workflow builder')
  })

  it('sends a workflow apply to the workflow builder', () => {
    expect(lockedRow('sim workflows source')).toContain('unlock it in the workflow builder')
    expect(lockedRow('sim workflows source')).not.toContain('table')
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
