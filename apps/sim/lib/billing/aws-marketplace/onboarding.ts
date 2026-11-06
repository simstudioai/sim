/** The onboarding page the registration redirect lands on. Client-safe. */
export const AWS_MARKETPLACE_ONBOARDING_PATH = '/marketplace/aws'

/** Why a registration ended without a claim, carried to the onboarding page as `?error=`. */
export const AWS_MARKETPLACE_ONBOARDING_ERRORS = [
  'invalid',
  'no-subscription',
  'unavailable',
] as const
export type AwsMarketplaceOnboardingError = (typeof AWS_MARKETPLACE_ONBOARDING_ERRORS)[number]
