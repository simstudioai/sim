/**
 * @vitest-environment node
 */
import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { addOperationOptions } from './options'
import type { OperationSpec } from './types'

const DELETE_TABLE: OperationSpec = {
  method: 'DELETE',
  path: '/api/v2/tables/{tableId}',
  pathParams: ['tableId'],
}

function confirmHelp(): string {
  const command = new Command('delete')
  addOperationOptions(
    command,
    'deleteTable',
    { confirm: 'This deletes the table and all of its rows.' },
    DELETE_TABLE
  )
  return command.helpInformation()
}

describe('the --yes flag on a destructive command', () => {
  /**
   * `executeOperation` throws unless `--yes` is present, whether or not stdin is
   * a terminal — nothing anywhere prompts. Advertising a confirmation to skip
   * described a question the CLI never asks.
   */
  it('describes itself as the confirmation, not as skipping one', () => {
    const help = confirmHelp()
    expect(help).toMatch(/-y, --yes\s+Confirm this destructive operation \(required\)/)
    expect(help).not.toMatch(/skip/i)
    expect(help).not.toMatch(/prompt/i)
  })
})
