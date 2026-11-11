/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  send: vi.fn(),
  mint: vi.fn(async ({ subject }: { subject: string }) => `token-for:${subject}`),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  isWorkloadIdentityConfigured: async () => true,
  mintWorkloadIdentityToken: hoisted.mint,
}))
vi.mock('@aws-sdk/client-sts', async (importActual) => ({
  ...(await importActual<typeof import('@aws-sdk/client-sts')>()),
  STSClient: class {
    send = hoisted.send
  },
}))

import { AssumeRoleWithWebIdentityCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { credential } from '@sim/db/schema'
import {
  getAwsCredentialConfig,
  resolveAwsSessionCredentials,
  verifyAndEncryptAwsCredential,
} from '@/lib/credentials/aws-service-account.server'
import { WorkloadIdentityNotConfiguredError } from '@/lib/credentials/workload-identity/subject'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const ROLE_ARN = 'arn:aws:iam::123456789012:role/sim-workflows'
const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'
const session = { AccessKeyId: 'ASIATEMP', SecretAccessKey: 'secret', SessionToken: 'token' }

function accessDenied() {
  return Object.assign(new Error('Not authorized to perform sts:AssumeRoleWithWebIdentity'), {
    name: 'AccessDenied',
  })
}

/** A role whose trust policy pins `sub` to {@link SUBJECT}, or trusts any subject. */
function roleTrusting(pinsSubject: boolean) {
  hoisted.send.mockImplementation(async (command: unknown) => {
    if (command instanceof AssumeRoleWithWebIdentityCommand) {
      const trusted = !pinsSubject || command.input.WebIdentityToken === `token-for:${SUBJECT}`
      if (!trusted) throw accessDenied()
      return { Credentials: { ...session, Expiration: new Date() } }
    }
    if (command instanceof GetCallerIdentityCommand) {
      return { Arn: 'arn:aws:sts::123456789012:assumed-role/sim-workflows/sim-verify' }
    }
    throw new Error('unexpected STS command')
  })
}

/** Reconnecting a keyless credential that keeps its stored subject. */
const keylessReconnect = {
  serialized: JSON.stringify({ authType: 'oidc_role', roleArn: ROLE_ARN }),
  owner: {
    workspaceId: 'ws-1',
    actorUserId: 'user-1',
    storedSecret: {
      type: 'aws_credential_v1',
      config: { authType: 'oidc_role', roleArn: ROLE_ARN, subject: SUBJECT },
    },
  },
}

describe('saving a keyless AWS role', () => {
  beforeEach(() => {
    hoisted.send.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('saves a role whose trust policy pins this credential’s subject', async () => {
    roleTrusting(true)

    await expect(
      verifyAndEncryptAwsCredential(keylessReconnect.serialized, keylessReconnect.owner)
    ).resolves.toMatchObject({ encryptedServiceAccountKey: 'ciphertext' })
  })

  it('refuses a role that trusts any Sim subject, so no other workspace can assume it', async () => {
    roleTrusting(false)

    await expect(
      verifyAndEncryptAwsCredential(keylessReconnect.serialized, keylessReconnect.owner)
    ).rejects.toThrow(/sub/)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('reads a provider message that ends in a period as one sentence', async () => {
    hoisted.send.mockRejectedValue(
      Object.assign(new Error('Not authorized to perform sts:AssumeRoleWithWebIdentity.'), {
        name: 'AccessDenied',
      })
    )

    await expect(
      verifyAndEncryptAwsCredential(keylessReconnect.serialized, keylessReconnect.owner)
    ).rejects.toThrow(
      'Sim could not assume this role: Not authorized to perform sts:AssumeRoleWithWebIdentity. Check that'
    )
  })

  it('reconnects to a keyless refusal with its code when signing stops mid-save', async () => {
    roleTrusting(true)
    hoisted.mint.mockRejectedValueOnce(new WorkloadIdentityNotConfiguredError())

    await expect(
      verifyAndEncryptAwsCredential(keylessReconnect.serialized, keylessReconnect.owner)
    ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_NOT_CONFIGURED' })
  })

  it('does not save when the any-subject check cannot be completed', async () => {
    roleTrusting(true)
    const pinned = hoisted.send.getMockImplementation()
    hoisted.send.mockImplementation(async (command: unknown) => {
      const probesUnboundSubject =
        command instanceof AssumeRoleWithWebIdentityCommand &&
        command.input.WebIdentityToken !== `token-for:${SUBJECT}`
      if (probesUnboundSubject) {
        throw Object.assign(new Error('socket hang up'), { name: 'TimeoutError' })
      }
      return pinned?.(command)
    })

    await expect(
      verifyAndEncryptAwsCredential(keylessReconnect.serialized, keylessReconnect.owner)
    ).rejects.toThrow()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })
})

describe('loading a saved AWS credential for a run', () => {
  beforeEach(() => resetDbChainMock())

  it('refuses a credential owned by a different workspace than the run', async () => {
    queueTableRows(credential, [
      {
        workspaceId: 'ws-other',
        organizationId: null,
        type: 'service_account',
        providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
        revokedAt: null,
        encryptedServiceAccountKey: 'ciphertext',
      },
    ])

    await expect(getAwsCredentialConfig('cred-1', { workspaceId: 'ws-1' })).rejects.toThrow(
      'AWS credential is unavailable'
    )
  })
})

describe("resolving a run's AWS session", () => {
  const owner = { workspaceId: 'ws-1' }
  const options = { roleSessionName: 'sim-exec-1' }
  const expiration = new Date('2030-01-01T01:00:00.000Z')

  beforeEach(() => hoisted.send.mockReset())

  it.each([
    {
      config: { authType: 'oidc_role', roleArn: ROLE_ARN, subject: SUBJECT },
      durationSeconds: 3600,
    },
    {
      config: {
        authType: 'assume_role',
        roleArn: ROLE_ARN,
        accessKeyId: 'AKIAEXAMPLEKEY01',
        secretAccessKey: 'stored-secret',
        sessionDurationSeconds: 900,
      },
      durationSeconds: 900,
    },
  ] as const)(
    'reports how long a $config.authType session lasts and when it ends',
    async ({ config, durationSeconds }) => {
      hoisted.send.mockResolvedValue({ Credentials: { ...session, Expiration: expiration } })

      await expect(resolveAwsSessionCredentials(config, owner, options)).resolves.toEqual({
        accessKeyId: 'ASIATEMP',
        secretAccessKey: 'secret',
        sessionToken: 'token',
        durationSeconds,
        expiration,
      })
      expect(hoisted.send.mock.calls[0][0].input.DurationSeconds).toBe(durationSeconds)
    }
  )
})
