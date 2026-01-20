import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth, getSession } from '@/lib/auth'
import { hasSSOAccess } from '@/lib/billing'
import { env } from '@/lib/core/config/env'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'

const logger = createLogger('SSORegisterRoute')

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

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const hasAccess = await hasSSOAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'SSO requires an Enterprise plan' }, { status: 403 })
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
        authorizationEndpoint,
        tokenEndpoint,
        userInfoEndpoint,
        jwksEndpoint,
      } = body

      const oidcConfig: any = {
        clientId,
        clientSecret,
        scopes: Array.isArray(scopes)
          ? scopes.filter((s: string) => s !== 'offline_access')
          : ['openid', 'profile', 'email'].filter((s: string) => s !== 'offline_access'),
        pkce: pkce ?? true,
      }

      oidcConfig.authorizationEndpoint = authorizationEndpoint
      oidcConfig.tokenEndpoint = tokenEndpoint
      oidcConfig.userInfoEndpoint = userInfoEndpoint
      oidcConfig.jwksEndpoint = jwksEndpoint

      const needsDiscovery =
        !oidcConfig.authorizationEndpoint || !oidcConfig.tokenEndpoint || !oidcConfig.jwksEndpoint

      if (needsDiscovery) {
        const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
        try {
          logger.info('Fetching OIDC discovery document for missing endpoints', {
            discoveryUrl,
            hasAuthEndpoint: !!oidcConfig.authorizationEndpoint,
            hasTokenEndpoint: !!oidcConfig.tokenEndpoint,
            hasJwksEndpoint: !!oidcConfig.jwksEndpoint,
          })

          const discoveryResponse = await fetch(discoveryUrl, {
            headers: { Accept: 'application/json' },
          })

          if (!discoveryResponse.ok) {
            logger.error('Failed to fetch OIDC discovery document', {
              status: discoveryResponse.status,
              statusText: discoveryResponse.statusText,
            })
            return NextResponse.json(
              {
                error: `Failed to fetch OIDC discovery document from ${discoveryUrl}. Status: ${discoveryResponse.status}. Provide all endpoints explicitly or verify the issuer URL.`,
              },
              { status: 400 }
            )
          }

          const discovery = await discoveryResponse.json()

          oidcConfig.authorizationEndpoint =
            oidcConfig.authorizationEndpoint || discovery.authorization_endpoint
          oidcConfig.tokenEndpoint = oidcConfig.tokenEndpoint || discovery.token_endpoint
          oidcConfig.userInfoEndpoint = oidcConfig.userInfoEndpoint || discovery.userinfo_endpoint
          oidcConfig.jwksEndpoint = oidcConfig.jwksEndpoint || discovery.jwks_uri

          logger.info('Merged OIDC endpoints (user-provided + discovery)', {
            providerId,
            issuer,
            authorizationEndpoint: oidcConfig.authorizationEndpoint,
            tokenEndpoint: oidcConfig.tokenEndpoint,
            userInfoEndpoint: oidcConfig.userInfoEndpoint,
            jwksEndpoint: oidcConfig.jwksEndpoint,
          })
        } catch (error) {
          logger.error('Error fetching OIDC discovery document', {
            error: error instanceof Error ? error.message : 'Unknown error',
            discoveryUrl,
          })
          return NextResponse.json(
            {
              error: `Failed to fetch OIDC discovery document from ${discoveryUrl}. Please verify the issuer URL is correct or provide all endpoints explicitly.`,
            },
            { status: 400 }
          )
        }
      } else {
        logger.info('Using explicitly provided OIDC endpoints (all present)', {
          providerId,
          issuer,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          userInfoEndpoint: oidcConfig.userInfoEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
        })
      }

      if (
        !oidcConfig.authorizationEndpoint ||
        !oidcConfig.tokenEndpoint ||
        !oidcConfig.jwksEndpoint
      ) {
        const missing: string[] = []
        if (!oidcConfig.authorizationEndpoint) missing.push('authorizationEndpoint')
        if (!oidcConfig.tokenEndpoint) missing.push('tokenEndpoint')
        if (!oidcConfig.jwksEndpoint) missing.push('jwksEndpoint')

        logger.error('Missing required OIDC endpoints after discovery merge', {
          missing,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
        })
        return NextResponse.json(
          {
            error: `Missing required OIDC endpoints: ${missing.join(', ')}. Please provide these explicitly or verify the issuer supports OIDC discovery.`,
          },
          { status: 400 }
        )
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
      hasOidcConfig: !!providerConfig.oidcConfig,
      hasSamlConfig: !!providerConfig.samlConfig,
      samlConfigKeys: providerConfig.samlConfig ? Object.keys(providerConfig.samlConfig) : [],
      fullConfig: JSON.stringify(
        {
          ...providerConfig,
          oidcConfig: providerConfig.oidcConfig
            ? {
                ...providerConfig.oidcConfig,
                clientSecret: REDACTED_MARKER,
              }
            : undefined,
          samlConfig: providerConfig.samlConfig
            ? {
                ...providerConfig.samlConfig,
                cert: REDACTED_MARKER,
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
