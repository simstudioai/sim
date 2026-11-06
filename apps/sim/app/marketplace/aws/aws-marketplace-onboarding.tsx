'use client'

import { type ReactNode, useState } from 'react'
import {
  AuthField,
  AuthFormMessage,
  AuthInput,
  AuthSelect,
  AuthTag,
  AuthTextLink,
} from '@sim/auth-ui'
import { formatDate } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import type { AwsMarketplaceClaim } from '@/lib/api/contracts/aws-marketplace'
import { client, useSession } from '@/lib/auth/client'
import {
  AWS_MARKETPLACE_ONBOARDING_PATH,
  AWS_MARKETPLACE_SETUP_TURNAROUND,
  type AwsMarketplaceOnboardingError,
} from '@/lib/billing/aws-marketplace/onboarding'
import { organizationRoutes } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'
import { useBrandConfig } from '@/ee/whitelabeling'
import {
  useAwsMarketplaceClaim,
  useAwsMarketplaceLicenses,
  useLinkAwsMarketplaceLicense,
  useRegisterAwsMarketplaceLicenseToAccount,
  useSaveAwsMarketplaceClaimContact,
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
  'not-started': {
    title: 'Your agreement has not started',
    description:
      'Come back to AWS Marketplace on your agreement start date and choose Set up your account.',
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

/** AWS's manual-setup guidance: being set up, wait to be contacted, turnaround, contact. */
const BEING_SET_UP = `Your account is being set up. Please wait for us to contact you. We expect to finish ${AWS_MARKETPLACE_SETUP_TURNAROUND}.`

const LICENSE_STATUS_LABELS = {
  active: 'Active',
  pending: 'Confirming with AWS',
  inactive: 'Inactive',
} as const

function authLink(path: '/login' | '/signup'): string {
  return buildAuthCrossLink(path, {
    callbackUrl: AWS_MARKETPLACE_ONBOARDING_PATH,
    isInviteFlow: true,
  })
}

interface SupportContactProps {
  supportEmail: string | undefined
}

/** AWS requires support contact options on the fulfillment landing page. */
function SupportContact({ supportEmail }: SupportContactProps) {
  if (!supportEmail) return null
  return (
    <p className='au:text-center au:text-sm'>
      Questions? Email <AuthTextLink href={`mailto:${supportEmail}`}>{supportEmail}</AuthTextLink>
    </p>
  )
}

/** Status for a buyer with no organization, who may not be able to open any billing page. */
function AccountSubscriptionStatus() {
  const { data: licenses } = useAwsMarketplaceLicenses(null)
  if (!licenses?.length) return null
  return (
    <ul className='au:w-full au:space-y-1 au:text-center au:text-sm'>
      {licenses.map((license) => (
        <li key={license.id}>
          {LICENSE_STATUS_LABELS[license.status]}
          {license.expiresAt && `, expires ${formatDate(new Date(license.expiresAt))}`}
        </li>
      ))}
    </ul>
  )
}

interface NoSetupInProgressProps {
  supportContact: ReactNode
  actions: Array<{ label: string; onClick: () => void }>
}

/** A finished buyer who returns sees their account's status; anyone else, how to start. */
function NoSetupInProgress({ supportContact, actions }: NoSetupInProgressProps) {
  const { data: licenses, isPending } = useAwsMarketplaceLicenses(null)
  if (isPending) {
    return (
      <InviteLayout>
        <InviteStatusCard type='loading' title='' description='Loading your subscription...' />
      </InviteLayout>
    )
  }
  if (licenses?.length) {
    const underway = licenses.some((license) => license.status !== 'inactive')
    return (
      <InviteLayout>
        <InviteStatusCard
          type={underway ? 'success' : 'warning'}
          title='Your AWS Marketplace subscription'
          description={underway ? BEING_SET_UP : 'This subscription is no longer active.'}
          details={
            <div className='au:w-full au:space-y-2'>
              <AccountSubscriptionStatus />
              {supportContact}
            </div>
          }
          actions={actions}
        />
      </InviteLayout>
    )
  }
  return (
    <InviteLayout>
      <InviteStatusCard
        type='warning'
        title='No setup in progress'
        description={`${RESTART_FROM_AWS} If you already finished setup, we will contact you ${AWS_MARKETPLACE_SETUP_TURNAROUND}.`}
        details={supportContact}
        actions={actions}
      />
    </InviteLayout>
  )
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
  const { supportEmail } = useBrandConfig()
  const supportContact = <SupportContact supportEmail={supportEmail} />
  const returnHome = { label: 'Return to Home', onClick: () => router.push('/') }

  /** A revoked session's cookie would send `/login` straight to the app, losing the way back. */
  const goToAuth = async (path: '/login' | '/signup') => {
    await client.signOut().catch(() => {})
    router.push(authLink(path))
  }

  if (registrationError) {
    const copy = REGISTRATION_ERROR_COPY[registrationError]
    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title={copy.title}
          description={copy.description}
          details={supportContact}
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
          description={
            registrationDisabled
              ? 'Sign in to set up this subscription.'
              : 'Sign in or create an account to set up this subscription.'
          }
          details={supportContact}
          actions={[
            ...(registrationDisabled
              ? []
              : [{ label: 'Create an account', onClick: () => goToAuth('/signup') }]),
            { label: 'I already have an account', onClick: () => goToAuth('/login') },
          ]}
        />
      </InviteLayout>
    )
  }

  if (linkLicense.isSuccess || registerToAccount.isSuccess) {
    const organizationId = linkLicense.variables?.organizationId
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title='Your account is being set up'
          description={BEING_SET_UP}
          details={
            <div className='au:w-full au:space-y-2 au:text-center au:text-sm'>
              {organizationId ? (
                <p>
                  <AuthTextLink
                    href={organizationRoutes(organizationId).settingsSection('billing')}
                  >
                    View subscription status
                  </AuthTextLink>
                </p>
              ) : (
                <AccountSubscriptionStatus />
              )}
              {supportContact}
            </div>
          }
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
          details={supportContact}
          actions={[{ label: 'Try again', onClick: () => claimQuery.refetch() }, returnHome]}
        />
      </InviteLayout>
    )
  }

  const claim = claimQuery.data
  if (claim.status === 'missing') {
    return <NoSetupInProgress supportContact={supportContact} actions={[returnHome]} />
  }

  if (claim.status === 'linked') {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='warning'
          title='This subscription is already linked'
          description='It is linked to an organization, and a subscription stays with one organization.'
          details={
            <div className='au:w-full au:space-y-2 au:text-center au:text-sm'>
              {claim.organizationId && (
                <p>
                  <AuthTextLink
                    href={organizationRoutes(claim.organizationId).settingsSection('billing')}
                  >
                    View subscription status
                  </AuthTextLink>
                </p>
              )}
              {supportContact}
            </div>
          }
          actions={[returnHome]}
        />
      </InviteLayout>
    )
  }

  return (
    <ClaimCard
      key={claim.status}
      claim={claim}
      signedInAs={session.user.email}
      supportContact={supportContact}
      linking={linkLicense.isPending}
      registering={registerToAccount.isPending}
      error={(linkLicense.error ?? registerToAccount.error)?.message ?? null}
      onLink={(organizationId, contact) => {
        registerToAccount.reset()
        linkLicense.mutate({ licenseId: claim.license.id, organizationId, ...contact })
      }}
      onRegister={(contact) => {
        linkLicense.reset()
        registerToAccount.mutate({ licenseId: claim.license.id, ...contact })
      }}
      onCancel={returnHome.onClick}
    />
  )
}

interface BuyerContact {
  contactEmail: string
  companyName?: string
}

interface ClaimCardProps {
  claim: Extract<AwsMarketplaceClaim, { status: 'ready' | 'pending' }>
  signedInAs: string
  supportContact: ReactNode
  linking: boolean
  registering: boolean
  error: string | null
  onLink: (organizationId: string, contact: BuyerContact) => void
  onRegister: (contact: BuyerContact) => void
  onCancel: () => void
}

/**
 * Shows the buyer whose subscription this is and who is signed in, so a claim planted in someone
 * else's browser is noticed. A confirmed license links to an organization the viewer administers,
 * or registers to their account. While AWS is still confirming it, the buyer leaves contact
 * details and asks again.
 */
function ClaimCard({
  claim,
  signedInAs,
  supportContact,
  linking,
  registering,
  error,
  onLink,
  onRegister,
  onCancel,
}: ClaimCardProps) {
  const { license } = claim
  const organizations = claim.status === 'ready' ? claim.organizations : []
  const saveContact = useSaveAwsMarketplaceClaimContact()
  const [organizationId, setOrganizationId] = useState<string>()
  const [contactEmail, setContactEmail] = useState(license.contactEmail ?? signedInAs)
  const [companyName, setCompanyName] = useState(license.companyName ?? '')
  const contact: BuyerContact = {
    contactEmail: contactEmail.trim(),
    ...(companyName.trim() && { companyName: companyName.trim() }),
  }
  const hasContact = contact.contactEmail.length > 0
  const pending = linking || registering || saveContact.isPending

  const rows = [
    { label: 'AWS account', value: license.awsAccount },
    { label: 'Signed in as', value: signedInAs },
    { label: 'Plan', value: license.dimension ?? 'Not specified' },
    { label: 'Quantity', value: license.quantity?.toLocaleString() ?? 'Not specified' },
    {
      label: 'Expires',
      value: license.expiresAt ? formatDate(new Date(license.expiresAt)) : 'No expiry',
    },
  ]

  const hasOrganizations = organizations.length > 0
  const actions =
    claim.status === 'pending'
      ? [
          {
            label: 'Save and check again',
            onClick: () => saveContact.mutate({ licenseId: license.id, ...contact }),
            disabled: pending || !hasContact,
            loading: saveContact.isPending,
          },
        ]
      : [
          ...(hasOrganizations
            ? [
                {
                  label: 'Link subscription',
                  onClick: () => organizationId && onLink(organizationId, contact),
                  disabled: !organizationId || !hasContact || pending,
                  loading: linking,
                },
              ]
            : []),
          {
            label: hasOrganizations ? 'Register to my account instead' : 'Register to my account',
            onClick: () => onRegister(contact),
            disabled: pending || !hasContact,
            loading: registering,
          },
        ]

  const description =
    claim.status === 'pending'
      ? 'AWS is still confirming your subscription. Leave your contact details and check again in a few minutes.'
      : hasOrganizations
        ? `Choose the organization this subscription is for, or register it to your account. We expect to finish setting it up ${AWS_MARKETPLACE_SETUP_TURNAROUND}.`
        : `Register this subscription to your account. We expect to finish setting it up ${AWS_MARKETPLACE_SETUP_TURNAROUND}.`

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title={
          hasOrganizations
            ? 'Link your AWS Marketplace subscription'
            : 'Set up your AWS Marketplace subscription'
        }
        description={description}
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
                  <AuthTag>{claim.status === 'pending' ? 'Confirming with AWS' : 'Active'}</AuthTag>
                </dd>
              </div>
            </dl>
            {hasOrganizations && (
              <AuthField htmlFor='aws-marketplace-organization' label='Organization'>
                <AuthSelect
                  id='aws-marketplace-organization'
                  options={organizations.map((org) => ({ label: org.name, value: org.id }))}
                  value={organizationId}
                  onChange={setOrganizationId}
                  placeholder='Select an organization'
                  fullWidth
                />
              </AuthField>
            )}
            <AuthField htmlFor='aws-marketplace-contact-email' label='Contact email'>
              <AuthInput
                id='aws-marketplace-contact-email'
                type='email'
                autoComplete='email'
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                required
              />
            </AuthField>
            <AuthField htmlFor='aws-marketplace-company' label='Company (optional)'>
              <AuthInput
                id='aws-marketplace-company'
                autoComplete='organization'
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </AuthField>
            {saveContact.isSuccess && claim.status === 'pending' && (
              <AuthFormMessage type='info'>
                We saved your details. AWS is still confirming your subscription.
              </AuthFormMessage>
            )}
            {(error ?? saveContact.error?.message) && (
              <AuthFormMessage type='error'>{error ?? saveContact.error?.message}</AuthFormMessage>
            )}
            {supportContact}
          </div>
        }
        actions={[...actions, { label: 'Not now', onClick: onCancel }]}
      />
    </InviteLayout>
  )
}
