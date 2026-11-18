import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isAwsMarketplaceEnabled } from '@/lib/billing/aws-marketplace/config'
import { AWS_MARKETPLACE_ONBOARDING_ERRORS } from '@/lib/billing/aws-marketplace/onboarding'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { AwsMarketplaceOnboarding } from '@/app/marketplace/aws/aws-marketplace-onboarding'

export const metadata: Metadata = {
  title: 'AWS Marketplace',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface AwsMarketplacePageProps {
  searchParams: Promise<{ error?: string | string[] }>
}

/** Where AWS Marketplace buyers land after registration, to link their subscription. */
export default async function AwsMarketplacePage({ searchParams }: AwsMarketplacePageProps) {
  if (!isAwsMarketplaceEnabled()) notFound()
  const { error } = await searchParams
  const registrationError = AWS_MARKETPLACE_ONBOARDING_ERRORS.find((code) => code === error) ?? null
  return (
    <AwsMarketplaceOnboarding
      registrationError={registrationError}
      registrationDisabled={isRegistrationDisabled}
    />
  )
}
