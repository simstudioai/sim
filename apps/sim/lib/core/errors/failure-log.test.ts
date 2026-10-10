import { createLogger } from '@sim/logger'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import {
  classifyFailure,
  inheritFailureMarks,
  logFailureOnce,
  markFailureKind,
  markFailureLogged,
} from '@/lib/core/errors/failure-log'
import { RetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import { UserFailure } from '@/lib/core/errors/user-failure'
import { CredentialRevokedError } from '@/lib/oauth/credential-revoked'
import { HostedKeyRateLimitedError, HostedKeyUnavailableError } from '@/tools/errors'

const logger = createLogger('FailureLogTest')

/** What an outer boundary does with the failure: the kind it logs at, or undefined when it skips. */
function outerBoundary(error: unknown, executionId?: string) {
  return logFailureOnce(logger, 'probe', error, { executionId })
}

describe('classifyFailure', () => {
  it('keeps a database failure internal even beneath a user mark', () => {
    const queryError = new DrizzleQueryError('select 1', [], new Error('connection reset'))
    const wrapped = markFailureKind(new Error('Block failed', { cause: queryError }), 'user')
    expect(classifyFailure(wrapped)).toBe('internal')
  })

  it('keeps a retryable setup failure internal even beneath a marked wrapper', () => {
    const setup = new RetryableSetupError('setup')
    expect(classifyFailure(markFailureKind(new Error('wrapped', { cause: setup }), 'user'))).toBe(
      'internal'
    )
  })

  it('keeps a retryable setup failure internal even when its cause was the author’s', () => {
    const cause = markFailureKind(new Error('missing field'), 'user')
    expect(classifyFailure(new RetryableSetupError('setup', { cause }))).toBe('internal')
  })

  it.each([
    [
      'Sim refusing for the workspace’s own rate bucket',
      new HostedKeyRateLimitedError('slow'),
      'user',
    ],
    ['Sim having no hosted key to serve', new HostedKeyUnavailableError('none'), 'internal'],
  ] as const)('reads a Sim HttpError status: %s', (_name, error, kind) => {
    expect(classifyFailure(error)).toBe(kind)
  })

  it('lets an explicit mark on an outer link override an upstream status beneath it', () => {
    const upstream = Object.assign(new Error('Unauthorized'), { status: 401 })
    const ours = markFailureKind(new Error('hosted key rejected', { cause: upstream }), 'internal')
    expect(classifyFailure(ours)).toBe('internal')
    expect(classifyFailure(upstream)).toBe('third_party_client')
  })

  it('attributes a revoked OAuth credential to its owner, not to Sim', () => {
    const revoked = new CredentialRevokedError('Reconnect your account')
    expect(classifyFailure(new Error('Tool failed', { cause: revoked }))).toBe('user')
  })

  it('leaves an unattributed failure internal', () => {
    expect(classifyFailure(new Error('something broke'))).toBe('internal')
    expect(classifyFailure('a thrown string')).toBe('internal')
  })

  it('terminates on a cyclic cause chain', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.assign(first, { cause: second })
    expect(outerBoundary(first)).toBe('internal')
  })
})

describe('inheritFailureMarks', () => {
  it('carries the logged mark and attribution across a boundary that drops cause', () => {
    const logged = new Error('child failed')
    markFailureLogged(logged)
    const boundary = inheritFailureMarks(new Error('Custom block execution failed'), logged)
    expect(outerBoundary(boundary)).toBeUndefined()
    expect(classifyFailure(boundary)).toBe('internal')

    const authored = inheritFailureMarks(new Error('wrapped'), new UserFailure('missing input'))
    expect(outerBoundary(authored)).toBe('user')
  })
})

describe('logFailureOnce', () => {
  it('marks a frozen error, which a property write would throw on', () => {
    const frozen = Object.freeze(new Error('frozen'))
    markFailureLogged(frozen)
    markFailureKind(frozen, 'user')
    expect(outerBoundary(frozen)).toBeUndefined()
    expect(classifyFailure(frozen)).toBe('user')
  })

  it('does not treat an unrelated error as logged', () => {
    markFailureLogged(new Error('logged elsewhere'))
    expect(outerBoundary(new Error('fresh'))).toBe('internal')
  })

  it('scopes a raw value logged at an execution boundary to that execution only', () => {
    const persistentFault = new Error('module failed to load')
    expect(outerBoundary(persistentFault, 'exec-1')).toBe('internal')

    expect(outerBoundary(persistentFault, 'exec-1')).toBeUndefined()
    expect(outerBoundary(persistentFault, 'exec-2')).toBe('internal')
    expect(outerBoundary(persistentFault)).toBe('internal')
    expect(outerBoundary(persistentFault, '')).toBe('internal')
  })

  it('logs one persistent value once in each of two overlapping executions', () => {
    const persistentFault = new Error('module failed to load')
    expect(outerBoundary(persistentFault, 'exec-a')).toBe('internal')
    expect(outerBoundary(persistentFault, 'exec-b')).toBe('internal')

    expect(outerBoundary(persistentFault, 'exec-a')).toBeUndefined()
    expect(outerBoundary(persistentFault, 'exec-b')).toBeUndefined()
  })
})
