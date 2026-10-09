import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import {
  classifyFailure,
  markDeliberateFailure,
  markFailureKind,
  markFailureLogged,
  wasFailureLogged,
} from '@/lib/core/errors/failure-log'
import { RetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import { HostedKeyRateLimitedError, HostedKeyUnavailableError } from '@/tools/errors'

describe('classifyFailure', () => {
  it('keeps a database failure internal even beneath a user mark', () => {
    const queryError = new DrizzleQueryError('select 1', [], new Error('connection reset'))
    const wrapped = markFailureKind(new Error('Block failed', { cause: queryError }), 'user')
    expect(classifyFailure(wrapped)).toBe('internal')
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

  it('leaves an unattributed failure internal', () => {
    expect(classifyFailure(new Error('something broke'))).toBe('internal')
    expect(classifyFailure('a thrown string')).toBe('internal')
  })

  it('terminates on a cyclic cause chain', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.assign(first, { cause: second })
    expect(classifyFailure(first)).toBe('internal')
    expect(wasFailureLogged(first)).toBe(false)
  })
})

describe('markDeliberateFailure', () => {
  it('attributes a plain Error but not a TypeError raised by a bug in the same code', () => {
    expect(classifyFailure(markDeliberateFailure(new Error('channel_not_found'), 'user'))).toBe(
      'user'
    )
    expect(classifyFailure(markDeliberateFailure(new TypeError('x is undefined'), 'user'))).toBe(
      'internal'
    )
  })
})

describe('wasFailureLogged', () => {
  it('marks a frozen error, which a property write would throw on', () => {
    const frozen = Object.freeze(new Error('frozen'))
    markFailureLogged(frozen)
    markFailureKind(frozen, 'user')
    expect(wasFailureLogged(frozen)).toBe(true)
    expect(classifyFailure(frozen)).toBe('user')
  })

  it('does not treat an unrelated error as logged', () => {
    markFailureLogged(new Error('logged elsewhere'))
    expect(wasFailureLogged(new Error('fresh'))).toBe(false)
  })
})
