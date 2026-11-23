import { z } from 'zod'
import { requiredFieldSchema } from '@/lib/api/contracts/primitives'
import { SSO_PROVIDER_ID_PATTERN } from '@/lib/auth/sso/callback-provider'

/** SSO provider ID limited to {@link SSO_PROVIDER_ID_PATTERN}, shared by every provider write. */
export const ssoProviderIdSchema = requiredFieldSchema('Provider ID is required').regex(
  SSO_PROVIDER_ID_PATTERN,
  'Provider ID may only contain letters, numbers, dashes, underscores, periods, and colons (up to 128 characters)'
)

const ssoMappingSchema = z
  .object({
    id: z.string().min(1).max(255).default('sub'),
    email: z.string().min(1).max(255).default('email'),
    name: z.string().min(1).max(255).default('name'),
    image: z.string().min(1).max(255).default('picture'),
  })
  .default({
    id: 'sub',
    email: 'email',
    name: 'name',
    image: 'picture',
  })

export const ssoRegistrationInputSchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('oidc'),
    providerId: ssoProviderIdSchema,
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    organizationId: z.string().min(1).max(255),
    jitProvisioningEnabled: z.boolean().default(true),
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
        z.array(z.string().trim().min(1)),
      ])
      .default(['openid', 'profile', 'email']),
    pkce: z.boolean().default(true),
    authorizationEndpoint: z.string().url().optional(),
    tokenEndpoint: z.string().url().optional(),
    userInfoEndpoint: z.string().url().optional(),
    skipUserInfoEndpoint: z.boolean().default(false),
    jwksEndpoint: z.string().url().optional(),
  }),
  z.object({
    providerType: z.literal('saml'),
    providerId: ssoProviderIdSchema,
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    organizationId: z.string().min(1).max(255),
    jitProvisioningEnabled: z.boolean().default(true),
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

export type SsoRegistrationInput = z.output<typeof ssoRegistrationInputSchema>
