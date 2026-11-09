'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyField } from '@sim/emcn/field/value-fields'
import { PropertyList } from '@sim/emcn/property-list'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import type { SsoProviderView } from '@/lib/api/contracts/auth'
import { toast } from '@/lib/toast/sink'
import { ssoFormFromProvider, ssoProviderCallbackUrl } from '@/ee/sso/lib/provider-form'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { ProviderForm } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/provider-form'
import { useSsoOrigin } from '@/platform/embedded/lib/data/sso/params'

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
  const baseUrl = useSsoOrigin()
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

  const isSaml = provider.providerType === 'saml'
  const isOidc = provider.providerType === 'oidc'
  const encodedProviderId = encodeURIComponent(provider.providerId)
  const jit = provider.jitProvisioningEnabled ?? true

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Identity providers'
        onBack={onBack}
        title={provider.providerId ?? 'Identity provider'}
      />
      <SettingsSection title='Identity provider'>
        <FieldStack>
          <PropertyList
            titleHidden
            title='Configuration'
            properties={[
              {
                id: 'provider-id',
                label: 'Provider ID',
                kind: 'text',
                value: provider.providerId,
              },
              {
                id: 'type',
                label: 'Provider type',
                kind: 'text',
                value: provider.providerType.toUpperCase(),
              },
              { id: 'domain', label: 'Domain', kind: 'text', value: provider.domain },
              { id: 'issuer', label: 'Issuer URL', kind: 'text', value: provider.issuer },
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
      <SettingsSection title='Manage provider'>
        <SettingsRow label='Configuration'>
          <Button size='compact' onClick={edit}>
            Edit
          </Button>
        </SettingsRow>
        {onMakePrimary && (
          <SettingsRow label='Primary provider'>
            <Button size='compact' onClick={onMakePrimary}>
              Make primary
            </Button>
          </SettingsRow>
        )}
        <SettingsRow label='Delete identity provider'>
          <Button size='compact' variant='destructive' onClick={onDelete}>
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SectionStack>
  )
}
