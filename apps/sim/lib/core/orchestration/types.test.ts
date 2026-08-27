/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  messageForOrchestrationError,
  OrchestrationError,
  statusForOrchestrationError,
  throwOrchestrationFailure,
} from '@/lib/core/orchestration/types'

const RAW_DRIVER_MESSAGE =
  'insert into "workflow" ("id") values ($1) - duplicate key value violates unique constraint "workflow_pkey"'

describe('statusForOrchestrationError', () => {
  it.each([
    ['validation', 400],
    ['not_found', 404],
    ['conflict', 409],
    ['internal', 500],
    [undefined, 500],
  ] as const)('maps %s to %i', (code, expected) => {
    expect(statusForOrchestrationError(code)).toBe(expected)
  })
})

describe('messageForOrchestrationError', () => {
  it('withholds the message of an explicitly internal failure', () => {
    expect(
      messageForOrchestrationError(
        { error: RAW_DRIVER_MESSAGE, errorCode: 'internal' },
        'Failed to create workflow'
      )
    ).toBe('Failed to create workflow')
  })

  it('withholds the message of a failure carrying no code', () => {
    expect(
      messageForOrchestrationError({ error: RAW_DRIVER_MESSAGE }, 'Failed to create workflow')
    ).toBe('Failed to create workflow')
  })

  it('returns a classified failure message to the caller', () => {
    expect(
      messageForOrchestrationError(
        { error: 'Workflow name is already taken', errorCode: 'conflict' },
        'Failed to create workflow'
      )
    ).toBe('Workflow name is already taken')
  })

  it('falls back when a classified failure carries no message', () => {
    expect(
      messageForOrchestrationError({ errorCode: 'conflict' }, 'Failed to create workflow')
    ).toBe('Failed to create workflow')
  })
})

describe('throwOrchestrationFailure', () => {
  it('classifies an uncoded failure as internal without rendering its message', () => {
    try {
      throwOrchestrationFailure({ error: RAW_DRIVER_MESSAGE }, 'Failed to update workflow')
      expect.unreachable('expected throwOrchestrationFailure to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationError)
      expect((error as OrchestrationError).code).toBe('internal')
      expect((error as OrchestrationError).message).toBe('Failed to update workflow')
    }
  })

  it('preserves the code and message of a classified failure', () => {
    try {
      throwOrchestrationFailure(
        { error: 'No such workflow', errorCode: 'not_found' },
        'Failed to delete workflow'
      )
      expect.unreachable('expected throwOrchestrationFailure to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationError)
      expect((error as OrchestrationError).code).toBe('not_found')
      expect((error as OrchestrationError).message).toBe('No such workflow')
    }
  })
})
