#!/usr/bin/env bun

/**
 * Direct Database SSO Registration Script (Better Auth Best Practice)
 *
 * This script bypasses the authentication requirement by directly inserting
 * SSO provider records into the database, following the exact same logic
 * as Better Auth's registerSSOProvider endpoint.
 *
 * Usage: bun run packages/db/register-sso-provider.ts
 *
 * Required Environment Variables:
 *   SSO_ENABLED=true
 *   SSO_PROVIDER_TYPE=oidc|saml
 *   SSO_PROVIDER_ID=your-provider-id
 *   SSO_ISSUER=https://your-idp-url
 *   SSO_DOMAIN=your-email-domain.com
 *   SSO_USER_EMAIL=admin@yourdomain.com (must be existing user)
 *
 * OIDC Providers:
 *   SSO_OIDC_CLIENT_ID=your_client_id
 *   SSO_OIDC_CLIENT_SECRET=your_client_secret
 *   SSO_OIDC_SCOPES=openid,profile,email (optional)
 *
 * SAML Providers:
 *   SSO_SAML_ENTRY_POINT=https://your-idp/sso
 *   SSO_SAML_CERT=your-certificate-pem-string
 *   SSO_SAML_CALLBACK_URL=https://yourdomain.com/api/auth/sso/saml2/callback/provider-id
 *   SSO_SAML_SP_METADATA=<custom-sp-metadata-xml> (optional, auto-generated if not provided)
 *   SSO_SAML_IDP_METADATA=<idp-metadata-xml> (optional)
 *   SSO_SAML_AUDIENCE=https://yourdomain.com (optional, defaults to SSO_ISSUER)
 *   SSO_SAML_WANT_ASSERTIONS_SIGNED=true (optional, defaults to false)
 */

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { v4 as uuidv4 } from 'uuid'
import { ssoProvider, user } from '../schema'

// Self-contained SSO types (matching Better Auth's structure)
interface SSOMapping {
  id: string
  email: string
  name: string
  image?: string
}

interface OIDCConfig {
  clientId: string
  clientSecret: string
  scopes?: string[]
  pkce?: boolean
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userInfoEndpoint?: string
  jwksEndpoint?: string
  discoveryEndpoint?: string
  tokenEndpointAuthentication?: 'client_secret_post' | 'client_secret_basic'
}

interface SAMLConfig {
  issuer?: string
  entryPoint: string
  cert: string
  callbackUrl?: string
  audience?: string
  wantAssertionsSigned?: boolean
  signatureAlgorithm?: string
  digestAlgorithm?: string
  identifierFormat?: string
  idpMetadata?: {
    metadata?: string
    entityID?: string
    cert?: string
    privateKey?: string
    privateKeyPass?: string
    isAssertionEncrypted?: boolean
    encPrivateKey?: string
    encPrivateKeyPass?: string
    singleSignOnService?: Array<{
      Binding: string
      Location: string
    }>
  }
  spMetadata?: {
    metadata?: string
    entityID?: string
    binding?: string
    privateKey?: string
    privateKeyPass?: string
    isAssertionEncrypted?: boolean
    encPrivateKey?: string
    encPrivateKeyPass?: string
  }
  privateKey?: string
  decryptionPvk?: string
  additionalParams?: Record<string, unknown>
}

interface SSOProviderConfig {
  providerId: string
  issuer: string
  domain: string
  providerType: 'oidc' | 'saml'
  mapping?: SSOMapping
  oidcConfig?: OIDCConfig
  samlConfig?: SAMLConfig
}

// Simple console logger (no dependencies)
const logger = {
  info: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.log(
      `[${timestamp}] [INFO] [RegisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
  error: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.error(
      `[${timestamp}] [ERROR] [RegisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
  warn: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.warn(
      `[${timestamp}] [WARN] [RegisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
}

// Get database URL from environment
const CONNECTION_STRING = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
if (!CONNECTION_STRING) {
  console.error('❌ POSTGRES_URL or DATABASE_URL environment variable is required')
  process.exit(1)
}

// Initialize database connection (following migration script pattern)
const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
})
const db = drizzle(postgresClient)

interface SSOProviderData {
  id: string
  issuer: string
  domain: string
  oidcConfig?: string
  samlConfig?: string
  userId: string
  providerId: string
  organizationId?: string
}

// Self-contained configuration builder (no external dependencies)
function buildSSOConfigFromEnv(): SSOProviderConfig | null {
  const enabled = process.env.SSO_ENABLED === 'true'
  if (!enabled) return null

  const providerId = process.env.SSO_PROVIDER_ID
  const issuer = process.env.SSO_ISSUER
  const domain = process.env.SSO_DOMAIN
  const providerType = process.env.SSO_PROVIDER_TYPE as 'oidc' | 'saml'

  if (!providerId || !issuer || !domain || !providerType) {
    return null
  }

  const config: SSOProviderConfig = {
    providerId,
    issuer,
    domain,
    providerType,
  }

  // Build field mapping
  config.mapping = {
    id:
      process.env.SSO_MAPPING_ID ||
      (providerType === 'oidc'
        ? 'sub'
        : 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'),
    email:
      process.env.SSO_MAPPING_EMAIL ||
      (providerType === 'oidc'
        ? 'email'
        : 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'),
    name:
      process.env.SSO_MAPPING_NAME ||
      (providerType === 'oidc'
        ? 'name'
        : 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'),
    image: process.env.SSO_MAPPING_IMAGE || (providerType === 'oidc' ? 'picture' : undefined),
  }

  // Build provider-specific configuration
  if (providerType === 'oidc') {
    const clientId = process.env.SSO_OIDC_CLIENT_ID
    const clientSecret = process.env.SSO_OIDC_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return null
    }

    config.oidcConfig = {
      clientId,
      clientSecret,
      scopes: process.env.SSO_OIDC_SCOPES?.split(',').map((s) => s.trim()) || [
        'openid',
        'profile',
        'email',
      ],
      pkce: process.env.SSO_OIDC_PKCE !== 'false',
      authorizationEndpoint: process.env.SSO_OIDC_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: process.env.SSO_OIDC_TOKEN_ENDPOINT,
      userInfoEndpoint: process.env.SSO_OIDC_USERINFO_ENDPOINT,
      jwksEndpoint: process.env.SSO_OIDC_JWKS_ENDPOINT,
      discoveryEndpoint:
        process.env.SSO_OIDC_DISCOVERY_ENDPOINT || `${issuer}/.well-known/openid-configuration`,
    }
  } else if (providerType === 'saml') {
    const entryPoint = process.env.SSO_SAML_ENTRY_POINT
    const cert = process.env.SSO_SAML_CERT

    if (!entryPoint || !cert) {
      return null
    }

    const callbackUrl = process.env.SSO_SAML_CALLBACK_URL || `${issuer}/callback`

    // Use custom metadata if provided, otherwise generate default
    let spMetadata = process.env.SSO_SAML_SP_METADATA
    if (!spMetadata) {
      spMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${issuer}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${callbackUrl}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`
    }

    config.samlConfig = {
      issuer,
      entryPoint,
      cert,
      callbackUrl,
      audience: process.env.SSO_SAML_AUDIENCE || issuer,
      wantAssertionsSigned: process.env.SSO_SAML_WANT_ASSERTIONS_SIGNED === 'true',
      signatureAlgorithm: process.env.SSO_SAML_SIGNATURE_ALGORITHM,
      digestAlgorithm: process.env.SSO_SAML_DIGEST_ALGORITHM,
      identifierFormat: process.env.SSO_SAML_IDENTIFIER_FORMAT,
      spMetadata: {
        metadata: spMetadata,
        entityID: issuer,
      },
    }
    // Optionally include IDP metadata if provided
    const idpMetadata = process.env.SSO_SAML_IDP_METADATA
    if (idpMetadata) {
      config.samlConfig.idpMetadata = {
        metadata: idpMetadata,
      }
    }
  }

  return config
}

// Self-contained example environment variables function
function getExampleEnvVars(
  providerType: 'oidc' | 'saml',
  provider?: string
): Record<string, string> {
  const baseVars = {
    SSO_ENABLED: 'true',
    SSO_PROVIDER_TYPE: providerType,
    SSO_PROVIDER_ID: provider || (providerType === 'oidc' ? 'okta' : 'adfs'),
    SSO_DOMAIN: 'yourcompany.com',
    SSO_USER_EMAIL: 'admin@yourcompany.com',
  }

  if (providerType === 'oidc') {
    const examples: Record<string, Record<string, string>> = {
      okta: {
        ...baseVars,
        SSO_PROVIDER_ID: 'okta',
        SSO_ISSUER: 'https://dev-123456.okta.com/oauth2/default',
        SSO_OIDC_CLIENT_ID: '0oavhncxymgOpe06E697',
        SSO_OIDC_CLIENT_SECRET: 'your-client-secret',
        SSO_OIDC_SCOPES: 'openid,profile,email',
      },
      'azure-ad': {
        ...baseVars,
        SSO_PROVIDER_ID: 'azure-ad',
        SSO_ISSUER: 'https://login.microsoftonline.com/{tenant-id}/v2.0',
        SSO_OIDC_CLIENT_ID: 'your-application-id',
        SSO_OIDC_CLIENT_SECRET: 'your-client-secret',
        SSO_MAPPING_ID: 'oid',
      },
      generic: {
        ...baseVars,
        SSO_PROVIDER_ID: 'custom-oidc',
        SSO_ISSUER: 'https://idp.example.com',
        SSO_OIDC_CLIENT_ID: 'your-client-id',
        SSO_OIDC_CLIENT_SECRET: 'your-client-secret',
        SSO_OIDC_AUTHORIZATION_ENDPOINT: 'https://idp.example.com/auth',
        SSO_OIDC_TOKEN_ENDPOINT: 'https://idp.example.com/token',
        SSO_OIDC_USERINFO_ENDPOINT: 'https://idp.example.com/userinfo',
      },
    }
    return examples[provider || 'okta'] || examples.generic
  }

  return {
    ...baseVars,
    SSO_PROVIDER_ID: 'adfs',
    SSO_ISSUER: 'https://adfs.company.com',
    SSO_SAML_ENTRY_POINT: 'https://adfs.company.com/adfs/ls/',
    SSO_SAML_CERT:
      '-----BEGIN CERTIFICATE-----\nMIIDBjCCAe4CAQAwDQYJKoZIhvcNAQEFBQAwEjEQMA4GA1UEAwwHYWRmcy...\n-----END CERTIFICATE-----',
    SSO_SAML_AUDIENCE: 'https://yourapp.com',
    SSO_SAML_WANT_ASSERTIONS_SIGNED: 'true',
    SSO_MAPPING_ID: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
    SSO_MAPPING_EMAIL: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    SSO_MAPPING_NAME: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  }
}

async function getAdminUser(): Promise<{ id: string; email: string } | null> {
  const adminEmail = process.env.SSO_USER_EMAIL
  if (!adminEmail) {
    logger.error('SSO_USER_EMAIL is required to identify the admin user')
    return null
  }

  try {
    const users = await db.select().from(user).where(eq(user.email, adminEmail))
    if (users.length === 0) {
      logger.error(`No user found with email: ${adminEmail}`)
      logger.error('Please ensure this user exists in your database first')
      return null
    }
    return { id: users[0].id, email: users[0].email }
  } catch (error) {
    logger.error('Failed to query user:', error)
    return null
  }
}

async function registerSSOProvider(): Promise<boolean> {
  try {
    // Build configuration from environment variables
    const ssoConfig = buildSSOConfigFromEnv()

    if (!ssoConfig) {
      logger.error('❌ No valid SSO configuration found in environment variables')
      logger.error('')
      logger.error('📝 Required environment variables:')
      logger.error('For OIDC providers (like Okta, Azure AD):')
      const oidcExample = getExampleEnvVars('oidc', 'okta')
      for (const [key, value] of Object.entries(oidcExample)) {
        logger.error(`  ${key}=${value}`)
      }
      logger.error('  SSO_USER_EMAIL=admin@yourdomain.com')
      logger.error('')
      logger.error('For SAML providers (like ADFS):')
      const samlExample = getExampleEnvVars('saml')
      for (const [key, value] of Object.entries(samlExample)) {
        logger.error(`  ${key}=${value}`)
      }
      logger.error('  SSO_USER_EMAIL=admin@yourdomain.com')
      return false
    }

    // Get admin user
    const adminUser = await getAdminUser()
    if (!adminUser) {
      return false
    }

    logger.info('Registering SSO provider directly in database...', {
      providerId: ssoConfig.providerId,
      providerType: ssoConfig.providerType,
      domain: ssoConfig.domain,
      adminUser: adminUser.email,
    })

    // Validate issuer URL (same as Better Auth does)
    try {
      new URL(ssoConfig.issuer)
    } catch {
      logger.error('Invalid issuer. Must be a valid URL:', ssoConfig.issuer)
      return false
    }

    // Check if provider already exists
    const existingProviders = await db
      .select()
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, ssoConfig.providerId))

    if (existingProviders.length > 0) {
      logger.warn(`SSO provider with ID '${ssoConfig.providerId}' already exists`)
      logger.info('Updating existing provider...')
    }

    // Build provider data (following Better Auth's exact structure)
    const providerData: SSOProviderData = {
      id: uuidv4(), // Generate unique ID
      issuer: ssoConfig.issuer,
      domain: ssoConfig.domain,
      userId: adminUser.id,
      providerId: ssoConfig.providerId,
      organizationId: process.env.SSO_ORGANIZATION_ID || undefined,
    }

    // Build OIDC config (same as Better Auth endpoint)
    if (ssoConfig.providerType === 'oidc' && ssoConfig.oidcConfig) {
      const oidcConfig = {
        issuer: ssoConfig.issuer,
        clientId: ssoConfig.oidcConfig.clientId,
        clientSecret: ssoConfig.oidcConfig.clientSecret,
        authorizationEndpoint: ssoConfig.oidcConfig.authorizationEndpoint,
        tokenEndpoint: ssoConfig.oidcConfig.tokenEndpoint,
        tokenEndpointAuthentication: ssoConfig.oidcConfig.tokenEndpointAuthentication,
        jwksEndpoint: ssoConfig.oidcConfig.jwksEndpoint,
        pkce: ssoConfig.oidcConfig.pkce,
        discoveryEndpoint:
          ssoConfig.oidcConfig.discoveryEndpoint ||
          `${ssoConfig.issuer}/.well-known/openid-configuration`,
        mapping: ssoConfig.mapping,
        scopes: ssoConfig.oidcConfig.scopes,
        userInfoEndpoint: ssoConfig.oidcConfig.userInfoEndpoint,
        overrideUserInfo: false,
      }
      providerData.oidcConfig = JSON.stringify(oidcConfig)
    }

    // Build SAML config (same as Better Auth endpoint)
    if (ssoConfig.providerType === 'saml' && ssoConfig.samlConfig) {
      const samlConfig = {
        issuer: ssoConfig.issuer,
        entryPoint: ssoConfig.samlConfig.entryPoint,
        cert: ssoConfig.samlConfig.cert,
        callbackUrl: ssoConfig.samlConfig.callbackUrl,
        audience: ssoConfig.samlConfig.audience,
        idpMetadata: ssoConfig.samlConfig.idpMetadata,
        spMetadata: ssoConfig.samlConfig.spMetadata,
        wantAssertionsSigned: ssoConfig.samlConfig.wantAssertionsSigned,
        signatureAlgorithm: ssoConfig.samlConfig.signatureAlgorithm,
        digestAlgorithm: ssoConfig.samlConfig.digestAlgorithm,
        identifierFormat: ssoConfig.samlConfig.identifierFormat,
        privateKey: ssoConfig.samlConfig.privateKey,
        decryptionPvk: ssoConfig.samlConfig.decryptionPvk,
        additionalParams: ssoConfig.samlConfig.additionalParams,
        mapping: ssoConfig.mapping,
      }
      providerData.samlConfig = JSON.stringify(samlConfig)
    }

    // Insert or update the SSO provider record
    if (existingProviders.length > 0) {
      await db
        .update(ssoProvider)
        .set({
          issuer: providerData.issuer,
          domain: providerData.domain,
          oidcConfig: providerData.oidcConfig,
          samlConfig: providerData.samlConfig,
          userId: providerData.userId,
          organizationId: providerData.organizationId,
        })
        .where(eq(ssoProvider.providerId, ssoConfig.providerId))
    } else {
      await db.insert(ssoProvider).values(providerData)
    }

    logger.info('✅ SSO provider registered successfully in database!', {
      providerId: ssoConfig.providerId,
      providerType: ssoConfig.providerType,
      domain: ssoConfig.domain,
      id: providerData.id,
    })

    logger.info('🔗 Users can now sign in using SSO')

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || 'https://your-domain.com'
    const callbackUrl = `${baseUrl}/api/auth/sso/callback/${ssoConfig.providerId}`
    logger.info(`📋 Callback URL (configure this in your identity provider): ${callbackUrl}`)

    return true
  } catch (error) {
    logger.error('❌ Failed to register SSO provider:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: typeof error,
      errorDetails: JSON.stringify(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return false
  } finally {
    try {
      await postgresClient.end({ timeout: 5 })
    } catch {}
  }
}

async function main() {
  console.log('🔐 Direct Database SSO Registration Script (Better Auth Best Practice)')
  console.log('====================================================================')
  console.log('This script directly inserts SSO provider records into the database.')
  console.log("It follows Better Auth's exact registerSSOProvider logic.\n")

  // Register the SSO provider using direct database access
  const success = await registerSSOProvider()

  if (success) {
    console.log('🎉 SSO setup completed successfully!')
    console.log()
    console.log('Next steps:')
    console.log('1. Configure the callback URL in your identity provider')
    console.log('2. Restart your application if needed')
    console.log('3. Users can now sign in with SSO!')
    process.exit(0)
  } else {
    console.log('💥 SSO setup failed. Check the logs above for details.')
    process.exit(1)
  }
}

// Handle script execution
main().catch((error) => {
  logger.error('Script execution failed:', { error })
  process.exit(1)
})
