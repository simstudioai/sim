'use client'

import { useState } from 'react'
import { AuthField, AuthFormMessage, AuthSelect, AuthTag } from '@sim/auth-ui'
import { useRouter } from 'next/navigation'
import type { AwsMarketplaceClaim } from '@/lib/api/contracts/aws-marketplace'
import { useSession } from '@/lib/auth/client'
import {
  AWS_MARKETPLACE_ONBOARDING_PATH,
  type AwsMarketplaceOnboardingError,
} from '@/lib/billing/aws-marketplace/onboarding'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'
import {
  useAwsMarketplaceClaim,
  useLinkAwsMarketplaceLicense,
  useRegisterAwsMarketplaceLicenseToAccount,
} from '@/hooks/queries/aws-marketplace'

const RESTART_FROM_AWS =
  'Open your Sim subscription in AWS Marketplace and choose Set up your account.'

const REGISTRATION_ERROR_COPY: Record<
  AwsMarketplaceOnboardingError,
  { title: string; description: string }
> = {
  'no-subscription': {
    title: 'No active subscription found',
    description:
      'AWS Marketplace has no active Sim subscription for this AWS account. Subscribe to Sim in AWS Marketplace, then choose Set up your account to return here.',
  },
  invalid: {
    title: 'This setup link did not work',
    description: RESTART_FROM_AWS,
  },
  unavailable: {
    title: 'AWS Marketplace is not responding',
    description: `We could not confirm your subscription with AWS. Try again in a few minutes: ${RESTART_FROM_AWS}`,
  },
}

function authLink(path: '/login' | '/signup'): string {
  return buildAuthCrossLink(path, {
    callbackUrl: AWS_MARKETPLACE_ONBOARDING_PATH,
    isInviteFlow: true,
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

interface AwsMarketplaceOnboardingProps {
  registrationError: AwsMarketplaceOnboardingError | null
  registrationDisabled: boolean
}

export function AwsMarketplaceOnboarding({
  registrationError,
  registrationDisabled,
}: AwsMarketplaceOnboardingProps) {
  const router = useRouter()
  const { data: session, isPending: sessionPending } = useSession()
  const viewerId = session?.user?.id ?? null
  const claimQuery = useAwsMarketplaceClaim(registrationError ? null : viewerId)
  const linkLicense = useLinkAwsMarketplaceLicense()
  const registerToAccount = useRegisterAwsMarketplaceLicenseToAccount()
  const returnHome = { label: 'Return to Home', onClick: () => router.push('/') }

  if (registrationError) {
    const copy = REGISTRATION_ERROR_COPY[registrationError]
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title={copy.title}
          description={copy.description}
          actions={[returnHome]}
        />
      </InviteLayout>
    )
  }

  if (sessionPending) {
    return (
      <InviteLayout>
        <InviteStatusCard type='loading' title='' description='Loading your subscription...' />
      </InviteLayout>
    )
  }

  if (!session?.user) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='login'
          title='Set up your AWS Marketplace subscription'
          description='Sign in to Sim to link this subscription to your organization.'
          actions={[
            ...(registrationDisabled
              ? []
              : [{ label: 'Create an account', onClick: () => router.push(authLink('/signup')) }]),
            {
              label: 'I already have an account',
              onClick: () => router.push(authLink('/login')),
            },
          ]}
        />
      </InviteLayout>
    )
  }

  if (linkLicense.isSuccess) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title='Subscription linked'
          description='Your AWS Marketplace subscription is linked to your organization. Our team will finish setting up your plan and contact you.'
          actions={[{ label: 'Go to Sim', onClick: () => router.push(APP_ENTRY_PATH) }]}
        />
      </InviteLayout>
    )
  }

  if (registerToAccount.isSuccess) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title='Subscription registered'
          description='Our team will set up your Enterprise workspace and email you when it is ready.'
          actions={[{ label: 'Go to Sim', onClick: () => router.push(APP_ENTRY_PATH) }]}
        />
      </InviteLayout>
    )
  }

  if (claimQuery.isPending) {
    return (
      <InviteLayout>
        <InviteStatusCard type='loading' title='' description='Loading your subscription...' />
      </InviteLayout>
    )
  }

  if (claimQuery.isError) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title='Could not load your subscription'
          description={claimQuery.error.message}
          actions={[{ label: 'Try again', onClick: () => claimQuery.refetch() }, returnHome]}
        />
      </InviteLayout>
    )
  }

  const claim = claimQuery.data
  if (claim.status !== 'ready') {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title={claim.status === 'expired' ? 'Setup link expired' : 'No subscription to set up'}
          description={RESTART_FROM_AWS}
          actions={[returnHome]}
        />
      </InviteLayout>
    )
  }

  const pending = linkLicense.isPending || registerToAccount.isPending
  return (
    <LinkLicenseCard
      claim={claim}
      pending={pending}
      linking={linkLicense.isPending}
      registering={registerToAccount.isPending}
      error={(linkLicense.error ?? registerToAccount.error)?.message ?? null}
      onLink={(organizationId) => {
        registerToAccount.reset()
        linkLicense.mutate({ licenseId: claim.license.id, organizationId })
      }}
      onRegister={() => {
        linkLicense.reset()
        registerToAccount.mutate({ licenseId: claim.license.id })
      }}
      onCancel={returnHome.onClick}
    />
  )
}

interface LinkLicenseCardProps {
  claim: Extract<AwsMarketplaceClaim, { status: 'ready' }>
  pending: boolean
  linking: boolean
  registering: boolean
  error: string | null
  onLink: (organizationId: string) => void
  onRegister: () => void
  onCancel: () => void
}

/**
 * Links the license to an organization the viewer administers, or registers it to their
 * account when they administer none or would rather not pick one.
 */
function LinkLicenseCard({
  claim,
  pending,
  linking,
  registering,
  error,
  onLink,
  onRegister,
  onCancel,
}: LinkLicenseCardProps) {
  const { license, organizations } = claim
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>()
  const linkedOrganization = organizations.find((org) => org.id === license.organizationId)
  const organizationId =
    selectedOrganizationId ??
    linkedOrganization?.id ??
    (organizations.length === 1 ? organizations[0]?.id : undefined)

  const rows = [
    { label: 'Plan', value: license.dimension ?? 'Not specified' },
    { label: 'Quantity', value: license.quantity?.toLocaleString() ?? 'Not specified' },
    {
      label: 'Expires',
      value: license.expiresAt ? formatDate(license.expiresAt) : 'No expiry',
    },
  ]

  const hasOrganizations = organizations.length > 0
  const registerAction = {
    label: hasOrganizations ? 'Register to my account instead' : 'Register to my account',
    onClick: onRegister,
    disabled: pending,
    loading: registering,
  }

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title={
          hasOrganizations
            ? 'Link your AWS Marketplace subscription'
            : 'Set up your AWS Marketplace subscription'
        }
        description={
          hasOrganizations
            ? 'Choose the organization this subscription is for, or register it to your account. Our team will finish setting up your plan.'
            : 'Register this subscription to your account. Our team will set up your Enterprise workspace and email you.'
        }
        details={
          <div className='au:w-full au:space-y-4'>
            <dl className='au:w-full au:space-y-2 au:text-sm au:tabular-nums'>
              {rows.map((row) => (
                <div key={row.label} className='au:flex au:justify-between au:gap-4'>
                  <dt className='au:text-[var(--auth-secondary)]'>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              <div className='au:flex au:justify-between au:gap-4'>
                <dt className='au:text-[var(--auth-secondary)]'>Status</dt>
                <dd>
                  <AuthTag>{license.status === 'active' ? 'Active' : 'Inactive'}</AuthTag>
                </dd>
              </div>
            </dl>
            {hasOrganizations && (
              <AuthField htmlFor='aws-marketplace-organization' label='Organization'>
                <AuthSelect
                  id='aws-marketplace-organization'
                  options={organizations.map((org) => ({ label: org.name, value: org.id }))}
                  value={organizationId}
                  onChange={setSelectedOrganizationId}
                  placeholder='Select an organization'
                  fullWidth
                />
              </AuthField>
            )}
            {error && <AuthFormMessage type='error'>{error}</AuthFormMessage>}
          </div>
        }
        actions={[
          ...(hasOrganizations
            ? [
                {
                  label: 'Link subscription',
                  onClick: () => organizationId && onLink(organizationId),
                  disabled: !organizationId || pending,
                  loading: linking,
                },
              ]
            : []),
          registerAction,
          { label: 'Not now', onClick: onCancel },
        ]}
      />
    </InviteLayout>
  )
}
