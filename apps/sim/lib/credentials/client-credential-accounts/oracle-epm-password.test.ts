import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  createCredentialBodySchema,
  updateCredentialByIdBodySchema,
} from '@/lib/api/contracts/credentials'
import {
  v2CreateServiceAccountCredentialBodySchema,
  v2UpdateCredentialBodySchema,
} from '@/lib/api/contracts/v2/credentials'
import { mintOracleEpmServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/oracle-epm'
import { parseClientCredentialAccountSecretBlob } from '@/lib/credentials/client-credential-accounts/server'
import { verifyAndBuildServiceAccountSecret } from '@/lib/credentials/service-account-secret'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const input = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  type: 'service_account' as const,
  providerId: 'oracle-epm-service-account',
  displayName: 'Oracle test',
  orgId: 'https://epm.example.com/gateway',
  clientId: 'integration-user',
  clientSecret: ' password with spaces ',
}

beforeEach(() => {
  encryptionMockFns.mockEncryptSecret.mockImplementation(async (value: string) => ({
    encrypted: value,
  }))
})

it.each([
  ['internal create', () => createCredentialBodySchema.parse(input)],
  [
    'internal reconnect',
    () => updateCredentialByIdBodySchema.parse({ clientSecret: input.clientSecret }),
  ],
  [
    'v2 create',
    () =>
      v2CreateServiceAccountCredentialBodySchema.parse({
        workspaceId: input.workspaceId,
        type: input.type,
        providerId: input.providerId,
        credentials: JSON.stringify({
          orgId: input.orgId,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
        }),
      }).credentials,
  ],
  ['v2 reconnect', () => v2UpdateCredentialBodySchema.parse({ clientSecret: input.clientSecret })],
  ['secret builder', () => input],
] as const)(
  'preserves the password through %s, storage, and Basic authentication',
  async (_surface, parse) => {
    const fields = { ...input, ...parse() }
    const result = await verifyAndBuildServiceAccountSecret(input.providerId, fields)
    const stored = parseClientCredentialAccountSecretBlob(
      result.encryptedServiceAccountKey,
      input.providerId
    )
    const credential = await mintOracleEpmServiceAccountToken(stored)
    expect(Buffer.from(credential.accessToken, 'base64').toString('utf8')).toBe(
      `integration-user:${input.clientSecret}`
    )
  }
)
