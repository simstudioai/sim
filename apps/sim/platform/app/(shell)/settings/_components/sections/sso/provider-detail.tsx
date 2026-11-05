'use client'

import { useState } from 'react'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { ProviderForm } from '@/platform/app/(shell)/settings/_components/sections/sso/provider-form'
import { Button, CopyField, PropertyList } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  getBaseUrl,
  type SsoProviderView,
  ssoFormFromProvider,
  ssoProviderCallbackUrl,
} from '@/platform/lib/data/sso'
import { toast } from '@/platform/lib/data/toast'

interface ProviderDetailProps {
  organizationId: string
  provider: SsoProviderView
  onBack: () => void
  onDelete: () => void
  /** Offered for a verified provider waiting beside its domain's primary; also shows the test link. */
  onMakePrimary?: () => void
}

type EditForm = ReturnType<typeof ssoFormFromProvider>

export function ProviderDetail({
  organizationId,
  provider,
  onBack,
  onDelete,
  onMakePrimary,
}: ProviderDetailProps) {
  const [editing, setEditing] = useState<EditForm | null>(null)

  if (editing) {
    return (
      <ProviderForm
        organizationId={organizationId}
        existingProvider={provider}
        initialForm={editing}
        onBack={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    )
  }

  function edit() {
    try {
      setEditing(ssoFormFromProvider(provider))
    } catch {
      toast.error('Failed to load provider configuration')
    }
  }

  const baseUrl = getBaseUrl()
  const isSaml = provider.providerType === 'saml'
  const isOidc = (provider.providerType ?? 'oidc') === 'oidc'
  const encodedProviderId = encodeURIComponent(provider.providerId ?? '')
  const jit = provider.jitProvisioningEnabled ?? true

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Identity providers'
        onBack={onBack}
        title={provider.providerId ?? 'Identity provider'}
      >
        <Button variant='primary' onClick={edit}>
          Edit
        </Button>
        {onMakePrimary && <Button onClick={onMakePrimary}>Make primary</Button>}
        <Button variant='destructive' onClick={onDelete}>
          Delete
        </Button>
      </DetailHeader>
      <SettingsSection title='Identity provider'>
        <FieldStack>
          <PropertyList
            title='Configuration'
            properties={[
              {
                id: 'provider-id',
                label: 'Provider ID',
                kind: 'text',
                value: provider.providerId ?? '',
              },
              {
                id: 'type',
                label: 'Provider type',
                kind: 'text',
                value: (provider.providerType ?? 'oidc').toUpperCase(),
              },
              { id: 'domain', label: 'Domain', kind: 'text', value: provider.domain ?? '' },
              { id: 'issuer', label: 'Issuer URL', kind: 'text', value: provider.issuer ?? '' },
            ]}
          />
          <CopyField
            label={isSaml ? 'ACS URL (Reply URL)' : 'Callback URL'}
            value={ssoProviderCallbackUrl(provider, baseUrl)}
            hint='Configure this in your identity provider'
          />
          {isSaml && <CopyField label='SP Entity ID' value={baseUrl} />}
          {isOidc && (
            <CopyField
              label='Initiate login URL'
              value={`${baseUrl}/sso/launch/${encodedProviderId}`}
              hint='Configure this in your identity provider to open Sim from its app dashboard'
            />
          )}
          {onMakePrimary && (
            <CopyField
              label='Test sign-in link'
              value={`${baseUrl}/sso?provider=${encodedProviderId}`}
              hint={`People at ${provider.domain} still sign in through the primary provider. Share this link to try this one first.`}
            />
          )}
        </FieldStack>
      </SettingsSection>
      <SettingsSection title='First sign-in'>
        <SettingsRow
          label={`On first SSO sign-in: ${jit ? 'Automatic' : 'Invite only'}`}
          description={
            jit
              ? 'New users join as Members and use a seat. Grant workspace access separately. An active SCIM connection can disable automatic membership in Provisioning rules.'
              : 'Invite or provision new members before they sign in. Existing members keep their access. An active SCIM connection can disable automatic membership in Provisioning rules.'
          }
        />
      </SettingsSection>
    </SectionStack>
  )
}
