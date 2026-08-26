/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec } from '../contract/types'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { formatApiErrorDetails, SimApiError } from '../http/client'
import { retypeApiError } from './naming'
import type { OperationSpec } from './types'

function retype(operation: V2OperationName, error: unknown): SimApiError {
  return retypeApiError(
    error,
    operation,
    (CLI_CONTRACT[operation] ?? {}) as CommandSpec,
    V2_OPERATIONS[operation] as unknown as OperationSpec
  ) as SimApiError
}

function detailLines(operation: V2OperationName, details: unknown): string[] {
  return formatApiErrorDetails(
    retype(operation, new SimApiError('Invalid request', 400, 'BAD_REQUEST', details)).details
  )
}

/**
 * The server names its own fields, which is right for an OpenAPI reader and
 * untypeable in a terminal: `drop includeJobRuns` names no flag the CLI has.
 */
describe('a validation error restated in the spellings a caller can type', () => {
  it('names the flag in both the message and the details', () => {
    const message =
      'sortBy: only "startedAt" can order job runs; drop includeJobRuns or sort by "startedAt"'
    const error = new SimApiError(message, 400, 'BAD_REQUEST', [{ path: ['sortBy'], message }])

    const retyped = retype('listLogs', error)
    expect(retyped.message).toContain('drop --include-job-runs')
    expect(retyped.message).toContain('--sort-by')
    expect(retyped.message).not.toMatch(/\bincludeJobRuns\b/)
    expect(detailLines('listLogs', error)[1]).toContain('--sort-by')
  })

  /**
   * The requirement that a mechanical kebab-casing fails: the flag for
   * `folderPath` is `--folder`, so translating the wire name by rule would
   * print a flag that does not exist.
   */
  it('resolves the spelling through the contract, not by kebab-casing', () => {
    const line = detailLines('listWorkflows', [
      { path: ['folderPath'], message: 'Path must be a canonical folder path' },
    ])[1]

    expect(line).toContain('--folder:')
    expect(line).not.toContain('--folder-path')
    expect(line).not.toContain('folderPath')
  })

  it('leaves an English word that happens to be a field name alone', () => {
    const message = 'startDate must name a storable instant; there is no year 0000'
    const retyped = retype(
      'listLogs',
      new SimApiError(message, 400, 'BAD_REQUEST', [{ path: ['startDate'], message }])
    )

    expect(retyped.message).toBe('--start-date must name a storable instant; there is no year 0000')
    expect(retyped.message).not.toContain('--name')
  })

  it('names the global flag the workspace comes from', () => {
    expect(
      detailLines('listLogs', [{ path: ['workspaceId'], message: 'Workspace is required' }])[1]
    ).toContain('--workspace:')
  })

  it('translates only the head of a path into a JSON value the caller wrote', () => {
    const line = detailLines('queryRows', [
      { path: ['predicate', 'all', '0', 'op'], message: 'Unsupported operator' },
    ])[1]

    // `predicate` is typed `--filter`, so even the head is not a kebab-cased
    // wire name — and only the head is translated.
    expect(line).toContain('--filter.all.0.op:')
  })

  it('leaves a CLI-raised error and a non-API throw byte-identical', () => {
    const local = new SimApiError('--limit must be a whole number of 0 or more', 0)
    expect(retype('listLogs', local)).toBe(local)

    const other = new Error('sortBy is not a flag')
    expect(
      retypeApiError(other, 'listLogs', {}, V2_OPERATIONS.listLogs as unknown as OperationSpec)
    ).toBe(other)
  })
})
