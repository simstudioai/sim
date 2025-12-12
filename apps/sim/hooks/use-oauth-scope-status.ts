'use client'

import type { Credential } from '@/lib/oauth/oauth'

export interface OAuthScopeStatus {
  requiresReauthorization: boolean
  missingScopes: string[]
  extraScopes: string[]
  canonicalScopes: string[]
  grantedScopes: string[]
}

/**
 * Extract scope status from a credential
 */
export function getCredentialScopeStatus(credential: Credential): OAuthScopeStatus {
  return {
    requiresReauthorization: credential.requiresReauthorization || false,
    missingScopes: credential.missingScopes || [],
    extraScopes: credential.extraScopes || [],
    canonicalScopes: credential.canonicalScopes || [],
    grantedScopes: credential.scopes || [],
  }
}

/**
 * Check if a credential needs reauthorization
 */
export function credentialNeedsReauth(credential: Credential): boolean {
  return credential.requiresReauthorization || false
}

/**
 * Check if any credentials in a list need reauthorization
 */
export function anyCredentialNeedsReauth(credentials: Credential[]): boolean {
  return credentials.some(credentialNeedsReauth)
}

/**
 * Get all credentials that need reauthorization
 */
export function getCredentialsNeedingReauth(credentials: Credential[]): Credential[] {
  return credentials.filter(credentialNeedsReauth)
}

/**
 * Scopes that control token behavior but are not returned in OAuth token responses.
 * These should be ignored when validating credential scopes.
 */
const IGNORED_SCOPES = new Set([
  'offline_access', // Microsoft - requests refresh token
  'refresh_token', // Salesforce - requests refresh token
  'offline.access', // Airtable - requests refresh token (note: dot not underscore)
])

/**
 * Compute which of the provided requiredScopes are NOT granted by the credential.
 * Note: Ignores special OAuth scopes that control token behavior (like offline_access)
 * as they are not returned in the token response's scope list even when granted.
 */
export function getMissingRequiredScopes(
  credential: Credential | undefined,
  requiredScopes: string[] = []
): string[] {
  if (!credential) {
    // Filter out ignored scopes from required scopes as they're not returned by OAuth providers
    return requiredScopes.filter((s) => !IGNORED_SCOPES.has(s))
  }

  const granted = new Set((credential.scopes || []).map((s) => s))
  const missing: string[] = []

  for (const s of requiredScopes) {
    // Skip ignored scopes as providers don't return them in the scope list even when granted
    if (IGNORED_SCOPES.has(s)) continue

    if (!granted.has(s)) missing.push(s)
  }

  return missing
}

/**
 * Whether a credential needs an upgrade specifically for the provided required scopes.
 */
export function needsUpgradeForRequiredScopes(
  credential: Credential | undefined,
  requiredScopes: string[] = []
): boolean {
  return getMissingRequiredScopes(credential, requiredScopes).length > 0
}
