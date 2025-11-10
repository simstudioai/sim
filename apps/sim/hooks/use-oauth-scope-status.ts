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
 * Compute which of the provided requiredScopes are NOT granted by the credential.
 */
export function getMissingRequiredScopes(
  credential: Credential | undefined,
  requiredScopes: string[] = []
): string[] {
  if (!credential) return [...requiredScopes]
  const granted = new Set((credential.scopes || []).map((s) => s))
  const missing: string[] = []
  for (const s of requiredScopes) {
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
