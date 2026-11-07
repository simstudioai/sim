'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { Disclosure } from '@sim/emcn/disclosure'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import type { SsoProviderView } from '@/lib/api/contracts/auth'
import { SSO_TRUSTED_PROVIDERS } from '@/ee/sso/constants'
import {
  DEFAULT_SSO_FORM,
  hasSsoFormErrors,
  OIDC_DEFAULT_MAPPING,
  readProviderConfigString,
  SAML_DEFAULT_MAPPING,
  SAML_NAMEID_FORMATS,
  type SsoProviderForm,
  ssoFormCallbackUrl,
  validateSsoProviderForm,
} from '@/ee/sso/lib/provider-form'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { ClientSecretField } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/client-secret-field'
import { useSsoOrigin } from '@/platform/embedded/lib/data/sso/params'
import { useSsoProviderSave } from '@/platform/embedded/lib/data/sso-settings'

const PROVIDER_TYPE_OPTIONS: { value: SsoProviderForm['providerType']; label: string }[] = [
  { label: 'OIDC', value: 'oidc' },
  { label: 'SAML', value: 'saml' },
]

interface ProviderFormProps {
  organizationId: string
  /** With `initialForm`, edits this saved provider. Without, creates one. */
  existingProvider?: SsoProviderView
  initialForm?: SsoProviderForm
  onOpenDomains?: () => void
  onSaved: (providerId: string) => void
  onBack?: () => void
}

export function ProviderForm({
  organizationId,
  existingProvider,
  initialForm,
  onOpenDomains,
  onSaved,
  onBack,
}: ProviderFormProps) {
  const provider = useSsoProviderSave(organizationId)
  const isEditing = Boolean(existingProvider)
  const original = initialForm ?? DEFAULT_SSO_FORM
  const baseUrl = useSsoOrigin()
  const [form, setForm] = useState<SsoProviderForm>(original)
  const [showErrors, setShowErrors] = useState(false)
  const [isReplacing, setIsReplacing] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showMapping, setShowMapping] = useState(
    Boolean(original.mapId || original.mapEmail || original.mapName)
  )
  const [providerIdQuery, setProviderIdQuery] = useState('')

  /**
   * Editing an OIDC provider always means a secret is stored: the contract requires one to register,
   * and the API returns only its sentinel. Leaving the field blank means "keep it", not "clear it".
   */
  const hasStoredSecret = existingProvider?.providerType === 'oidc'
  const storedHint = hasStoredSecret
    ? readProviderConfigString(existingProvider?.oidcConfig, 'clientSecretHint')
    : null
  const secretMode = {
    hasStoredClientSecret: hasStoredSecret,
    isReplacingClientSecret: isReplacing,
  }
  const errors = validateSsoProviderForm(form, secretMode)
  const errorFor = (field: keyof typeof errors) =>
    showErrors && errors[field].length > 0 ? errors[field].join(' ') : undefined
  const dirty = (Object.keys(form) as (keyof SsoProviderForm)[]).some(
    (key) => form[key] !== original[key]
  )

  function discard() {
    setForm(original)
    setShowErrors(false)
    setIsReplacing(false)
    if (isEditing) onBack?.()
  }
  const guard = useSettingsUnsavedGuard({
    isDirty: dirty,
    navigationBlocked: provider.saving,
    onDiscard: discard,
  })

  function set<Key extends keyof SsoProviderForm>(key: Key, value: SsoProviderForm[Key]) {
    if (provider.saving) return
    setForm((current) => ({ ...current, [key]: value }))
  }

  function changeType(providerType: SsoProviderForm['providerType']) {
    // Claim names are protocol-specific, so an override must not survive a switch.
    setForm((current) => ({ ...current, providerType, mapId: '', mapEmail: '', mapName: '' }))
    setShowErrors(false)
  }

  async function submit() {
    if (provider.saving) return
    setShowErrors(true)
    if (hasSsoFormErrors(errors)) {
      if (errors.scopes.length > 0) setShowAdvanced(true)
      return
    }
    await provider.save(form, { hasStoredSecret, isEditing }, () => onSaved(form.providerId))
  }

  const isSaml = form.providerType === 'saml'
  const mappingDefaults = isSaml ? SAML_DEFAULT_MAPPING : OIDC_DEFAULT_MAPPING
  const query = providerIdQuery.trim()
  const providerIdOptions = [
    ...(query && !SSO_TRUSTED_PROVIDERS.includes(query) ? [query] : []),
    ...SSO_TRUSTED_PROVIDERS.filter((id) => id.includes(query.toLowerCase())),
  ]

  return (
    <SectionStack>
      {onBack ? (
        <DetailHeader
          backLabel='Identity providers'
          onBack={() => guard.guardBack(onBack)}
          title={existingProvider?.providerId ?? 'New identity provider'}
        />
      ) : null}
      <form
        noValidate
        autoComplete='off'
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <FormFieldset disabled={provider.saving}>
          {!existingProvider && (
            <ActionRow>
              <Muted>Use a verified email domain for this connection.</Muted>
              {onOpenDomains && (
                <Button size='compact' onClick={onOpenDomains}>
                  Manage domains
                </Button>
              )}
            </ActionRow>
          )}
          <SettingsSection title='Identity provider'>
            <FieldStack>
              <SelectField
                label='Provider type'
                hint='Choose the protocol configured in your identity provider.'
                options={PROVIDER_TYPE_OPTIONS}
                value={form.providerType}
                onValueChange={changeType}
              />
              {isEditing ? (
                <CopyField
                  label='Provider ID'
                  value={form.providerId}
                  hint='Cannot be changed after saving.'
                />
              ) : (
                <SearchableSelect
                  label='Provider ID'
                  searchLabel='Select or enter a provider ID'
                  placeholder='Select or enter a provider ID'
                  hint='Unique across Sim, e.g. acme-entra. Cannot be changed later.'
                  error={errorFor('providerId')}
                  options={providerIdOptions}
                  value={form.providerId || null}
                  selectedLabel={form.providerId || undefined}
                  onValueChange={(value) => set('providerId', value ?? '')}
                  search={{
                    query: providerIdQuery,
                    onQueryChange: (query, { reason }) => {
                      setProviderIdQuery(query)
                      // Closing the popup clears its query as `input-clear`; that is not an edit.
                      if (reason === 'input-change') set('providerId', query.trim())
                    },
                  }}
                />
              )}
              <TextField
                label='Issuer URL'
                type='url'
                name='sso_issuer_endpoint'
                autoComplete='off'
                placeholder='https://your-identity-provider.com'
                error={errorFor('issuerUrl')}
                value={form.issuerUrl}
                onChange={(value) => set('issuerUrl', value)}
              />
              <TextField
                label='Domain'
                name='sso_identity_domain'
                autoComplete='off'
                placeholder='company.com'
                hint='The verified email domain your members use to sign in.'
                error={errorFor('domain')}
                value={form.domain}
                onChange={(value) => set('domain', value)}
              />
              {isSaml ? (
                <>
                  <TextField
                    label='Entry point URL'
                    type='url'
                    autoComplete='off'
                    placeholder='https://idp.example.com/sso/saml'
                    error={errorFor('entryPoint')}
                    value={form.entryPoint}
                    onChange={(value) => set('entryPoint', value)}
                  />
                  <TextAreaField
                    label='Identity provider certificate'
                    placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                    error={errorFor('cert')}
                    value={form.cert}
                    onChange={(value) => set('cert', value)}
                  />
                </>
              ) : (
                <>
                  <TextField
                    label='Client ID'
                    name='sso_client_identifier'
                    autoComplete='off'
                    placeholder='Enter Client ID'
                    error={errorFor('clientId')}
                    value={form.clientId}
                    onChange={(value) => set('clientId', value)}
                  />
                  <ClientSecretField
                    hasStoredSecret={hasStoredSecret}
                    storedHint={storedHint}
                    isReplacing={isReplacing}
                    onReplace={() => setIsReplacing(true)}
                    onKeepSaved={() => {
                      setIsReplacing(false)
                      set('clientSecret', '')
                    }}
                    value={form.clientSecret}
                    onChange={(value) => set('clientSecret', value)}
                    error={errorFor('clientSecret')}
                  />
                </>
              )}
              <Disclosure
                chevron
                label='Advanced options'
                open={showAdvanced}
                onOpenChange={setShowAdvanced}
              >
                <FieldStack>
                  {isSaml ? (
                    <>
                      <TextField
                        label='Audience (Entity ID)'
                        optional
                        autoComplete='off'
                        placeholder='Enter Audience'
                        value={form.audience}
                        onChange={(value) => set('audience', value)}
                      />
                      <TextField
                        label='Callback URL override'
                        optional
                        type='url'
                        autoComplete='off'
                        placeholder={`${baseUrl}/api/auth/sso/saml2/callback/provider-id`}
                        value={form.callbackUrl}
                        onChange={(value) => set('callbackUrl', value)}
                      />
                      <Checkbox
                        label='Require signed SAML assertions'
                        checked={form.wantAssertionsSigned}
                        onCheckedChange={(checked) => set('wantAssertionsSigned', checked)}
                      />
                      <SelectField
                        label='NameID format'
                        optional
                        options={SAML_NAMEID_FORMATS}
                        value={form.identifierFormat}
                        onValueChange={(value) => set('identifierFormat', value)}
                      />
                      <TextAreaField
                        label='IdP metadata XML'
                        optional
                        placeholder='Paste IDP metadata XML here'
                        value={form.idpMetadata}
                        onChange={(value) => set('idpMetadata', value)}
                      />
                    </>
                  ) : (
                    <>
                      <TextField
                        label='Scopes'
                        autoComplete='off'
                        placeholder='openid,profile,email'
                        hint='Comma-separated list of OIDC scopes to request'
                        error={errorFor('scopes')}
                        value={form.scopes}
                        onChange={(value) => set('scopes', value)}
                      />
                      <TextField
                        label='Authorization endpoint'
                        optional
                        type='url'
                        autoComplete='off'
                        placeholder='Discovered from the issuer'
                        value={form.authorizationEndpoint}
                        onChange={(value) => set('authorizationEndpoint', value)}
                      />
                      <TextField
                        label='Token endpoint'
                        optional
                        type='url'
                        autoComplete='off'
                        placeholder='Discovered from the issuer'
                        value={form.tokenEndpoint}
                        onChange={(value) => set('tokenEndpoint', value)}
                      />
                      <TextField
                        label='JWKS endpoint'
                        optional
                        type='url'
                        autoComplete='off'
                        placeholder='Discovered from the issuer'
                        hint="Sim reads these from the issuer's discovery document. Set them only if your provider does not publish one."
                        value={form.jwksEndpoint}
                        onChange={(value) => set('jwksEndpoint', value)}
                      />
                    </>
                  )}
                </FieldStack>
              </Disclosure>
              <CopyField
                label={isSaml ? 'ACS URL (Reply URL)' : 'Callback URL'}
                value={ssoFormCallbackUrl(form, existingProvider, baseUrl)}
                hint='Configure this in your identity provider'
              />
              {isSaml && (
                <CopyField
                  label='SP Entity ID'
                  value={baseUrl}
                  hint="Use this as Sim's entity ID in your identity provider."
                />
              )}
              <Disclosure
                chevron
                label='Attribute mapping'
                open={showMapping}
                onOpenChange={setShowMapping}
              >
                <FieldStack>
                  <TextField
                    label='Email attribute'
                    optional
                    autoComplete='off'
                    placeholder={mappingDefaults.email}
                    value={form.mapEmail}
                    onChange={(value) => set('mapEmail', value)}
                  />
                  <TextField
                    label='Name attribute'
                    optional
                    autoComplete='off'
                    placeholder={mappingDefaults.name}
                    value={form.mapName}
                    onChange={(value) => set('mapName', value)}
                  />
                  <TextField
                    label='User ID attribute'
                    optional
                    autoComplete='off'
                    placeholder={mappingDefaults.id}
                    hint='Must be stable and unique per user — changing it later re-links accounts.'
                    value={form.mapId}
                    onChange={(value) => set('mapId', value)}
                  />
                </FieldStack>
              </Disclosure>
            </FieldStack>
          </SettingsSection>
          <SettingsSection title='First sign-in'>
            <FieldStack>
              <SegmentedControl
                label='SSO member provisioning mode'
                options={[
                  { value: 'automatic', label: 'Automatic' },
                  { value: 'invite-only', label: 'Invite only' },
                ]}
                value={form.jitProvisioningEnabled ? 'automatic' : 'invite-only'}
                onSelect={(value) => set('jitProvisioningEnabled', value === 'automatic')}
              />
              <Muted>
                {form.jitProvisioningEnabled
                  ? 'New users join as Members and use a seat. Grant workspace access separately.'
                  : 'Invite or provision new members before they sign in. Existing members keep their access.'}{' '}
                An active SCIM connection can disable automatic membership in Provisioning rules.
              </Muted>
            </FieldStack>
          </SettingsSection>
          {/* Enabled by an edit, never by validity: errors show only once a save is attempted. */}
          <SaveActions dirty={dirty} saving={provider.saving} onDiscard={discard} />
        </FormFieldset>
      </form>
    </SectionStack>
  )
}
