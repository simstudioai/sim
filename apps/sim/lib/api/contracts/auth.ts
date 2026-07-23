import { z } from 'zod'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const ssoProvidersQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
})

export const authProviderStatusResponseSchema = z.object({
  githubAvailable: z.boolean(),
  googleAvailable: z.boolean(),
  microsoftAvailable: z.boolean(),
  registrationDisabled: z.boolean(),
})

const ssoMappingSchema = z
  .object({
    id: z.string().default('sub'),
    email: z.string().default('email'),
    name: z.string().default('name'),
    image: z.string().default('picture'),
  })
  .default({
    id: 'sub',
    email: 'email',
    name: 'name',
    image: 'picture',
  })

const ssoProviderIdSchema = z
  .string()
  .min(1, 'Provider ID is required')
  .max(44, 'Provider ID must be 44 characters or fewer')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers, and dashes')

const webUrlSchema = (message: string) =>
  z
    .string()
    .url(message)
    .refine(
      (value) => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol),
      message
    )

const ssoCommonConfigurationSchema = {
  issuer: webUrlSchema('Issuer must be a valid HTTP(S) URL'),
  domain: z.string().min(1, 'Domain is required').max(253, 'Domain is too long'),
  mapping: ssoMappingSchema,
}

const ssoOidcConfigurationSchema = {
  ...ssoCommonConfigurationSchema,
  clientId: z.string().min(1, 'Client ID is required for OIDC'),
  clientSecret: z.string().min(1, 'Client Secret is required for OIDC'),
  scopes: z
    .union([
      z.string().transform((s) =>
        s
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value !== '')
      ),
      z.array(z.string()),
    ])
    .default(['openid', 'profile', 'email']),
  pkce: z.boolean().default(true),
  authorizationEndpoint: webUrlSchema('Authorization endpoint must be HTTP(S)').optional(),
  tokenEndpoint: webUrlSchema('Token endpoint must be HTTP(S)').optional(),
  userInfoEndpoint: webUrlSchema('User info endpoint must be HTTP(S)').optional(),
  skipUserInfoEndpoint: z.boolean().default(false),
  jwksEndpoint: webUrlSchema('JWKS endpoint must be HTTP(S)').optional(),
}

const ssoSamlConfigurationSchema = {
  ...ssoCommonConfigurationSchema,
  entryPoint: webUrlSchema('Entry point must be a valid HTTP(S) URL for SAML'),
  cert: z.string().min(1, 'Certificate is required for SAML'),
  callbackUrl: webUrlSchema('Callback URL must be HTTP(S)').optional(),
  audience: z.string().optional(),
  wantAssertionsSigned: z.boolean().optional(),
  signatureAlgorithm: z.string().optional(),
  digestAlgorithm: z.string().optional(),
  identifierFormat: z.string().optional(),
  idpMetadata: z.string().optional(),
}

export const ssoRegistrationBodySchema = z.discriminatedUnion('providerType', [
  z
    .object({
      providerType: z.literal('oidc').default('oidc'),
      providerId: ssoProviderIdSchema,
      orgId: z.string().min(1, 'Organization ID is required'),
      ...ssoOidcConfigurationSchema,
    })
    .strict(),
  z
    .object({
      providerType: z.literal('saml'),
      providerId: ssoProviderIdSchema,
      orgId: z.string().min(1, 'Organization ID is required'),
      ...ssoSamlConfigurationSchema,
    })
    .strict(),
])

export type SsoRegistrationBody = z.input<typeof ssoRegistrationBodySchema>
export type SsoRegistrationData = z.output<typeof ssoRegistrationBodySchema>

const ssoMutationResponseSchema = z.object({
  success: z.literal(true),
  providerId: z.string(),
  providerType: z.enum(['oidc', 'saml']),
  domainVerified: z.boolean(),
  message: z.string(),
})

export const ssoRegistrationContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/sso/register',
  body: ssoRegistrationBodySchema,
  response: {
    mode: 'json',
    schema: ssoMutationResponseSchema,
  },
})

export const ssoProviderParamsSchema = z.object({
  id: z.string().min(1, 'Provider row ID is required'),
})

export const ssoUpdateBodySchema = z.union([
  z.object(ssoOidcConfigurationSchema).strict(),
  z.object(ssoSamlConfigurationSchema).strict(),
])

export type SsoUpdateBody = z.input<typeof ssoUpdateBodySchema>
export type SsoUpdateData = z.output<typeof ssoUpdateBodySchema>

export const updateSsoProviderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/auth/sso/providers/[id]',
  params: ssoProviderParamsSchema,
  body: ssoUpdateBodySchema,
  response: {
    mode: 'json',
    schema: ssoMutationResponseSchema,
  },
})

export const deleteSsoProviderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/auth/sso/providers/[id]',
  params: ssoProviderParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

const ssoProviderListEntrySchema = z.object({
  id: z.string().optional(),
  providerId: z.string().optional(),
  domain: z.string().nullable(),
  issuer: z.string().nullable().optional(),
  oidcConfig: z.string().nullable().optional(),
  samlConfig: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  providerType: z.enum(['oidc', 'saml']).optional(),
  domainVerified: z.boolean().optional(),
  isCreator: z.boolean().optional(),
  canManageVerification: z.boolean().optional(),
})

export const listSsoProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/sso/providers',
  query: ssoProvidersQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      providers: z.array(ssoProviderListEntrySchema),
    }),
  },
})

export type SsoProviderListResponse = ContractJsonResponse<typeof listSsoProvidersContract>

export const requestSsoDomainVerificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/sso/providers/[id]/domain-verification/request',
  params: ssoProviderParamsSchema,
  response: {
    mode: 'json',
    status: 201,
    schema: z.object({
      recordName: z.string(),
      recordValue: z.string(),
    }),
  },
})

export const verifySsoDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/sso/providers/[id]/domain-verification/verify',
  params: ssoProviderParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const getAuthProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/providers',
  response: {
    mode: 'json',
    schema: authProviderStatusResponseSchema,
  },
})

export type AuthProviderStatusResponse = ContractJsonResponse<typeof getAuthProvidersContract>
