/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  bindWorkloadIdentitySubject,
  issueWorkloadIdentitySubject,
  verifyWorkloadIdentitySubject,
  WorkloadIdentitySubjectError,
} from '@/lib/credentials/workload-identity/subject'

const owner = { workspaceId: 'ws-1' }
const now = Date.UTC(2026, 10, 6)

describe('workload identity subjects', () => {
  it('accepts the subject and proof Sim issued to this person for this workspace', () => {
    const grant = issueWorkloadIdentitySubject('aws', owner, 'user-1', now)

    expect(grant.subject).toMatch(/^sim:workspace:ws-1:credential:[A-Za-z0-9_-]+$/)
    expect(() =>
      verifyWorkloadIdentitySubject('aws', owner, 'user-1', grant.subject, grant.subjectProof, now)
    ).not.toThrow()
  })

  it('refuses another member reusing a subject they learned from a trust policy', () => {
    const victim = issueWorkloadIdentitySubject('aws', owner, 'user-1', now)
    const attacker = issueWorkloadIdentitySubject('aws', owner, 'user-2', now)

    expect(() =>
      verifyWorkloadIdentitySubject(
        'aws',
        owner,
        'user-2',
        victim.subject,
        attacker.subjectProof,
        now
      )
    ).toThrow(WorkloadIdentitySubjectError)
    expect(() =>
      verifyWorkloadIdentitySubject(
        'aws',
        owner,
        'user-2',
        victim.subject,
        victim.subjectProof,
        now
      )
    ).toThrow(WorkloadIdentitySubjectError)
  })

  it('refuses a proof presented in another workspace', () => {
    const grant = issueWorkloadIdentitySubject('aws', owner, 'user-1', now)

    expect(() =>
      verifyWorkloadIdentitySubject(
        'aws',
        { workspaceId: 'ws-2' },
        'user-1',
        grant.subject,
        grant.subjectProof,
        now
      )
    ).toThrow(WorkloadIdentitySubjectError)
  })

  it('refuses a proof issued for another provider', () => {
    const grant = issueWorkloadIdentitySubject('aws', owner, 'user-1', now)

    expect(() =>
      verifyWorkloadIdentitySubject(
        'databricks',
        owner,
        'user-1',
        grant.subject,
        grant.subjectProof,
        now
      )
    ).toThrow(WorkloadIdentitySubjectError)
  })

  it('refuses an expired proof', () => {
    const grant = issueWorkloadIdentitySubject('aws', owner, 'user-1', now)
    const later = now + 24 * 60 * 60 * 1000 + 1

    expect(() =>
      verifyWorkloadIdentitySubject(
        'aws',
        owner,
        'user-1',
        grant.subject,
        grant.subjectProof,
        later
      )
    ).toThrow(WorkloadIdentitySubjectError)
  })

  it('refuses a tampered or malformed proof', () => {
    const grant = issueWorkloadIdentitySubject('aws', owner, 'user-1', now)
    const [expiresAt] = grant.subjectProof.split('.')

    for (const proof of [
      `${Number(expiresAt) + 1000}.${grant.subjectProof.split('.')[1]}`,
      `${expiresAt}.forged`,
      'no-separator',
      '',
    ]) {
      expect(() =>
        verifyWorkloadIdentitySubject('aws', owner, 'user-1', grant.subject, proof, now)
      ).toThrow(WorkloadIdentitySubjectError)
    }
  })
})

describe('binding a subject to a saved credential', () => {
  const actor = { ...owner, actorUserId: 'user-1' }

  it('keeps the stored subject when a reconnect submits none', () => {
    expect(
      bindWorkloadIdentitySubject({
        provider: 'aws',
        owner: actor,
        storedSubject: 'sim:workspace:ws-1:credential:stored123456',
        subject: undefined,
        subjectProof: undefined,
      })
    ).toBe('sim:workspace:ws-1:credential:stored123456')
  })

  it('refuses a keyless credential with neither a stored nor a proven subject', () => {
    expect(() =>
      bindWorkloadIdentitySubject({
        provider: 'aws',
        owner: actor,
        storedSubject: undefined,
        subject: undefined,
        subjectProof: undefined,
      })
    ).toThrow(WorkloadIdentitySubjectError)
  })

  it('accepts a new subject only with a proof issued to the person saving it', () => {
    const grant = issueWorkloadIdentitySubject('databricks', owner, 'user-1')

    expect(
      bindWorkloadIdentitySubject({
        provider: 'databricks',
        owner: actor,
        storedSubject: 'sim:workspace:ws-1:credential:stored123456',
        subject: grant.subject,
        subjectProof: grant.subjectProof,
      })
    ).toBe(grant.subject)
    expect(() =>
      bindWorkloadIdentitySubject({
        provider: 'databricks',
        owner: { ...owner, actorUserId: 'user-2' },
        storedSubject: undefined,
        subject: grant.subject,
        subjectProof: grant.subjectProof,
      })
    ).toThrow(WorkloadIdentitySubjectError)
    expect(() =>
      bindWorkloadIdentitySubject({
        provider: 'databricks',
        owner: actor,
        storedSubject: undefined,
        subject: grant.subject,
        subjectProof: undefined,
      })
    ).toThrow(WorkloadIdentitySubjectError)
  })
})
