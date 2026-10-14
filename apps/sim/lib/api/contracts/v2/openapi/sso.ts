import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2AddOrganizationDomainContract,
  v2DeleteSsoProviderContract,
  v2GetSsoPolicyContract,
  v2GetSsoProviderContract,
  v2ListOrganizationDomainsContract,
  v2ListSsoProvidersContract,
  v2RemoveOrganizationDomainContract,
  v2SaveSsoProviderContract,
  v2SetPrimarySsoProviderContract,
  v2UpdateSsoPolicyContract,
  v2VerifyOrganizationDomainContract,
} from '@/lib/api/contracts/v2/sso'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { ssoProviderOperations, ssoSettingsOperations } from '@/lib/auth/sso/application/operations'
import { organizationSecurityOperations } from '@/lib/organizations/application/operations'
export const ssoOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListSsoProvidersContract,
    {
      applicationOperation: ssoProviderOperations.list,
      operationId: 'listSsoProviders',
      summary: 'List SSO providers',
      description: `List identity providers owned by the organization. Requires organization Admin access. OIDC client secrets are redacted and SAML private keys are omitted. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of identity providers with redacted configuration.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListSsoProvidersContract.params,
        'ListSsoProvidersParams',
        'List SSO providers parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2ListSsoProvidersContract.query,
        'ListSsoProvidersQuery',
        'Query parameters',
        'Sorting and pagination controls.'
      ),
      response: documentedSchema(
        v2ListSsoProvidersContract.response.schema,
        'ListSsoProvidersResponse',
        'List SSO providers response',
        'A page of identity providers with redacted configuration.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSsoProviderContract,
    {
      applicationOperation: ssoProviderOperations.list,
      operationId: 'getSsoProvider',
      summary: 'Get SSO provider',
      description: `Get an identity provider owned by the organization. Requires organization Admin access. OIDC client secrets are redacted and SAML private keys are omitted. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The identity provider with redacted configuration.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetSsoProviderContract.params,
        'GetSsoProviderParams',
        'Get SSO provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2GetSsoProviderContract.query,
        'GetSsoProviderQuery',
        'Query parameters',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2GetSsoProviderContract.response.schema,
        'GetSsoProviderResponse',
        'Get SSO provider response',
        'The identity provider with redacted configuration.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SaveSsoProviderContract,
    {
      applicationOperation: ssoProviderOperations.save,
      operationId: 'saveSsoProvider',
      summary: 'Save SSO provider',
      description: `Create or update an organization identity provider’s configuration on a verified domain. Requires organization Admin access and SSO entitlement. Existing providers return 200; creation returns 201. Omission behavior is field-specific; OIDC’s redacted secret marker preserves the saved secret. Identity changes with linked accounts conflict. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The saved provider ID, protocol, and whether it was created.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2SaveSsoProviderContract.params,
        'SaveSsoProviderParams',
        'Save SSO provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2SaveSsoProviderContract.query,
        'SaveSsoProviderQuery',
        'Query parameters',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2SaveSsoProviderContract.body,
        'SaveSsoProviderBody',
        'Save SSO provider body',
        'Provider protocol, verified domain, and identity-provider configuration. Omission behavior is field-specific.'
      ),
      response: documentedSchema(
        v2SaveSsoProviderContract.response.schema,
        'SaveSsoProviderResponse',
        'Save SSO provider response',
        'The saved provider ID, protocol, and whether it was created.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteSsoProviderContract,
    {
      applicationOperation: ssoProviderOperations.delete,
      operationId: 'deleteSsoProvider',
      summary: 'Delete SSO provider',
      description: `Remove an identity provider and clear its primary selection. Requires organization Admin access. Existing accounts, memberships, and sessions remain. Domain sign-in falls back to another verified provider if one remains; use Get SSO policy to inspect whether SSO is still enforced. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Acknowledgement that the identity provider was removed.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2DeleteSsoProviderContract.params,
        'DeleteSsoProviderParams',
        'Delete SSO provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2DeleteSsoProviderContract.query,
        'DeleteSsoProviderQuery',
        'Query parameters',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2DeleteSsoProviderContract.response.schema,
        'DeleteSsoProviderResponse',
        'Delete SSO provider response',
        'Acknowledgement that the identity provider was removed.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SetPrimarySsoProviderContract,
    {
      applicationOperation: ssoSettingsOperations.setPrimary,
      operationId: 'setPrimarySsoProvider',
      summary: 'Set primary SSO provider',
      description: `Make a verified organization provider handle sign-in for its domain. Requires organization Admin access. Other providers remain available for testing and later switching. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The provider selected for its verified domain.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2SetPrimarySsoProviderContract.params,
        'SetPrimarySsoProviderParams',
        'Set primary SSO provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2SetPrimarySsoProviderContract.query,
        'SetPrimarySsoProviderQuery',
        'Query parameters',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2SetPrimarySsoProviderContract.body,
        'SetPrimarySsoProviderBody',
        'Set primary SSO provider body',
        'An empty JSON object; the path identifies the provider to make primary.'
      ),
      response: documentedSchema(
        v2SetPrimarySsoProviderContract.response.schema,
        'SetPrimarySsoProviderResponse',
        'Set primary SSO provider response',
        'The provider selected for its verified domain.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSsoPolicyContract,
    {
      applicationOperation: ssoSettingsOperations.readRequirement,
      operationId: 'getSsoPolicy',
      summary: 'Get SSO policy',
      description: `Get the stored organization SSO requirement and whether it is currently enforced. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The stored SSO requirement and its effective enforcement state.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetSsoPolicyContract.params,
        'GetSsoPolicyParams',
        'Get SSO policy parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2GetSsoPolicyContract.query,
        'GetSsoPolicyQuery',
        'Query parameters',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2GetSsoPolicyContract.response.schema,
        'GetSsoPolicyResponse',
        'Get SSO policy response',
        'The stored SSO requirement and its effective enforcement state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateSsoPolicyContract,
    {
      applicationOperation: ssoSettingsOperations.setRequirement,
      operationId: 'updateSsoPolicy',
      summary: 'Update SSO policy',
      description: `Require or stop requiring SSO on future sign-ins. Requires organization Admin access. Enabling requires SSO entitlement and a verified provider; disabling remains available after entitlement is lost. Existing sessions remain active. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The saved SSO requirement and its effective enforcement state.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateSsoPolicyContract.params,
        'UpdateSsoPolicyParams',
        'Update SSO policy parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2UpdateSsoPolicyContract.query,
        'UpdateSsoPolicyQuery',
        'Query parameters',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2UpdateSsoPolicyContract.body,
        'UpdateSsoPolicyBody',
        'Update SSO policy body',
        'Whether future sign-ins must use SSO.'
      ),
      response: documentedSchema(
        v2UpdateSsoPolicyContract.response.schema,
        'UpdateSsoPolicyResponse',
        'Update SSO policy response',
        'The saved SSO requirement and its effective enforcement state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationDomainsContract,
    {
      applicationOperation: organizationSecurityOperations.listDomains,
      operationId: 'listOrganizationDomains',
      summary: 'List organization domains',
      description: `List the organization’s domain claims with cursor pagination. Requires organization membership. Pending DNS challenge values are returned only to administrators using their own credentials. Organizations without Enterprise domain entitlement return an empty list. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of domain claims; pending challenges are limited to Admins.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationDomainsContract.params,
        'ListOrganizationDomainsParams',
        'List organization domains parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationDomainsContract.query,
        'ListOrganizationDomainsQuery',
        'Query parameters',
        'Sorting and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationDomainsContract.response.schema,
        'ListOrganizationDomainsResponse',
        'List organization domains response',
        'A page of domain claims; pending challenges are limited to Admins.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddOrganizationDomainContract,
    {
      applicationOperation: organizationSecurityOperations.addDomain,
      operationId: 'addOrganizationDomain',
      summary: 'Add organization domain',
      description: `Claim a domain and receive its DNS TXT challenge. Requires organization Admin access and, when billing is enabled, Enterprise domain entitlement. An organization can claim at most 25 domains. Existing claims return \`200\`; new claims return \`201\`. A domain verified by another organization returns \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The domain claim and its pending DNS challenge, when applicable.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2AddOrganizationDomainContract.params,
        'AddOrganizationDomainParams',
        'Add organization domain parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2AddOrganizationDomainContract.query,
        'AddOrganizationDomainQuery',
        'Query parameters',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2AddOrganizationDomainContract.body,
        'AddOrganizationDomainBody',
        'Add organization domain body',
        'The domain to claim and verify.'
      ),
      response: documentedSchema(
        v2AddOrganizationDomainContract.response.schema,
        'AddOrganizationDomainResponse',
        'Add organization domain response',
        'The domain claim and its pending DNS challenge, when applicable.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2VerifyOrganizationDomainContract,
    {
      applicationOperation: organizationSecurityOperations.verifyDomain,
      operationId: 'verifyOrganizationDomain',
      summary: 'Verify organization domain',
      description: `Verify domain ownership through its DNS TXT challenge and grant domain trust to matching organization providers. Requires organization Admin access and, when billing is enabled, Enterprise domain entitlement. Billing-disabled self-hosted deployments may configure operator verification. An already-verified domain is returned unchanged. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The domain claim after ownership verification.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2VerifyOrganizationDomainContract.params,
        'VerifyOrganizationDomainParams',
        'Verify organization domain parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2VerifyOrganizationDomainContract.query,
        'VerifyOrganizationDomainQuery',
        'Query parameters',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2VerifyOrganizationDomainContract.body,
        'VerifyOrganizationDomainBody',
        'Verify organization domain body',
        'An empty JSON object; verification uses the claim’s current DNS challenge.'
      ),
      response: documentedSchema(
        v2VerifyOrganizationDomainContract.response.schema,
        'VerifyOrganizationDomainResponse',
        'Verify organization domain response',
        'The domain claim after ownership verification.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RemoveOrganizationDomainContract,
    {
      applicationOperation: organizationSecurityOperations.removeDomain,
      operationId: 'removeOrganizationDomain',
      summary: 'Remove organization domain',
      description: `Remove a domain claim and revoke verified sign-in authority from matching organization providers. Requires organization Admin access and, when billing is enabled, Enterprise domain entitlement. Existing accounts and memberships remain. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Acknowledgement that the domain claim was removed.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RemoveOrganizationDomainContract.params,
        'RemoveOrganizationDomainParams',
        'Remove organization domain parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2RemoveOrganizationDomainContract.query,
        'RemoveOrganizationDomainQuery',
        'Query parameters',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2RemoveOrganizationDomainContract.response.schema,
        'RemoveOrganizationDomainResponse',
        'Remove organization domain response',
        'Acknowledgement that the domain claim was removed.'
      ),
    }
  ),
] as const
