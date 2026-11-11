/**
 * @vitest-environment node
 */
import { flattenMockConditions } from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import {
  assertWorkloadIdentitySubjectUnclaimed,
  bindWorkloadIdentitySubject,
  issueWorkloadIdentitySubject,
  verifyWorkloadIdentitySubject,
  WorkloadIdentitySubjectError,
} from '@/lib/credentials/workload-identity/subject'
import type { DbTransaction } from '@/lib/db/types'

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

  it('refuses an expired proof with a code that says to request a new subject', () => {
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
    ).toThrow(expect.objectContaining({ detailCode: 'WORKLOAD_IDENTITY_PROOF_EXPIRED' }))
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
      ).toThrow(expect.objectContaining({ detailCode: 'WORKLOAD_IDENTITY_PROOF_INVALID' }))
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

describe('keyless subject uniqueness across providers', () => {
  const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'

  interface StoredCredential {
    id: string
    providerId: string
    secret: object
  }

  /**
   * A transaction whose credential query returns only the rows its provider
   * filter admits, so a provider missing from the scan is never checked.
   */
  function transactionWith(rows: StoredCredential[]): DbTransaction {
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: JSON.stringify(rows.find((row) => row.id === encrypted)?.secret),
    }))
    const tx = {
      execute: async () => [],
      select: () => ({
        from: () => ({
          where: async (condition: unknown) => {
            const providerFilter = flattenMockConditions(condition).find(
              (node) => node.type === 'inArray'
            )
            const admitted = Array.isArray(providerFilter?.values) ? providerFilter.values : []
            return rows
              .filter((row) => admitted.includes(row.providerId))
              .map((row) => ({
                id: row.id,
                displayName: row.id,
                encryptedServiceAccountKey: row.id,
              }))
          },
        }),
      }),
    }
    return tx as unknown as DbTransaction
  }

  function claim(rows: StoredCredential[]) {
    return assertWorkloadIdentitySubjectUnclaimed(transactionWith(rows), {
      subject: SUBJECT,
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
    })
  }

  beforeEach(() => {
    encryptionMockFns.mockDecryptSecret.mockReset()
  })

  it.each([
    {
      providerId: 'snowflake-service-account',
      secret: {
        type: 'snowflake_workload_identity_v1',
        config: {
          authType: 'workload_identity',
          host: 'org-acct.snowflakecomputing.com',
          subject: SUBJECT,
        },
      },
    },
    {
      providerId: 'microsoft-app-service-account',
      secret: {
        type: 'microsoft_app_credential_v1',
        config: { authType: 'federated', tenantId: 't', clientId: 'c', subject: SUBJECT },
      },
    },
    {
      providerId: 'google-service-account',
      secret: {
        type: 'google_workload_identity_v1',
        config: { projectNumber: '1', poolId: 'pool', providerId: 'prov', subject: SUBJECT },
      },
    },
  ])(
    'refuses a subject a live $providerId credential already holds',
    async ({ providerId, secret }) => {
      await expect(claim([{ id: 'held', providerId, secret }])).rejects.toThrow(
        /already uses this trust setup/
      )
    }
  )

  it('is not blocked by key-based Google and Snowflake credentials, which hold no subject', async () => {
    await expect(
      claim([
        {
          id: 'json-key',
          providerId: 'google-service-account',
          secret: { type: 'service_account', client_email: 'sa@p.iam.gserviceaccount.com' },
        },
        {
          id: 'pat',
          providerId: 'snowflake-service-account',
          secret: { type: 'token_service_account', apiToken: 'pat', domain: 'x' },
        },
        {
          id: 'client-secret',
          providerId: 'microsoft-app-service-account',
          secret: { type: 'microsoft_app_credential_v1', config: { authType: 'client_secret' } },
        },
      ])
    ).resolves.toBeUndefined()
  })
})
