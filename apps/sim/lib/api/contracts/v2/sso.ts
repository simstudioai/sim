import { z } from 'zod'
import {
  noInputSchema,
  nonEmptyIdSchema,
  organizationIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import { ssoRegistrationInputSchema } from '@/lib/auth/sso/registration-input'
import { addOrganizationDomainBodySchema } from '@/lib/organizations/domain-validation'

const v2SsoOrganizationParamsSchema = z
  .object({
    organizationId: organizationIdSchema.describe(
      'Organization whose single sign-on settings are managed.'
    ),
  })
  .strict()
const v2SsoProviderParamsSchema = v2SsoOrganizationParamsSchema
  .extend({
    providerId: nonEmptyIdSchema.max(255).describe('Identity provider identifier.'),
  })
  .strict()

const v2SsoProviderSchema = z.object({
  id: nonEmptyIdSchema.describe('Provider record identifier.'),
  providerId: nonEmptyIdSchema.describe('Globally unique identity provider identifier.'),
  providerType: z.enum(['oidc', 'saml']).describe('Identity provider protocol.'),
  domain: z.string().describe('Email domain served by the provider.'),
  domainKey: z.string().describe('Normalized email domain used for sign-in.'),
  issuer: z.string().describe('Identity provider issuer URL.'),
  oidcConfig: z
    .string()
    .nullable()
    .describe('JSON configuration with the client secret redacted; null for SAML.'),
  samlConfig: z
    .string()
    .nullable()
    .describe('JSON configuration without private keys; null for OIDC.'),
  jitProvisioningEnabled: z
    .boolean()
    .describe(
      'Whether successful SSO sign-in may add organization members, subject to membership and seat policies.'
    ),
  domainVerified: z.boolean().describe('Whether the provider has a verified domain grant.'),
  isPrimary: z
    .boolean()
    .describe('Whether this provider currently handles sign-in for its domain.'),
})
export type V2SsoProvider = z.output<typeof v2SsoProviderSchema>

const v2ListSsoProvidersQuerySchema = z
  .object({
    ...v2PaginationFields({ description: 'Maximum identity providers to return per page.' }),
    ...v2SortFields(['providerId', 'domain'], { sortBy: 'providerId', sortOrder: 'asc' }),
  })
  .strict()
export const v2ListSsoProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/sso/providers',
  params: v2SsoOrganizationParamsSchema,
  query: v2ListSsoProvidersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2SsoProviderSchema) },
})
export const v2GetSsoProviderContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/sso/providers/[providerId]',
  params: v2SsoProviderParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2SsoProviderSchema) },
})

const mapping = z
  .object({
    id: z
      .string()
      .min(1)
      .max(255)
      .default('sub')
      .describe('Claim holding the stable identity identifier.'),
    email: z.string().min(1).max(255).default('email').describe('Claim holding the email address.'),
    name: z.string().min(1).max(255).default('name').describe('Claim holding the display name.'),
    image: z.string().min(1).max(255).default('picture').describe('Claim holding the avatar URL.'),
  })
  .strict()
  .default({ id: 'sub', email: 'email', name: 'name', image: 'picture' })
  .describe('Identity-provider claims mapped to user fields.')
const shared = {
  providerId: nonEmptyIdSchema
    .max(255)
    .describe(
      'Globally unique provider ID; saving an existing provider replaces its supplied configuration.'
    ),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe('Email domain already verified by this organization.'),
  issuer: z.string().url().max(2048).describe('Identity provider issuer URL.'),
  mapping,
  jitProvisioningEnabled: z
    .boolean()
    .default(true)
    .describe(
      'Allow SSO sign-in to provision organization membership, subject to eligibility and available seats.'
    ),
}
const v2SaveSsoProviderBodySchema = z.discriminatedUnion('providerType', [
  ssoRegistrationInputSchema.options[0]
    .omit({ organizationId: true })
    .extend({
      ...shared,
      providerType: z.literal('oidc').describe('Configure an OpenID Connect identity provider.'),
      clientId: z.string().min(1).max(1024).describe('Identity provider client identifier.'),
      clientSecret: z
        .string()
        .min(1)
        .max(8192)
        .describe(
          'Write-only client secret; the redacted marker from Get SSO Provider preserves an existing secret.'
        )
        .meta({ writeOnly: true }),
      scopes: z
        .array(z.string().trim().min(1).max(255))
        .max(50)
        .default(['openid', 'profile', 'email'])
        .describe('OIDC scopes; offline_access is omitted.'),
      pkce: z.boolean().default(true).describe('Use PKCE for the authorization flow.'),
      skipUserInfoEndpoint: z
        .boolean()
        .default(false)
        .describe('Read identity claims from the ID token instead of calling UserInfo.'),
      authorizationEndpoint: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe('Optional authorization endpoint; otherwise resolved through issuer discovery.'),
      tokenEndpoint: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe('Optional token endpoint; otherwise resolved through issuer discovery.'),
      userInfoEndpoint: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe('Optional UserInfo endpoint.'),
      jwksEndpoint: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe('Optional signing-key endpoint; otherwise resolved through issuer discovery.'),
    })
    .strict(),
  ssoRegistrationInputSchema.options[1]
    .omit({ organizationId: true })
    .extend({
      ...shared,
      providerType: z.literal('saml').describe('Configure a SAML identity provider.'),
      entryPoint: z.string().url().max(2048).describe('Identity provider SAML sign-in endpoint.'),
      cert: z.string().min(1).max(65_536).describe('Identity provider signing certificate.'),
      callbackUrl: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe('SAML callback URL; defaults to this provider’s Sim callback.'),
      audience: z
        .string()
        .max(2048)
        .optional()
        .describe('SAML audience; omission preserves the saved value.'),
      wantAssertionsSigned: z
        .boolean()
        .optional()
        .describe('Require signed assertions; omission preserves the saved value.'),
      signatureAlgorithm: z
        .string()
        .max(255)
        .optional()
        .describe(
          'Signature algorithm accepted by the SAML configuration validator; omission preserves the saved value.'
        ),
      digestAlgorithm: z
        .string()
        .max(255)
        .optional()
        .describe(
          'Digest algorithm accepted by the SAML configuration validator; omission preserves the saved value.'
        ),
      identifierFormat: z
        .string()
        .max(2048)
        .optional()
        .describe('SAML NameID format; omission clears the saved value.'),
      idpMetadata: z
        .string()
        .max(102_400)
        .optional()
        .describe('Identity provider metadata XML; omission clears the saved document.'),
    })
    .strict(),
])
export const v2SaveSsoProviderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/sso/providers',
  params: v2SsoOrganizationParamsSchema,
  query: noInputSchema,
  body: v2SaveSsoProviderBodySchema,
  response: {
    mode: 'json',
    status: [200, 201],
    schema: v2DataResponse(
      z.object({
        providerId: nonEmptyIdSchema.describe('Saved provider identifier.'),
        providerType: z.enum(['oidc', 'saml']).describe('Saved identity provider protocol.'),
        created: z.boolean().describe('Whether a new provider was created.'),
      })
    ),
  },
})
export const v2DeleteSsoProviderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/organizations/[organizationId]/sso/providers/[providerId]',
  params: v2SsoProviderParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.object({
        providerId: nonEmptyIdSchema.describe('Removed provider identifier.'),
        deleted: z
          .literal(true)
          .describe('The provider was removed; existing accounts and memberships remain.'),
      })
    ),
  },
})
export const v2SetPrimarySsoProviderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/sso/providers/[providerId]/primary',
  params: v2SsoProviderParamsSchema,
  query: noInputSchema,
  body: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.object({
        providerId: nonEmptyIdSchema.describe('Provider selected for domain sign-in.'),
        domain: z.string().describe('Verified domain whose primary provider changed.'),
      })
    ),
  },
})

const v2SsoPolicySchema = z.object({
  requireSso: z.boolean().describe('Stored single sign-on requirement.'),
  hasVerifiedProvider: z
    .boolean()
    .describe('Whether a verified provider can satisfy the requirement.'),
  isEnforced: z.boolean().describe('Whether sign-in currently enforces the requirement.'),
})
export const v2GetSsoPolicyContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/sso/policy',
  params: v2SsoOrganizationParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2SsoPolicySchema) },
})
const v2UpdateSsoPolicyBodySchema = z
  .object({
    requireSso: z
      .boolean()
      .describe('Require organization SSO on future sign-ins; existing sessions remain active.'),
  })
  .strict()
export const v2UpdateSsoPolicyContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/organizations/[organizationId]/sso/policy',
  params: v2SsoOrganizationParamsSchema,
  query: noInputSchema,
  body: v2UpdateSsoPolicyBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2SsoPolicySchema) },
})

const v2OrganizationDomainSchema = z.object({
  id: nonEmptyIdSchema.describe('Domain claim identifier.'),
  domain: z.string().describe('Normalized email domain.'),
  status: z.enum(['pending', 'verified']).describe('DNS ownership verification state.'),
  verifiedAt: v2TimestampSchema.nullable().describe('When domain ownership was verified.'),
  challengeHost: z
    .string()
    .describe('DNS host where the verification TXT record must be published.'),
  txtRecordValue: z
    .string()
    .nullable()
    .describe('TXT record value for a pending domain; only administrators receive it.'),
})
const v2OrganizationDomainParamsSchema = v2SsoOrganizationParamsSchema
  .extend({
    domainId: nonEmptyIdSchema.max(255).describe('Domain claim owned by this organization.'),
  })
  .strict()
export const v2ListOrganizationDomainsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/domains',
  params: v2SsoOrganizationParamsSchema,
  query: z
    .object({
      ...v2PaginationFields({ description: 'Maximum domain claims to return per page.' }),
      ...v2SortFields(['domain'], { sortBy: 'domain', sortOrder: 'asc' }),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2OrganizationDomainSchema),
  },
})
const v2AddOrganizationDomainBodySchema = addOrganizationDomainBodySchema
  .extend({
    domain: addOrganizationDomainBodySchema.shape.domain.describe(
      'Domain to claim and verify through a DNS TXT record.'
    ),
  })
  .strict()
export const v2AddOrganizationDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/domains',
  params: v2SsoOrganizationParamsSchema,
  query: noInputSchema,
  body: v2AddOrganizationDomainBodySchema,
  response: {
    mode: 'json',
    status: [200, 201],
    schema: v2DataResponse(v2OrganizationDomainSchema),
  },
})
export const v2VerifyOrganizationDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/domains/[domainId]/verify',
  params: v2OrganizationDomainParamsSchema,
  query: noInputSchema,
  body: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationDomainSchema) },
})
export const v2RemoveOrganizationDomainContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/organizations/[organizationId]/domains/[domainId]',
  params: v2OrganizationDomainParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.object({
        id: nonEmptyIdSchema.describe('Removed domain claim identifier.'),
        deleted: z
          .literal(true)
          .describe(
            'The claim was removed; providers on this domain lose verified sign-in authority.'
          ),
      })
    ),
  },
})
