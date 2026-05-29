/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveMx, envRef } = vi.hoisted(() => ({
  mockResolveMx: vi.fn(),
  envRef: {
    BLOCKED_EMAIL_MX_HOSTS: undefined as string | undefined,
    DISABLE_SIGNUP_MX_VALIDATION: false,
  },
}))

vi.mock('dns/promises', () => ({
  default: { resolveMx: mockResolveMx },
}))

vi.mock('@/lib/core/config/env', () => ({
  get env() {
    return envRef
  },
}))

import { validateSignupEmailMx } from '@/lib/messaging/email/validation.server'

const mx = (...hosts: string[]) =>
  hosts.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }))

describe('validateSignupEmailMx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envRef.BLOCKED_EMAIL_MX_HOSTS = undefined
    envRef.DISABLE_SIGNUP_MX_VALIDATION = false
  })

  it('blocks the known shared spam backend 215.im', async () => {
    mockResolveMx.mockResolvedValue(mx('smtp.215.im'))
    const result = await validateSignupEmailMx('simuser_abc@lyi25swr.cn')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('blocked_mx_backend')
  })

  it('blocks gravityengine.cc backend', async () => {
    mockResolveMx.mockResolvedValue(mx('email.gravityengine.cc'))
    const result = await validateSignupEmailMx('x@acgfun.eu.org')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('blocked_mx_backend')
  })

  it('allows a legitimate domain (gmail)', async () => {
    mockResolveMx.mockResolvedValue(
      mx('gmail-smtp-in.l.google.com', 'alt1.gmail-smtp-in.l.google.com')
    )
    const result = await validateSignupEmailMx('real.person@gmail.com')
    expect(result.allowed).toBe(true)
  })

  it('blocks a domain with no MX records (ENOTFOUND)', async () => {
    mockResolveMx.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))
    const result = await validateSignupEmailMx('x@no-such-domain.invalid')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no_mx')
  })

  it('blocks a domain that resolves to an empty MX set', async () => {
    mockResolveMx.mockResolvedValue([])
    const result = await validateSignupEmailMx('x@empty.example')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no_mx')
  })

  it('fails open on a transient DNS error (does not block legit users)', async () => {
    mockResolveMx.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }))
    const result = await validateSignupEmailMx('user@some-real-domain.com')
    expect(result.allowed).toBe(true)
  })

  it('honors additional backends from BLOCKED_EMAIL_MX_HOSTS', async () => {
    envRef.BLOCKED_EMAIL_MX_HOSTS = 'newbadhost.example'
    mockResolveMx.mockResolvedValue(mx('mx1.newbadhost.example'))
    const result = await validateSignupEmailMx('x@rotated-domain.top')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('blocked_mx_backend')
  })

  it('respects the DISABLE_SIGNUP_MX_VALIDATION kill switch', async () => {
    envRef.DISABLE_SIGNUP_MX_VALIDATION = true
    mockResolveMx.mockResolvedValue(mx('smtp.215.im'))
    const result = await validateSignupEmailMx('simuser_abc@lyi25swr.cn')
    expect(result.allowed).toBe(true)
    expect(mockResolveMx).not.toHaveBeenCalled()
  })

  it('allows when the email has no domain (defers to other validation)', async () => {
    const result = await validateSignupEmailMx('not-an-email')
    expect(result.allowed).toBe(true)
    expect(mockResolveMx).not.toHaveBeenCalled()
  })
})
