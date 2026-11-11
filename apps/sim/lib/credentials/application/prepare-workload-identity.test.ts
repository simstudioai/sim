/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/access', () => credentialsAccessMock)

import { env } from '@/lib/core/config/env'
import { prepareWorkloadIdentity } from '@/lib/credentials/application/prepare-workload-identity'

const principal = createSessionPrincipal()
const keylessSecret = {
  type: 'snowflake_workload_identity_v1',
  config: {
    authType: 'workload_identity',
    host: 'myorg-myaccount.snowflakecomputing.com',
    subject: 'sim:workspace:workspace-1:credential:abcdef0123456789',
  },
}
const tokenSecret = {
  type: 'token_service_account',
  providerId: 'snowflake-service-account',
  apiToken: 'pat-secret',
  domain: 'myorg-myaccount.snowflakecomputing.com',
}

/** The credential being reconnected, as the caller's access to it resolves. */
function reconnecting(
  secret: object,
  access: { isAdmin?: boolean; workspaceId?: string; providerId?: string } = {}
) {
  credentialsAccessMockFns.mockGetCredentialActorContext.mockResolvedValue({
    credential: {
      workspaceId: access.workspaceId ?? 'workspace-1',
      type: 'service_account',
      providerId: access.providerId ?? 'snowflake-service-account',
      encryptedServiceAccountKey: 'ciphertext',
    },
    member: null,
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    isAdmin: access.isAdmin ?? true,
  })
  encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(secret) })
}

function prepare(provider: 'snowflake' | 'google' | 'microsoft' = 'snowflake') {
  return prepareWorkloadIdentity.execute({
    principal,
    input: { workspaceId: 'workspace-1', provider, credentialId: 'cred-1' },
  })
}

beforeAll(() => {
  Reflect.set(
    env,
    'WORKLOAD_IDENTITY_SIGNING_KEY',
    generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    })
  )
  Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
})

afterAll(() => {
  Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
  Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', undefined)
})

describe('preparing a Snowflake reconnect', () => {
  beforeEach(() => {
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
  })

  it('opens a keyless credential on keyless', async () => {
    reconnecting(keylessSecret)
    await expect(prepare()).resolves.toMatchObject({ reconnectsKeyless: true })
  })

  it('opens a token credential on the token', async () => {
    reconnecting(tokenSecret)
    expect(await prepare()).not.toHaveProperty('reconnectsKeyless')
  })

  it('reveals nothing about a credential the caller does not administer', async () => {
    reconnecting(keylessSecret, { isAdmin: false })
    expect(await prepare()).not.toHaveProperty('reconnectsKeyless')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('reveals nothing about a credential from another workspace', async () => {
    reconnecting(keylessSecret, { workspaceId: 'workspace-2' })
    expect(await prepare()).not.toHaveProperty('reconnectsKeyless')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
})

describe('preparing a Google service account reconnect', () => {
  const google = { providerId: 'google-service-account' }

  beforeEach(() => {
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
  })

  it('opens a keyless credential on keyless, with no fixed audience', async () => {
    reconnecting(
      {
        type: 'google_workload_identity_v1',
        config: { subject: 'sim:workspace:workspace-1:credential:abcdef0123456789' },
      },
      google
    )
    const result = await prepare('google')
    expect(result).toMatchObject({ available: true, reconnectsKeyless: true })
    expect(result).not.toHaveProperty('audience')
  })

  it('opens a JSON key credential on the key', async () => {
    reconnecting({ type: 'service_account', client_email: 'sa@p.iam.gserviceaccount.com' }, google)
    expect(await prepare('google')).not.toHaveProperty('reconnectsKeyless')
  })

  it('does not read a Snowflake credential as a Google one', async () => {
    reconnecting(keylessSecret)
    expect(await prepare('google')).not.toHaveProperty('reconnectsKeyless')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
})

describe('preparing a Microsoft app credential reconnect', () => {
  const microsoft = { providerId: 'microsoft-app-service-account' }
  const appConfig = {
    tenantId: '11111111-2222-3333-4444-555555555555',
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  }

  beforeEach(() => {
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
  })

  it('opens a federated credential on keyless', async () => {
    reconnecting(
      {
        type: 'microsoft_app_credential_v1',
        config: {
          ...appConfig,
          authType: 'federated',
          subject: 'sim:workspace:workspace-1:credential:abcdef0123456789',
        },
      },
      microsoft
    )
    await expect(prepare('microsoft')).resolves.toMatchObject({ reconnectsKeyless: true })
  })

  it.each([
    { authType: 'client_secret', clientSecret: 'value' },
    { authType: 'certificate', privateKey: 'key', certificate: 'cert' },
  ])('opens a $authType credential on its keyed mode', async (mode) => {
    reconnecting(
      { type: 'microsoft_app_credential_v1', config: { ...appConfig, ...mode } },
      microsoft
    )
    expect(await prepare('microsoft')).not.toHaveProperty('reconnectsKeyless')
  })
})
