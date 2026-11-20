import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as exitCodes from '../../exit-codes'
import { WORKFLOW_TREE } from './workflow-source-get'
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
