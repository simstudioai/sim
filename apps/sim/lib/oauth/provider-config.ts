import { getEnv } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { OAuthProvider } from '@/lib/oauth/types'

export type OAuthProviderConfigStatus = {
  providerId: OAuthProvider | string
  available: boolean
  status: 'ready' | 'missing_env' | 'placeholder_env' | 'invalid_env'
  message: string
  redirectUri?: string
  requiredEnv: string[]
}

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'
const PLACEHOLDER_PATTERN = /^(|your-|change-me|changeme|example|<.*>)$/i

function hasPlaceholderValue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim()
  return PLACEHOLDER_PATTERN.test(normalized) || normalized.includes('your-google-client')
}

function isGoogleProvider(providerId: string): boolean {
  return providerId === 'google' || providerId.startsWith('google-') || providerId === 'vertex-ai'
}

export function getOAuthRedirectUri(providerId: string, baseUrl = getBaseUrl()): string {
  return `${baseUrl.replace(/\/$/, '')}/api/auth/oauth2/callback/${providerId}`
}

export function getOAuthProviderConfigStatus(
  providerId: OAuthProvider | string
): OAuthProviderConfigStatus {
  const requiredEnv = isGoogleProvider(providerId)
    ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
    : []

  if (!isGoogleProvider(providerId)) {
    return {
      providerId,
      available: true,
      status: 'ready',
      message: 'OAuth provider configuration is ready.',
      requiredEnv,
    }
  }

  const clientId = getEnv('GOOGLE_CLIENT_ID')?.trim()
  const clientSecret = getEnv('GOOGLE_CLIENT_SECRET')?.trim()
  const redirectUri = getOAuthRedirectUri(providerId)

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId ? 'GOOGLE_CLIENT_ID' : null,
      !clientSecret ? 'GOOGLE_CLIENT_SECRET' : null,
    ].filter(Boolean)
    return {
      providerId,
      available: false,
      status: 'missing_env',
      message: `Google OAuth is not configured. Set ${missing.join(' and ')} and add ${redirectUri} as an authorized redirect URI in Google Cloud.`,
      redirectUri,
      requiredEnv,
    }
  }

  if (hasPlaceholderValue(clientId) || hasPlaceholderValue(clientSecret)) {
    return {
      providerId,
      available: false,
      status: 'placeholder_env',
      message: `Google OAuth still has placeholder credentials. Replace GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then add ${redirectUri} as an authorized redirect URI in Google Cloud.`,
      redirectUri,
      requiredEnv,
    }
  }

  if (!clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
    return {
      providerId,
      available: false,
      status: 'invalid_env',
      message: `GOOGLE_CLIENT_ID does not look like a Google OAuth web client ID. It should end with ${GOOGLE_CLIENT_ID_SUFFIX}, and ${redirectUri} must be registered as an authorized redirect URI.`,
      redirectUri,
      requiredEnv,
    }
  }

  return {
    providerId,
    available: true,
    status: 'ready',
    message: 'Google OAuth provider configuration is ready.',
    redirectUri,
    requiredEnv,
  }
}
