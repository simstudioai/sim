import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SSO-Register')

export async function POST(request: NextRequest) {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }

    const body = await request.json()
    const {
      providerId,
      issuer,
      domain,
      providerType = 'oidc',
      // OIDC specific fields
      clientId,
      clientSecret,
      scopes = ['openid', 'profile', 'email'],
      pkce = true,
      // SAML specific fields
      entryPoint,
      cert,
      callbackUrl,
      audience,
      wantAssertionsSigned,
      signatureAlgorithm,
      digestAlgorithm,
      identifierFormat,
      idpMetadata,
      // Mapping configuration
      mapping = {
        id: 'sub',
        email: 'email',
        name: 'name',
        image: 'picture',
      },
    } = body

    if (!providerId || !issuer || !domain) {
      return NextResponse.json(
        { error: 'Missing required fields: providerId, issuer, domain' },
        { status: 400 }
      )
    }

    if (providerType === 'oidc') {
      if (!clientId || !clientSecret) {
        return NextResponse.json(
          { error: 'Missing required OIDC fields: clientId, clientSecret' },
          { status: 400 }
        )
      }
    } else if (providerType === 'saml') {
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
      const oidcConfig: any = {
        clientId,
        clientSecret,
        scopes:
          typeof scopes === 'string'
            ? scopes
                .split(',')
                .map((s: string) => s.trim())
                .filter((s: string) => s !== 'offline_access')
            : (scopes || ['openid', 'profile', 'email']).filter(
                (s: string) => s !== 'offline_access'
              ),
        pkce: pkce ?? true,
      }

      // Add manual endpoints for providers that might need them
      // Common patterns for OIDC providers that don't support discovery properly
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

      providerConfig.oidcConfig = oidcConfig
    } else if (providerType === 'saml') {
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
