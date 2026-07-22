export const SSO_DISABLED_PATHS = [
  '/sso/register',
  '/sso/update-provider',
  '/sso/delete-provider',
  '/sso/request-domain-verification',
  '/sso/verify-domain',
] as const

export const SSO_RESERVED_PROVIDER_IDS = ['google', 'github', 'email-password'] as const

export const SSO_DOMAIN_VERIFICATION_OPTIONS = {
  domainVerification: {
    enabled: true,
  },
} as const

/**
 * Better Auth conditionally exposes verification methods from a literal-true
 * option. Callers guard those methods with the same runtime flag.
 */
export function getSsoServerSecurityOptions(domainVerificationEnabled: boolean) {
  return {
    domainVerification: {
      enabled: domainVerificationEnabled as true,
    },
    // Preserve pre-migration linking behavior until verified-domain enforcement
    // is activated. Once active, the verified provider domain is the trust
    // boundary instead of an IdP-controlled email_verified claim.
    trustEmailVerified: !domainVerificationEnabled,
    /**
     * Better Auth 1.6.13 does not honor requestSignUp in the SAML callback.
     * Verified-domain gating is therefore the trust boundary for JIT
     * provisioning until SAML supports the same explicit opt-in as OIDC.
     */
    disableImplicitSignUp: false,
  } as const
}

export const SSO_SERVER_SECURITY_OPTIONS = getSsoServerSecurityOptions(true)

export function getAccountLinkingTrustedProviders(operatorSsoProviderIds: string[]): string[] {
  return [...SSO_RESERVED_PROVIDER_IDS, ...operatorSsoProviderIds]
}
