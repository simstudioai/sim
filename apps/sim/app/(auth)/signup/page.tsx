import { isRegistrationDisabled } from '@/lib/core/config/feature-flags'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const t = await getTranslations()

  if (isRegistrationDisabled) {
    return <div>{t('sign_up.disabled_registration_warning')}</div>
  }

  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
    />
  )
}
