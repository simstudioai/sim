/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { partitionSettledFailures, resolveAddEmail } from '@/lib/workspaces/sharing'

describe('resolveAddEmail', () => {
  const ctx = {
    workspaceUserIdByEmail: new Map([
      ['ada@sim.dev', 'user-ada'],
      ['grace@sim.dev', 'user-grace'],
    ]),
    existingMemberEmails: new Set(['grace@sim.dev']),
  }

  it('returns the userId for a workspace member who is not already on the credential', () => {
    expect(resolveAddEmail('ada@sim.dev', ctx)).toEqual({ userId: 'user-ada' })
  })

  it('rejects an email that does not belong to any workspace member', () => {
    expect(resolveAddEmail('nope@sim.dev', ctx)).toEqual({
      error: "nope@sim.dev isn't a member of this workspace",
    })
  })

  it('rejects an email that already has access to the credential', () => {
    expect(resolveAddEmail('grace@sim.dev', ctx)).toEqual({
      error: 'grace@sim.dev already has access',
    })
  })

  it('matches case-insensitively while echoing the original email in errors', () => {
    expect(resolveAddEmail('ADA@Sim.dev', ctx)).toEqual({ userId: 'user-ada' })
    expect(resolveAddEmail('Grace@SIM.dev', ctx)).toEqual({
      error: 'Grace@SIM.dev already has access',
    })
  })
})

describe('partitionSettledFailures', () => {
  const targets = [{ email: 'a' }, { email: 'b' }, { email: 'c' }]

  it('returns no failures when every result is fulfilled', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 3 },
    ]
    expect(partitionSettledFailures(targets, results)).toEqual([])
  })

  it('returns only the rejected targets (index-aligned) on partial failure', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new Error('boom') },
      { status: 'fulfilled', value: 3 },
    ]
    expect(partitionSettledFailures(targets, results)).toEqual([{ email: 'b' }])
  })

  it('returns all targets when every result rejected', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'rejected', reason: new Error('1') },
      { status: 'rejected', reason: new Error('2') },
      { status: 'rejected', reason: new Error('3') },
    ]
    expect(partitionSettledFailures(targets, results)).toEqual(targets)
  })
})
