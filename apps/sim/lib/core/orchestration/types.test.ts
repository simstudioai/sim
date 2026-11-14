import { describe, expect, it } from 'vitest'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import {
  asOrchestrationError,
  isUnavailableFailure,
  messageForOrchestrationError,
  OrchestrationError,
  statusForOrchestrationError,
  throwOrchestrationFailure,
} from '@/lib/core/orchestration/types'

const RAW_DRIVER_MESSAGE =
  'insert into "workflow" ("id") values ($1) - duplicate key value violates unique constraint "workflow_pkey"'

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

describe('asOrchestrationError', () => {
  it('classifies an egress routing failure deep in a cause chain as a 503 without its routing code', () => {
    const wrapped = new Error('Failed query: select ...', {
      cause: new Error('token exchange failed', {
        cause: new OutboundRoutingError('GATEWAY_UNAVAILABLE'),
      }),
    })

    const classified = asOrchestrationError(wrapped)

    expect(classified?.code).toBe('unavailable')
    expect(statusForOrchestrationError(classified?.code)).toBe(503)
    expect(classified?.message).toBe("The organization's egress route is unavailable")
    expect(classified?.message).not.toContain('GATEWAY_UNAVAILABLE')
    expect(classified?.cause).toMatchObject({ code: 'GATEWAY_UNAVAILABLE' })
  })

  it('leaves a missing outbound scope unclassified rather than a retryable outage', () => {
    const wrapped = new Error('sync failed', { cause: new OutboundRoutingError('MISSING_SCOPE') })

    expect(asOrchestrationError(wrapped)).toBeNull()
    expect(isUnavailableFailure(wrapped)).toBe(false)
  })
})
