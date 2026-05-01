import { z } from 'zod'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const ssoProvidersQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
})

export const authProviderStatusResponseSchema = z.object({
  githubAvailable: z.boolean(),
  googleAvailable: z.boolean(),
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

export const ssoRegistrationBodySchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('oidc').default('oidc'),
    providerId: z.string().min(1, 'Provider ID is required'),
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    orgId: z.string().optional(),
    mapping: ssoMappingSchema,
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
    authorizationEndpoint: z.string().url().optional(),
    tokenEndpoint: z.string().url().optional(),
    userInfoEndpoint: z.string().url().optional(),
    jwksEndpoint: z.string().url().optional(),
  }),
  z.object({
    providerType: z.literal('saml'),
    providerId: z.string().min(1, 'Provider ID is required'),
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    orgId: z.string().optional(),
    mapping: ssoMappingSchema,
    entryPoint: z.string().url('Entry point must be a valid URL for SAML'),
    cert: z.string().min(1, 'Certificate is required for SAML'),
    callbackUrl: z.string().url().optional(),
    audience: z.string().optional(),
    wantAssertionsSigned: z.boolean().optional(),
    signatureAlgorithm: z.string().optional(),
    digestAlgorithm: z.string().optional(),
    identifierFormat: z.string().optional(),
    idpMetadata: z.string().optional(),
  }),
])

export type SsoRegistrationBody = z.input<typeof ssoRegistrationBodySchema>

export const ssoRegistrationContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/sso/register',
  body: ssoRegistrationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      providerId: z.string(),
      providerType: z.enum(['oidc', 'saml']),
      message: z.string(),
    }),
  },
})

const ssoProviderListEntrySchema = z.object({
  id: z.string().optional(),
  providerId: z.string().optional(),
  domain: z.string().nullable(),
  issuer: z.string().nullable().optional(),
  oidcConfig: z.string().nullable().optional(),
  samlConfig: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  providerType: z.enum(['oidc', 'saml']).optional(),
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

export const getAuthProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/providers',
  response: {
    mode: 'json',
    schema: authProviderStatusResponseSchema,
  },
})

export type AuthProviderStatusResponse = ContractJsonResponse<typeof getAuthProvidersContract>
