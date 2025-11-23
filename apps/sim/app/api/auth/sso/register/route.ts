import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SSO-Register')

const mappingSchema = z
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

const ssoRegistrationSchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('oidc').default('oidc'),
    providerId: z.string().min(1, 'Provider ID is required'),
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    mapping: mappingSchema,
    clientId: z.string().min(1, 'Client ID is required for OIDC'),
    clientSecret: z.string().min(1, 'Client Secret is required for OIDC'),
    scopes: z
      .union([
        z.string().transform((s) =>
          s
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '')
        ),
        z.array(z.string()),
      ])
      .default(['openid', 'profile', 'email']),
    pkce: z.boolean().default(true),
    discoveryEndpoint: z.string().url().optional(),
    authorizationEndpoint: z.string().url().optional(),
    tokenEndpoint: z.string().url().optional(),
    userInfoEndpoint: z.string().url().optional(),
    jwksEndpoint: z.string().url().optional(),
    tokenEndpointAuthentication: z
      .union([z.literal('client_secret_post'), z.literal('client_secret_basic')])
      .optional(),
  }),
  z.object({
    providerType: z.literal('saml'),
    providerId: z.string().min(1, 'Provider ID is required'),
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    mapping: mappingSchema,
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

export async function POST(request: NextRequest) {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }

    const rawBody = await request.json()

    const parseResult = ssoRegistrationSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn('Invalid SSO registration request', {
        errors: parseResult.error.errors,
      })

      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 400 }
      )
    }

    const body = parseResult.data
    const { providerId, issuer, domain, providerType, mapping } = body

    let resolvedAuthorizationEndpoint: string | undefined
    let resolvedTokenEndpoint: string | undefined
    let resolvedUserInfoEndpoint: string | undefined
    let resolvedJwksEndpoint: string | undefined
    let resolvedDiscoveryEndpoint: string | undefined
    let hasExplicitOidcEndpoints = false
    let normalizedScopes: string[] = []
    let normalizedPkce = true

    if (providerType === 'oidc') {
      const {
        clientId,
        clientSecret,
        scopes,
        pkce,
        discoveryEndpoint,
        authorizationEndpoint,
        tokenEndpoint,
        userInfoEndpoint,
        jwksEndpoint,
        tokenEndpointAuthentication,
      } = body

      if (!clientId || !clientSecret) {
        return NextResponse.json(
          { error: 'Missing required OIDC fields: clientId, clientSecret' },
          { status: 400 }
        )
      }

      normalizedScopes = Array.isArray(scopes)
        ? scopes.filter((s: string) => s !== 'offline_access')
        : ['openid', 'profile', 'email']

      normalizedPkce = pkce ?? true

      resolvedAuthorizationEndpoint =
        authorizationEndpoint || env.SSO_OIDC_AUTHORIZATION_ENDPOINT || undefined
      resolvedTokenEndpoint = tokenEndpoint || env.SSO_OIDC_TOKEN_ENDPOINT || undefined
      resolvedUserInfoEndpoint = userInfoEndpoint || env.SSO_OIDC_USERINFO_ENDPOINT || undefined
      resolvedJwksEndpoint = jwksEndpoint || env.SSO_OIDC_JWKS_ENDPOINT || undefined
      resolvedDiscoveryEndpoint =
        discoveryEndpoint ||
        env.SSO_OIDC_DISCOVERY_ENDPOINT ||
        `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`

      hasExplicitOidcEndpoints =
        !!resolvedAuthorizationEndpoint ||
        !!resolvedTokenEndpoint ||
        !!resolvedUserInfoEndpoint ||
        !!resolvedJwksEndpoint ||
        !!discoveryEndpoint ||
        !!env.SSO_OIDC_DISCOVERY_ENDPOINT

      if (!Array.isArray(normalizedScopes) || normalizedScopes.length === 0) {
        normalizedScopes = ['openid', 'profile', 'email']
      }

      // attach tokenEndpointAuthentication to body so it's available when we build the config
      body.tokenEndpointAuthentication = tokenEndpointAuthentication
    } else if (providerType === 'saml') {
      const { entryPoint, cert } = body

      if (!entryPoint || !cert) {
        return NextResponse.json(
          { error: 'Missing required SAML fields: entryPoint, cert' },
          { status: 400 }
        )
      }
    }

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    const providerConfig: any = {
      providerId,
      issuer,
      domain,
      mapping,
    }

    if (providerType === 'oidc') {
      const {
        clientId,
        clientSecret,
        scopes,
        pkce,
        tokenEndpointAuthentication,
      } = body

      const oidcConfig: any = {
        clientId,
        clientSecret,
        scopes: normalizedScopes,
        pkce: normalizedPkce,
      }

      if (resolvedDiscoveryEndpoint) {
        oidcConfig.discoveryEndpoint = resolvedDiscoveryEndpoint
      }

      if (resolvedAuthorizationEndpoint) {
        oidcConfig.authorizationEndpoint = resolvedAuthorizationEndpoint
      }
      if (resolvedTokenEndpoint) {
        oidcConfig.tokenEndpoint = resolvedTokenEndpoint
      }
      if (resolvedUserInfoEndpoint) {
        oidcConfig.userInfoEndpoint = resolvedUserInfoEndpoint
      }
      if (resolvedJwksEndpoint) {
        oidcConfig.jwksEndpoint = resolvedJwksEndpoint
      }
      if (tokenEndpointAuthentication) {
        oidcConfig.tokenEndpointAuthentication = tokenEndpointAuthentication
      }

      // Add manual endpoints for providers that might need them
      // Common patterns for OIDC providers that don't support discovery properly
      if (!hasExplicitOidcEndpoints) {
        if (
          issuer.includes('okta.com') ||
          issuer.includes('auth0.com') ||
          issuer.includes('identityserver')
        ) {
          const baseUrl = issuer.includes('/oauth2/default')
            ? issuer.replace('/oauth2/default', '')
            : issuer.replace('/oauth', '').replace('/v2.0', '').replace('/oauth2', '')

          // Okta-style endpoints
          if (issuer.includes('okta.com')) {
            oidcConfig.authorizationEndpoint = `${baseUrl}/oauth2/default/v1/authorize`
            oidcConfig.tokenEndpoint = `${baseUrl}/oauth2/default/v1/token`
            oidcConfig.userInfoEndpoint = `${baseUrl}/oauth2/default/v1/userinfo`
            oidcConfig.jwksEndpoint = `${baseUrl}/oauth2/default/v1/keys`
          }
          // Auth0-style endpoints
          else if (issuer.includes('auth0.com')) {
            oidcConfig.authorizationEndpoint = `${baseUrl}/authorize`
            oidcConfig.tokenEndpoint = `${baseUrl}/oauth/token`
            oidcConfig.userInfoEndpoint = `${baseUrl}/userinfo`
            oidcConfig.jwksEndpoint = `${baseUrl}/.well-known/jwks.json`
          }
          // Generic OIDC endpoints (IdentityServer, etc.)
          else {
            oidcConfig.authorizationEndpoint = `${baseUrl}/connect/authorize`
            oidcConfig.tokenEndpoint = `${baseUrl}/connect/token`
            oidcConfig.userInfoEndpoint = `${baseUrl}/connect/userinfo`
            oidcConfig.jwksEndpoint = `${baseUrl}/.well-known/jwks`
          }

          logger.info('Using manual OIDC endpoints for provider', {
            providerId,
            provider: issuer.includes('okta.com')
              ? 'Okta'
              : issuer.includes('auth0.com')
                ? 'Auth0'
                : 'Generic',
            authEndpoint: oidcConfig.authorizationEndpoint,
          })
        }
      }

      providerConfig.oidcConfig = oidcConfig
    } else if (providerType === 'saml') {
      const {
        entryPoint,
        cert,
        callbackUrl,
        audience,
        wantAssertionsSigned,
        signatureAlgorithm,
        digestAlgorithm,
        identifierFormat,
        idpMetadata,
      } = body

      const computedCallbackUrl =
        callbackUrl || `${issuer.replace('/metadata', '')}/callback/${providerId}`

      const escapeXml = (str: string) =>
        str.replace(/[<>&"']/g, (c) => {
          switch (c) {
            case '<':
              return '&lt;'
            case '>':
              return '&gt;'
            case '&':
              return '&amp;'
            case '"':
              return '&quot;'
            case "'":
              return '&apos;'
            default:
              return c
          }
        })

      const spMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(issuer)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(computedCallbackUrl)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`

      const samlConfig: any = {
        entryPoint,
        cert,
        callbackUrl: computedCallbackUrl,
        spMetadata: {
          metadata: spMetadataXml,
        },
        mapping,
      }

      if (audience) samlConfig.audience = audience
      if (wantAssertionsSigned !== undefined) samlConfig.wantAssertionsSigned = wantAssertionsSigned
      if (signatureAlgorithm) samlConfig.signatureAlgorithm = signatureAlgorithm
      if (digestAlgorithm) samlConfig.digestAlgorithm = digestAlgorithm
      if (identifierFormat) samlConfig.identifierFormat = identifierFormat
      if (idpMetadata) {
        samlConfig.idpMetadata = {
          metadata: idpMetadata,
        }
      }

      providerConfig.samlConfig = samlConfig
      providerConfig.mapping = undefined
    }

    logger.info('Calling Better Auth registerSSOProvider with config:', {
      providerId: providerConfig.providerId,
      domain: providerConfig.domain,
      hasDiscoveryEndpoint: !!providerConfig.oidcConfig?.discoveryEndpoint,
      hasManualOidcEndpoints: !!(
        providerConfig.oidcConfig &&
        (providerConfig.oidcConfig.authorizationEndpoint ||
          providerConfig.oidcConfig.tokenEndpoint ||
          providerConfig.oidcConfig.userInfoEndpoint ||
          providerConfig.oidcConfig.jwksEndpoint)
      ),
      hasOidcConfig: !!providerConfig.oidcConfig,
      hasSamlConfig: !!providerConfig.samlConfig,
      samlConfigKeys: providerConfig.samlConfig ? Object.keys(providerConfig.samlConfig) : [],
      fullConfig: JSON.stringify(
        {
          ...providerConfig,
          oidcConfig: providerConfig.oidcConfig
            ? {
                ...providerConfig.oidcConfig,
                clientSecret: '[REDACTED]',
              }
            : undefined,
          samlConfig: providerConfig.samlConfig
            ? {
                ...providerConfig.samlConfig,
                cert: '[REDACTED]',
              }
            : undefined,
        },
        null,
        2
      ),
    })

    const registration = await auth.api.registerSSOProvider({
      body: providerConfig,
      headers,
    })

    logger.info('SSO provider registered successfully', {
      providerId,
      providerType,
      domain,
    })

    return NextResponse.json({
      success: true,
      providerId: registration.providerId,
      providerType,
      message: `${providerType.toUpperCase()} provider registered successfully`,
    })
  } catch (error) {
    logger.error('Failed to register SSO provider', {
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorDetails: JSON.stringify(error),
    })

    return NextResponse.json(
      {
        error: 'Failed to register SSO provider',
        details: error instanceof Error ? error.message : 'Unknown error',
        fullError: JSON.stringify(error),
      },
      { status: 500 }
    )
  }
}
