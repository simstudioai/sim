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

function prepare(
  provider: 'aws' | 'databricks' | 'snowflake' | 'google' | 'microsoft' = 'snowflake'
) {
  return prepareWorkloadIdentity.execute({
    principal,
    input: { workspaceId: 'workspace-1', provider, credentialId: 'cred-1' },
  })
}

const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
})

beforeAll(() => {
  Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', signingKey)
  Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
})

afterAll(() => {
  Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
  Reflect.set(env, 'WORKLOAD_IDENTITY_ISSUER', undefined)
})

const subject = 'sim:workspace:workspace-1:credential:abcdef0123456789'
const roleArn = 'arn:aws:iam::123456789012:role/sim-role'
const accessKeys = { accessKeyId: 'TESTACCESSKEYID0000', secretAccessKey: 'test-secret' }
const databricksHost = 'dbc-00000000-0000.cloud.databricks.com'
const clientId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const appConfig = { tenantId: '11111111-2222-3333-4444-555555555555', clientId }

/** One stored secret per auth mode of every mixed-mode provider, and the mode a reconnect reports. */
const STORED_MODES = [
  {
    provider: 'aws',
    providerId: 'aws-service-account',
    secret: { type: 'aws_credential_v1', config: { authType: 'oidc_role', roleArn, subject } },
    expected: 'oidc_role',
  },
  {
    provider: 'aws',
    providerId: 'aws-service-account',
    secret: {
      type: 'aws_credential_v1',
      config: { authType: 'assume_role', ...accessKeys, roleArn, externalId: 'external-1' },
    },
    expected: 'assume_role',
  },
  {
    provider: 'aws',
    providerId: 'aws-service-account',
    secret: { type: 'aws_credential_v1', config: { authType: 'access_keys', ...accessKeys } },
    expected: 'access_keys',
  },
  {
    provider: 'databricks',
    providerId: 'databricks-service-account',
    secret: {
      type: 'databricks_credential_v1',
      config: { authType: 'oidc_federation', host: databricksHost, clientId, subject },
    },
    expected: 'oidc_federation',
  },
  {
    provider: 'databricks',
    providerId: 'databricks-service-account',
    secret: {
      type: 'databricks_credential_v1',
      config: {
        authType: 'service_principal',
        host: databricksHost,
        clientId,
        clientSecret: 'test-secret',
      },
    },
    expected: 'service_principal',
  },
  {
    provider: 'databricks',
    providerId: 'databricks-service-account',
    secret: {
      type: 'databricks_credential_v1',
      config: { authType: 'personal_access_token', host: databricksHost, token: 'test-token' },
    },
    expected: 'personal_access_token',
  },
  {
    provider: 'snowflake',
    providerId: 'snowflake-service-account',
    secret: keylessSecret,
    expected: 'workload_identity',
  },
  {
    provider: 'snowflake',
    providerId: 'snowflake-service-account',
    secret: {
      type: 'token_service_account',
      providerId: 'snowflake-service-account',
      apiToken: 'test-token',
      domain: 'myorg-myaccount.snowflakecomputing.com',
    },
    expected: 'programmatic_access_token',
  },
  {
    provider: 'microsoft',
    providerId: 'microsoft-app-service-account',
    secret: {
      type: 'microsoft_app_credential_v1',
      config: { ...appConfig, authType: 'federated', subject },
    },
    expected: 'federated',
  },
  {
    provider: 'microsoft',
    providerId: 'microsoft-app-service-account',
    secret: {
      type: 'microsoft_app_credential_v1',
      config: { ...appConfig, authType: 'client_secret', clientSecret: 'value' },
    },
    expected: 'client_secret',
  },
  {
    provider: 'microsoft',
    providerId: 'microsoft-app-service-account',
    secret: {
      type: 'microsoft_app_credential_v1',
      config: { ...appConfig, authType: 'certificate', privateKey: 'key', certificate: 'cert' },
    },
    expected: 'certificate',
  },
  {
    provider: 'google',
    providerId: 'google-service-account',
    secret: { type: 'google_workload_identity_v1', config: { subject } },
    expected: 'workload_identity',
  },
  {
    provider: 'google',
    providerId: 'google-service-account',
    secret: { type: 'service_account', client_email: 'sa@p.iam.gserviceaccount.com' },
    expected: 'json_key',
  },
] as const

const CUSTOM_AUDIENCE = 'sim-123456789012'

/** One stored keyless secret per provider, each carrying {@link CUSTOM_AUDIENCE}. */
const CUSTOM_AUDIENCE_SECRETS = [
  {
    provider: 'aws',
    providerId: 'aws-service-account',
    secret: {
      type: 'aws_credential_v1',
      config: { authType: 'oidc_role', roleArn, subject, audience: CUSTOM_AUDIENCE },
    },
  },
  {
    provider: 'databricks',
    providerId: 'databricks-service-account',
    secret: {
      type: 'databricks_credential_v1',
      config: {
        authType: 'oidc_federation',
        host: databricksHost,
        clientId,
        subject,
        audience: CUSTOM_AUDIENCE,
      },
    },
  },
  {
    provider: 'snowflake',
    providerId: 'snowflake-service-account',
    secret: {
      ...keylessSecret,
      config: { ...keylessSecret.config, audience: CUSTOM_AUDIENCE },
    },
  },
  {
    provider: 'microsoft',
    providerId: 'microsoft-app-service-account',
    secret: {
      type: 'microsoft_app_credential_v1',
      config: { ...appConfig, authType: 'federated', subject, audience: CUSTOM_AUDIENCE },
    },
  },
  {
    provider: 'google',
    providerId: 'google-service-account',
    secret: {
      type: 'google_workload_identity_v1',
      config: {
        projectNumber: '123456789012',
        poolId: 'sim-pool',
        providerId: 'sim-oidc',
        serviceAccountEmail: 'runner@analytics-prod.iam.gserviceaccount.com',
        subject,
        audience: CUSTOM_AUDIENCE,
      },
    },
  },
] as const

describe('preparing a reconnect', () => {
  beforeEach(() => {
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
  })

  it.each(STORED_MODES)(
    'reports a $provider credential stored as $expected',
    async ({ provider, providerId, secret, expected }) => {
      reconnecting(secret, { providerId })
      await expect(prepare(provider)).resolves.toMatchObject({
        available: true,
        reconnectAuthType: expected,
      })
    }
  )

  it.each(CUSTOM_AUDIENCE_SECRETS)(
    'reopens a $provider keyless credential on its custom audience',
    async ({ provider, providerId, secret }) => {
      reconnecting(secret, { providerId })
      await expect(prepare(provider)).resolves.toMatchObject({
        available: true,
        reconnectAudience: CUSTOM_AUDIENCE,
      })
    }
  )

  it.each(STORED_MODES)(
    'reports no audience for a $provider credential stored as $expected',
    async ({ provider, providerId, secret }) => {
      reconnecting(secret, { providerId })
      expect(await prepare(provider)).not.toHaveProperty('reconnectAudience')
    }
  )

  it('reports the stored mode when this deployment cannot sign, so keyed modes still reopen', async () => {
    Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
    try {
      reconnecting(
        { type: 'aws_credential_v1', config: { authType: 'assume_role', ...accessKeys, roleArn } },
        { providerId: 'aws-service-account' }
      )
      await expect(prepare('aws')).resolves.toEqual({
        available: false,
        reconnectAuthType: 'assume_role',
      })
    } finally {
      Reflect.set(env, 'WORKLOAD_IDENTITY_SIGNING_KEY', signingKey)
    }
  })

  it('reports a national-cloud Microsoft credential’s cloud, so the dialog reopens on it', async () => {
    reconnecting(
      {
        type: 'microsoft_app_credential_v1',
        config: { ...appConfig, authType: 'client_secret', clientSecret: 'value', cloud: 'usgov' },
      },
      { providerId: 'microsoft-app-service-account' }
    )
    await expect(prepare('microsoft')).resolves.toMatchObject({
      reconnectAuthType: 'client_secret',
      reconnectCloud: 'usgov',
    })
  })

  it('reports no cloud for a global Microsoft credential or another provider', async () => {
    reconnecting(STORED_MODES[9].secret, { providerId: 'microsoft-app-service-account' })
    expect(await prepare('microsoft')).not.toHaveProperty('reconnectCloud')
    reconnecting(keylessSecret)
    expect(await prepare()).not.toHaveProperty('reconnectCloud')
  })

  it('gives Google no fixed audience', async () => {
    reconnecting(STORED_MODES[11].secret, { providerId: 'google-service-account' })
    expect(await prepare('google')).not.toHaveProperty('audience')
  })

  it('reports a keyless Google credential’s delegation so a reconnect keeps it', async () => {
    reconnecting(
      {
        type: 'google_workload_identity_v1',
        config: {
          projectNumber: '123456789012',
          poolId: 'sim-pool',
          providerId: 'sim-oidc',
          serviceAccountEmail: 'runner@analytics-prod.iam.gserviceaccount.com',
          subject,
          delegation: { user: 'alice@example.com', services: ['gmail', 'google-calendar'] },
        },
      },
      { providerId: 'google-service-account' }
    )
    await expect(prepare('google')).resolves.toMatchObject({
      reconnectAuthType: 'workload_identity',
      reconnectDelegation: { user: 'alice@example.com', services: ['gmail', 'google-calendar'] },
    })
  })

  it('reveals nothing about a credential the caller does not administer', async () => {
    reconnecting(keylessSecret, { isAdmin: false })
    expect(await prepare()).not.toHaveProperty('reconnectAuthType')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('reveals nothing about a credential from another workspace', async () => {
    reconnecting(keylessSecret, { workspaceId: 'workspace-2' })
    expect(await prepare()).not.toHaveProperty('reconnectAuthType')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('does not read a Snowflake credential as a Google one', async () => {
    reconnecting(keylessSecret)
    expect(await prepare('google')).not.toHaveProperty('reconnectAuthType')
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
})
