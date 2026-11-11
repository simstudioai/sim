/**
 * The Platform catalog's connection methods for the credentials #9869 added. Failure modes: an
 * integration whose service names a service account the Platform dialog can set up lists no way to
 * add it; Snowflake loses its programmatic access token or never offers the keyless service user;
 * keyless Google setup reaches a Google Workspace integration, which can never use it; and a
 * service account connection loses the OAuth service the dialog gates keyless Google on.
 */
import { describe, expect, it } from 'vitest'
import { integrationConnections } from './platform-integration-connections'

function connections(type: string, oauthServiceId?: string) {
  return integrationConnections({ type, authType: 'oauth', oauthServiceId })
}

function serviceAccount(type: string, oauthServiceId?: string) {
  const connection = connections(type, oauthServiceId).find(
    (entry) => entry.kind === 'service_account'
  )
  if (!connection) throw new Error(`${type} lists no service account connection`)
  return connection
}

function authTypes(type: string, oauthServiceId?: string) {
  return serviceAccount(type, oauthServiceId)
    .fields.find((field) => field.id === 'authType')
    ?.options?.map((option) => option.value)
}

describe('connections #9869 adds', () => {
  it.each([
    ['microsoft_ad', 'microsoft-ad'],
    ['sharepoint_v2', 'sharepoint'],
    ['microsoft_dataverse_v2', 'microsoft-dataverse'],
    ['microsoft_dynamics_365', 'microsoft-dataverse'],
  ])('offers a Microsoft app credential beside OAuth on %s', (type, oauthServiceId) => {
    expect(
      connections(type, oauthServiceId).map(({ kind, providerId }) => [kind, providerId])
    ).toEqual([
      ['oauth', oauthServiceId],
      ['service_account', 'microsoft-app-service-account'],
    ])
    expect(authTypes(type, oauthServiceId)).toEqual(['federated', 'client_secret', 'certificate'])
  })

  it('offers Snowflake a keyless service user and its programmatic access token', () => {
    const snowflake = serviceAccount('snowflake')
    expect(snowflake.label).toBe('Add Snowflake connection')
    expect(authTypes('snowflake')).toEqual(['workload_identity', 'programmatic_access_token'])
    expect(snowflake.fields.find((field) => field.id === 'apiToken')?.visibleWhen).toEqual({
      field: 'authType',
      values: ['programmatic_access_token'],
    })
  })

  it('offers keyless Google setup beside the JSON key on BigQuery', () => {
    expect(authTypes('google_bigquery', 'google-bigquery')).toEqual([
      'json_key',
      'workload_identity',
    ])
    expect(serviceAccount('google_bigquery', 'google-bigquery').oauthServiceId).toBe(
      'google-bigquery'
    )
  })

  it('never offers keyless Google setup to a Google Workspace integration', () => {
    const drive = serviceAccount('google_drive', 'google-drive')
    expect(drive.fields.map((field) => field.id)).toEqual(['serviceAccountJson'])
    expect(drive.oauthServiceId).toBe('google-drive')
  })

  it.each([
    ['github_v3', 'github-token', 'github-service-account', 'Add personal access token'],
    ['bitbucket', 'bitbucket', 'bitbucket-service-account', 'Add access token'],
    ['docusign', 'docusign', 'docusign-service-account', 'Add JWT Grant app'],
  ])('offers the saved %s credential', (type, oauthServiceId, providerId, label) => {
    expect(serviceAccount(type, oauthServiceId)).toMatchObject({ providerId, label })
  })
})
