'use client'

import { Button } from '@sim/emcn/button'
import { CopyField } from '@sim/emcn/field/value-fields'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { ProviderForm } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/provider-form'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { getBaseUrl, type SsoProviderView, ssoFormFromProvider } from '@/platform/lib/data/sso'

interface ProviderDetailProps {
  organizationId: string
  provider: SsoProviderView
  onBack: () => void
  /** Reads the provider again, when its stored configuration could not be parsed. */
  onRetry: () => void
  onDelete: () => void
  /** Offered for a verified provider waiting beside its domain's primary; also shows the test link. */
  onMakePrimary?: () => void
}

/** Parsed per render, so a save that lands shows the configuration the server stored. */
function savedForm(provider: SsoProviderView) {
  try {
    return ssoFormFromProvider(provider)
  } catch {
    return null
  }
}

/**
 * One identity provider, edited in place: its configuration commits through the form's Save, and
 * making it primary or deleting it each confirm first.
 */
export function ProviderDetail({
  organizationId,
  provider,
  onBack,
  onRetry,
  onDelete,
  onMakePrimary,
}: ProviderDetailProps) {
  const baseUrl = getBaseUrl()
  const form = savedForm(provider)
  const providerId = provider.providerId ?? ''
  const encodedProviderId = encodeURIComponent(providerId)
  const isOidc = (provider.providerType ?? 'oidc') === 'oidc'

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Identity providers'
        onBack={() => requestSettingsLeave(onBack)}
        title={providerId || 'Identity provider'}
        description={`${(provider.providerType ?? 'oidc').toUpperCase()} · ${provider.domain ?? 'No domain'}`}
      />
      {form ? (
        <ProviderForm
          organizationId={organizationId}
          existingProvider={provider}
          initialForm={form}
        />
      ) : (
        <FailureNotice message='Failed to load provider configuration' onRetry={onRetry} />
      )}
      {(isOidc || onMakePrimary) && (
        <SettingsSection title='Sign-in links'>
          <FieldStack>
            {isOidc && (
              <CopyField
                label='Initiate login URL'
                value={`${baseUrl}/sso/launch/${encodedProviderId}`}
              />
            )}
            {onMakePrimary && (
              <CopyField
                label='Test sign-in link'
                value={`${baseUrl}/sso?provider=${encodedProviderId}`}
              />
            )}
          </FieldStack>
        </SettingsSection>
      )}
      <SettingsSection title='Manage provider'>
        {onMakePrimary && (
          <SettingsRow
            label='Primary provider'
            description='Sign people at this domain in through this provider first'
          >
            <Button size='compact' onClick={onMakePrimary}>
              Make primary
            </Button>
          </SettingsRow>
        )}
        <SettingsRow
          label='Delete identity provider'
          description='Members can no longer sign in through this provider'
        >
          <Button size='compact' variant='quiet' destructive onClick={onDelete}>
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SectionStack>
  )
}
