/** The onboarding page the registration redirect lands on. Client-safe. */
export const AWS_MARKETPLACE_ONBOARDING_PATH = '/marketplace/aws'

/** Why a registration ended without a claim, carried to the onboarding page as `?error=`. */
export const AWS_MARKETPLACE_ONBOARDING_ERRORS = [
  'invalid',
  'no-subscription',
  'not-started',
  'unavailable',
] as const
export type AwsMarketplaceOnboardingError = (typeof AWS_MARKETPLACE_ONBOARDING_ERRORS)[number]

/** What the buyer is promised on the onboarding page and in their confirmation email. */
export const AWS_MARKETPLACE_SETUP_TURNAROUND = 'within 2 business days'
