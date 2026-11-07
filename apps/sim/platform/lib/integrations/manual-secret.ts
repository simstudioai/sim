import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

export const MANUAL_SECRET_TYPES = [
  { value: 'secret', label: 'Secret' },
  { value: 'api-key', label: 'API key' },
  { value: 'access-token', label: 'Access token' },
  { value: 'refresh-token', label: 'Refresh token' },
  { value: 'client-secret', label: 'Client secret' },
  { value: 'private-key', label: 'Private key' },
  { value: 'service-account', label: 'Service account JSON' },
  { value: 'basic-auth', label: 'Username and password' },
] as const

export type ManualSecretType = (typeof MANUAL_SECRET_TYPES)[number]['value']
export type ManualCredential = Extract<IntegrationResource, { kind: 'credential' }>

/** Validate transient form values; callers keep only credential metadata. */
export function validateManualSecret(type: ManualSecretType, values: FormData) {
  const value = String(values.get('value') ?? '').trim()
  if (!value) throw new Error('Enter a secret value.')
  if (type === 'basic-auth' && !String(values.get('username') ?? '').trim())
    throw new Error('Enter a username.')
  if (
    type === 'private-key' &&
    !/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]+-----END (?:[A-Z]+ )*PRIVATE KEY-----/.test(
      value
    )
  )
    throw new Error('Enter a PEM private key, including its BEGIN and END lines.')
  if (type === 'service-account') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Enter a valid JSON key.')
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Object.keys(parsed).length
    )
      throw new Error('The JSON key must be a non-empty object.')
  }
}

/** Projects the same access controls for manual secrets without retaining their values. */
export function manualCredentialAccess(
  resource: ManualCredential,
  data: Pick<IntegrationCenterData, 'viewer' | 'organization'>
): IntegrationCredential {
  const people = [
    ...new Map([resource.owner, ...resource.people].map((person) => [person.id, person])).values(),
  ]
  return {
    id: resource.id,
    appId: resource.appId ?? '',
    providerId: resource.appId ?? '',
    type: 'secret',
    displayName: resource.name,
    description: resource.description,
    role: resource.canEdit ? 'admin' : 'member',
    status: 'active',
    canReconnect: false,
    scope: { kind: 'organization', ...data.organization },
    members:
      resource.members ??
      people.map((person) => {
        const admin =
          person.id === resource.owner.id || (person.id === data.viewer.id && resource.canEdit)
        return {
          ...person,
          userId: person.id,
          role: admin ? 'admin' : 'member',
          roleSource: 'explicit',
          explicitAdmin: admin,
          status: 'active',
        }
      }),
  }
}
