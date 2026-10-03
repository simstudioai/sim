import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_MAX_PAGE_SIZE,
  SCIM_RESOURCE_TYPE_SCHEMA,
  SCIM_SCHEMA_SCHEMA,
  SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA,
  SCIM_USER_SCHEMA,
} from '@/ee/scim/lib/protocol/constants'

/**
 * The discovery documents RFC 7644 requires.
 *
 * They describe exactly what this server implements, so a provider negotiating
 * against them never configures something that will fail later. In particular
 * `sort`, `etag`, and `bulk` are advertised as unsupported rather than omitted:
 * a provider reading an absent capability may assume the default is true.
 */

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
    documentationUri: 'https://docs.sim.ai/platform/enterprise/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: SCIM_MAX_PAGE_SIZE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication using a bearer token issued in Sim organization settings',
        specUri: 'http://www.rfc-editor.org/info/rfc6750',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${baseUrl}/ServiceProviderConfig`,
    },
  }
}

function resourceType(
  id: 'User' | 'Group',
  schema: string,
  baseUrl: string,
  extensions: Array<{ schema: string; required: boolean }> = []
) {
  return {
    schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
    id,
    name: id,
    endpoint: `/${id}s`,
    description: id === 'User' ? 'User Account' : 'Group',
    schema,
    ...(extensions.length > 0 ? { schemaExtensions: extensions } : {}),
    meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/${id}` },
  }
}

export function resourceTypes(baseUrl: string) {
  return [
    resourceType('User', SCIM_USER_SCHEMA, baseUrl, [
      { schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false },
    ]),
    resourceType('Group', SCIM_GROUP_SCHEMA, baseUrl),
  ]
}

function attribute(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    uniqueness: 'none',
    ...overrides,
  }
}

export function schemaDefinitions(baseUrl: string) {
  return [
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'User Account',
      attributes: [
        attribute('userName', { required: true, uniqueness: 'server' }),
        attribute('externalId'),
        attribute('displayName', { mutability: 'readWrite' }),
        attribute('active', { type: 'boolean' }),
        attribute('name', {
          type: 'complex',
          subAttributes: [attribute('formatted'), attribute('givenName'), attribute('familyName')],
        }),
        attribute('emails', {
          type: 'complex',
          multiValued: true,
          subAttributes: [
            attribute('value', { uniqueness: 'server' }),
            attribute('type'),
            attribute('primary', { type: 'boolean' }),
          ],
        }),
        attribute('groups', {
          type: 'complex',
          multiValued: true,
          mutability: 'readOnly',
          subAttributes: [
            attribute('value', { mutability: 'readOnly' }),
            attribute('display', { mutability: 'readOnly' }),
            attribute('$ref', { mutability: 'readOnly' }),
          ],
        }),
      ],
      meta: { resourceType: 'Schema', location: `${baseUrl}/Schemas/${SCIM_USER_SCHEMA}` },
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      description: 'Enterprise User Extension',
      attributes: [
        attribute('employeeNumber'),
        attribute('costCenter'),
        attribute('organization'),
        attribute('division'),
        attribute('department'),
        attribute('manager', {
          type: 'complex',
          subAttributes: [attribute('value'), attribute('displayName')],
        }),
      ],
      meta: {
        resourceType: 'Schema',
        location: `${baseUrl}/Schemas/${SCIM_ENTERPRISE_USER_SCHEMA}`,
      },
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description: 'Group',
      attributes: [
        attribute('displayName', { required: true, uniqueness: 'server' }),
        attribute('externalId'),
        attribute('members', {
          type: 'complex',
          multiValued: true,
          subAttributes: [attribute('value'), attribute('display'), attribute('type')],
        }),
      ],
      meta: { resourceType: 'Schema', location: `${baseUrl}/Schemas/${SCIM_GROUP_SCHEMA}` },
    },
  ]
}
