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
      summary: 'List SSO Providers',
      description: `List identity providers owned by the organization. Requires organization administrator access. OIDC client secrets are redacted and SAML private keys are omitted. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'List SSO Providers result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListSsoProvidersContract.params,
        'ListSsoProvidersParams',
        'List SSO Providers parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2ListSsoProvidersContract.query,
        'ListSsoProvidersQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2ListSsoProvidersContract.response.schema,
        'ListSsoProvidersResponse',
        'List SSO Providers response',
        'List SSO Providers result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSsoProviderContract,
    {
      applicationOperation: ssoProviderOperations.list,
      operationId: 'getSsoProvider',
      summary: 'Get SSO Provider',
      description: `Get an identity provider owned by the organization. Requires organization administrator access. OIDC client secrets are redacted and SAML private keys are omitted. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Get SSO Provider result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetSsoProviderContract.params,
        'GetSsoProviderParams',
        'Get SSO Provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2GetSsoProviderContract.query,
        'GetSsoProviderQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2GetSsoProviderContract.response.schema,
        'GetSsoProviderResponse',
        'Get SSO Provider response',
        'Get SSO Provider result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SaveSsoProviderContract,
    {
      applicationOperation: ssoProviderOperations.save,
      operationId: 'saveSsoProvider',
      summary: 'Save SSO Provider',
      description: `Create or update an organization identity provider’s configuration on a verified domain. Requires organization administrator access and SSO entitlement. Existing providers return 200; creation returns 201. Omission behavior is field-specific; OIDC’s redacted secret marker preserves the saved secret. Identity changes with linked accounts conflict. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Save SSO Provider result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2SaveSsoProviderContract.params,
        'SaveSsoProviderParams',
        'Save SSO Provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2SaveSsoProviderContract.query,
        'SaveSsoProviderQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      body: documentedSchema(
        v2SaveSsoProviderContract.body,
        'SaveSsoProviderBody',
        'Save SSO Provider body',
        'Configuration accepted by Save SSO Provider.'
      ),
      response: documentedSchema(
        v2SaveSsoProviderContract.response.schema,
        'SaveSsoProviderResponse',
        'Save SSO Provider response',
        'Save SSO Provider result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteSsoProviderContract,
    {
      applicationOperation: ssoProviderOperations.delete,
      operationId: 'deleteSsoProvider',
      summary: 'Delete SSO Provider',
      description: `Remove an identity provider and clear its primary selection. Requires organization administrator access. Existing accounts, memberships, and sessions remain; sign-in falls back to another verified provider on the domain. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Delete SSO Provider result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2DeleteSsoProviderContract.params,
        'DeleteSsoProviderParams',
        'Delete SSO Provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2DeleteSsoProviderContract.query,
        'DeleteSsoProviderQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2DeleteSsoProviderContract.response.schema,
        'DeleteSsoProviderResponse',
        'Delete SSO Provider response',
        'Delete SSO Provider result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SetPrimarySsoProviderContract,
    {
      applicationOperation: ssoSettingsOperations.setPrimary,
      operationId: 'setPrimarySsoProvider',
      summary: 'Set Primary SSO Provider',
      description: `Make a verified organization provider handle sign-in for its domain. Requires organization administrator access. Other providers remain available for testing and later switching. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Set Primary SSO Provider result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2SetPrimarySsoProviderContract.params,
        'SetPrimarySsoProviderParams',
        'Set Primary SSO Provider parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2SetPrimarySsoProviderContract.query,
        'SetPrimarySsoProviderQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      body: documentedSchema(
        v2SetPrimarySsoProviderContract.body,
        'SetPrimarySsoProviderBody',
        'Set Primary SSO Provider body',
        'Configuration accepted by Set Primary SSO Provider.'
      ),
      response: documentedSchema(
        v2SetPrimarySsoProviderContract.response.schema,
        'SetPrimarySsoProviderResponse',
        'Set Primary SSO Provider response',
        'Set Primary SSO Provider result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSsoPolicyContract,
    {
      applicationOperation: ssoSettingsOperations.readRequirement,
      operationId: 'getSsoPolicy',
      summary: 'Get SSO Policy',
      description: `Get the stored organization SSO requirement and whether it is currently enforced. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Get SSO Policy result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetSsoPolicyContract.params,
        'GetSsoPolicyParams',
        'Get SSO Policy parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2GetSsoPolicyContract.query,
        'GetSsoPolicyQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2GetSsoPolicyContract.response.schema,
        'GetSsoPolicyResponse',
        'Get SSO Policy response',
        'Get SSO Policy result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateSsoPolicyContract,
    {
      applicationOperation: ssoSettingsOperations.setRequirement,
      operationId: 'updateSsoPolicy',
      summary: 'Update SSO Policy',
      description: `Require or stop requiring SSO on future sign-ins. Requires organization administrator access. Enabling requires SSO entitlement and a verified provider; disabling remains available after entitlement is lost. Existing sessions remain active. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Update SSO Policy result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2UpdateSsoPolicyContract.params,
        'UpdateSsoPolicyParams',
        'Update SSO Policy parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2UpdateSsoPolicyContract.query,
        'UpdateSsoPolicyQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      body: documentedSchema(
        v2UpdateSsoPolicyContract.body,
        'UpdateSsoPolicyBody',
        'Update SSO Policy body',
        'Configuration accepted by Update SSO Policy.'
      ),
      response: documentedSchema(
        v2UpdateSsoPolicyContract.response.schema,
        'UpdateSsoPolicyResponse',
        'Update SSO Policy response',
        'Update SSO Policy result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationDomainsContract,
    {
      applicationOperation: organizationSecurityOperations.listDomains,
      operationId: 'listOrganizationDomains',
      summary: 'List Organization Domains',
      description: `List the organization’s domain claims with cursor pagination. Requires organization membership. Pending DNS challenge values are returned only to administrators using their own credentials. Organizations without Enterprise domain entitlement return an empty list. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'List Organization Domains result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListOrganizationDomainsContract.params,
        'ListOrganizationDomainsParams',
        'List Organization Domains parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationDomainsContract.query,
        'ListOrganizationDomainsQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationDomainsContract.response.schema,
        'ListOrganizationDomainsResponse',
        'List Organization Domains response',
        'List Organization Domains result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddOrganizationDomainContract,
    {
      applicationOperation: organizationSecurityOperations.addDomain,
      operationId: 'addOrganizationDomain',
      summary: 'Add Organization Domain',
      description: `Claim a domain and receive its DNS TXT challenge. Requires organization administrator access and Enterprise domain entitlement. An existing claim returns 200; a new claim returns 201. A domain verified by another organization conflicts. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Add Organization Domain result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2AddOrganizationDomainContract.params,
        'AddOrganizationDomainParams',
        'Add Organization Domain parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2AddOrganizationDomainContract.query,
        'AddOrganizationDomainQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      body: documentedSchema(
        v2AddOrganizationDomainContract.body,
        'AddOrganizationDomainBody',
        'Add Organization Domain body',
        'Configuration accepted by Add Organization Domain.'
      ),
      response: documentedSchema(
        v2AddOrganizationDomainContract.response.schema,
        'AddOrganizationDomainResponse',
        'Add Organization Domain response',
        'Add Organization Domain result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2VerifyOrganizationDomainContract,
    {
      applicationOperation: organizationSecurityOperations.verifyDomain,
      operationId: 'verifyOrganizationDomain',
      summary: 'Verify Organization Domain',
      description: `Verify domain ownership through the published DNS TXT challenge and grant domain trust to matching organization providers. Requires organization administrator access and Enterprise domain entitlement. An already-verified domain is returned unchanged. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Verify Organization Domain result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2VerifyOrganizationDomainContract.params,
        'VerifyOrganizationDomainParams',
        'Verify Organization Domain parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2VerifyOrganizationDomainContract.query,
        'VerifyOrganizationDomainQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      body: documentedSchema(
        v2VerifyOrganizationDomainContract.body,
        'VerifyOrganizationDomainBody',
        'Verify Organization Domain body',
        'Configuration accepted by Verify Organization Domain.'
      ),
      response: documentedSchema(
        v2VerifyOrganizationDomainContract.response.schema,
        'VerifyOrganizationDomainResponse',
        'Verify Organization Domain response',
        'Verify Organization Domain result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RemoveOrganizationDomainContract,
    {
      applicationOperation: organizationSecurityOperations.removeDomain,
      operationId: 'removeOrganizationDomain',
      summary: 'Remove Organization Domain',
      description: `Remove a domain claim and revoke verified sign-in authority from matching organization providers. Requires organization administrator access and Enterprise domain entitlement. Existing accounts and memberships remain. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Remove Organization Domain result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2RemoveOrganizationDomainContract.params,
        'RemoveOrganizationDomainParams',
        'Remove Organization Domain parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2RemoveOrganizationDomainContract.query,
        'RemoveOrganizationDomainQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2RemoveOrganizationDomainContract.response.schema,
        'RemoveOrganizationDomainResponse',
        'Remove Organization Domain response',
        'Remove Organization Domain result.'
      ),
    }
  ),
] as const
