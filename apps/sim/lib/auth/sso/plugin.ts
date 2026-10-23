import { sso } from '@better-auth/sso'

/** Shares the configured SSO plugin between authentication and authorized provider writes. */
export const configuredSsoPlugin = sso({
  /**
   * Trusting `email_verified` bypasses Better Auth's trusted-domain linking
   * gate, allowing a tenant's IdP to claim an existing account in another
   * domain. Keep linking dependent on verified domain ownership instead.
   */
  trustEmailVerified: false,
  /**
   * Sim proves ownership through `sso_domain` and grants `domainVerified`
   * during the provider save. Better Auth requires that proof and a matching
   * email domain before linking an SSO identity to an existing account.
   */
  domainVerification: { enabled: true },
  organizationProvisioning: {
    /**
     * Better Auth writes member rows directly and bypasses Sim's seat,
     * billing, session-policy, and audit invariants. Admission is owned
     * by the application use case in the callback hook.
     */
    disabled: true,
    defaultRole: 'member',
  },
})
