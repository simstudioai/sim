'use client'

import { useState } from 'react'
import {
  Button,
  Chip,
  ChipCombobox,
  ChipCopyInput,
  ChipInput,
  ChipSelect,
  ChipSwitch,
  ChipTextarea,
  cn,
  Expandable,
  ExpandableContent,
  Switch,
  toast,
} from '@sim/emcn'
import { ChevronDown, Eye, EyeOff } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import type { SsoRegistrationBody } from '@/lib/api/contracts/auth'
import { useSession } from '@/lib/auth/auth-client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { SettingRow } from '@/ee/components/setting-row'
import { ScimSection } from '@/ee/scim/components/scim-section'
import { VerifiedDomainsSection } from '@/ee/sso/components/verified-domains-section'
import { SSO_TRUSTED_PROVIDERS } from '@/ee/sso/constants'
import { useConfigureSSO, useSSOProviders } from '@/ee/sso/hooks/sso'
import { useOrganizationBilling } from '@/hooks/queries/organization'

const logger = createLogger('SSO')

interface SSOProvider {
  id: string
  providerId: string
  domain: string
  issuer: string
  organizationId: string
  userId?: string
  oidcConfig?: string
  samlConfig?: string
  jitProvisioningEnabled?: boolean
  providerType: 'oidc' | 'saml'
}

/** Claim names each protocol uses out of the box; shown as input placeholders. */
const OIDC_DEFAULT_MAPPING = { id: 'sub', email: 'email', name: 'name', image: 'picture' } as const
const SAML_DEFAULT_MAPPING = {
  id: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
} as const

const SAML_NAMEID_FORMATS = [
  { label: 'Provider default', value: '' },
  {
    label: 'Email address',
    value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  },
  { label: 'Persistent', value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' },
  { label: 'Transient', value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' },
  { label: 'Unspecified', value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified' },
] as const

const PROVIDER_ID_SUGGESTIONS = SSO_TRUSTED_PROVIDERS.map((id) => ({ label: id, value: id }))

const CLIENT_SECRET_FIELD_ID = 'sso-client-secret'
/** Fixed width, so the mask never leaks how long the stored secret is. */
const CLIENT_SECRET_MASK = '••••••••••••'

interface ClientSecretFieldProps {
  /** A secret is already saved, so the field opens as a masked fact rather than an input. */
  hasStoredSecret: boolean
  /** Last four characters of the saved secret, when the API judged it safe to hint. */
  storedHint: string | null
  isReplacing: boolean
  onReplace: () => void
  onCancelReplace: () => void
  value: string
  onChange: (value: string) => void
  hasError: boolean
}

/**
 * A saved client secret is a fact, not an editable value — the browser never
 * receives it. Rendering it as a static masked row with an explicit Replace
 * action avoids the "will blank clear it?" ambiguity an empty input invites, and
 * keeps a stray keystroke from arming a replacement.
 */
function ClientSecretField({
  hasStoredSecret,
  storedHint,
  isReplacing,
  onReplace,
  onCancelReplace,
  value,
  onChange,
  hasError,
}: ClientSecretFieldProps) {
  const [isRevealed, setIsRevealed] = useState(false)

  if (hasStoredSecret && !isReplacing) {
    return (
      <div className='flex items-center gap-2'>
        <ChipInput
          id={CLIENT_SECRET_FIELD_ID}
          readOnly
          value={storedHint ? `${CLIENT_SECRET_MASK}${storedHint}` : CLIENT_SECRET_MASK}
          inputClassName='cursor-default font-mono'
          className='min-w-0 flex-1'
          aria-label={
            storedHint ? `Saved client secret ending ${storedHint}` : 'Saved client secret'
          }
        />
        <Chip onClick={onReplace}>Replace</Chip>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2'>
      <ChipInput
        id={CLIENT_SECRET_FIELD_ID}
        type='text'
        placeholder='Enter Client Secret'
        className='min-w-0 flex-1'
        value={value}
        name='sso_client_key'
        autoComplete='off'
        autoCapitalize='none'
        spellCheck={false}
        readOnly
        // Kept from the original field: opening read-only and dropping the
        // attribute on focus is what stops password managers autofilling here.
        onFocus={(e) => {
          e.target.removeAttribute('readOnly')
          setIsRevealed(true)
        }}
        onBlurCapture={() => setIsRevealed(false)}
        onChange={(e) => onChange(e.target.value)}
        inputClassName={!isRevealed ? '[-webkit-text-security:disc]' : undefined}
        error={hasError}
        endAdornment={
          // Only offer the reveal once there is something to reveal.
          value ? (
            <Button
              type='button'
              variant='ghost'
              onClick={() => setIsRevealed((s) => !s)}
              className='size-6 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              aria-label={isRevealed ? 'Hide client secret' : 'Show client secret'}
            >
              {isRevealed ? <EyeOff className='size-[14px]' /> : <Eye className='size-[14px]' />}
            </Button>
          ) : undefined
        }
      />
      {/* Not "Cancel" — the header already owns that label for discarding the
          whole edit, and these two do very different things. */}
      {hasStoredSecret && <Chip onClick={onCancelReplace}>Keep saved</Chip>}
    </div>
  )
}

/** Reads the display-only hint the API attaches beside the redacted client secret. */
function readClientSecretHint(oidcConfig?: string): string | null {
  if (!oidcConfig) return null
  try {
    const hint = JSON.parse(oidcConfig).clientSecretHint
    return typeof hint === 'string' ? hint : null
  } catch {
    return null
  }
}

const DEFAULT_FORM_DATA = {
  providerType: 'oidc' as 'oidc' | 'saml',
  providerId: '',
  issuerUrl: '',
  domain: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid,profile,email',
  entryPoint: '',
  cert: '',
  callbackUrl: '',
  audience: '',
  wantAssertionsSigned: true,
  idpMetadata: '',
  mapId: '',
  mapEmail: '',
  mapName: '',
  identifierFormat: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  jwksEndpoint: '',
  jitProvisioningEnabled: true,
}

const DEFAULT_ERRORS = {
  providerType: [],
  providerId: [],
  issuerUrl: [],
  domain: [],
  clientId: [],
  clientSecret: [],
  entryPoint: [],
  cert: [],
  scopes: [],
  callbackUrl: [],
  audience: [],
}

interface SSOProps {
  organizationId: string
}

export function SSO({ organizationId }: SSOProps) {
  return <OrganizationSsoSettings key={organizationId} organizationId={organizationId} />
}

function OrganizationSsoSettings({ organizationId }: SSOProps) {
  const { data: session } = useSession()
  const { billingEnabled } = useDeploymentShape()
  const {
    data: organizationBillingData,
    isLoading: isLoadingOrganizationBilling,
    isFetching: isFetchingOrganizationBilling,
    error: organizationBillingError,
    refetch: refetchOrganizationBilling,
  } = useOrganizationBilling(organizationId)

  const {
    data: providersData,
    isLoading: isLoadingProviders,
    isFetching: isFetchingProviders,
    error: providersError,
    refetch: refetchProviders,
  } = useSSOProviders({ organizationId })

  const providers = providersData?.providers || []
  const existingProvider = providers[0] as SSOProvider | undefined
  const existingJitProvisioningEnabled = existingProvider?.jitProvisioningEnabled ?? true

  const userId = session?.user?.id
  const hasEnterprisePlan = isEnterprise(organizationBillingData?.data?.subscriptionPlan)

  const isSSOProviderOwner =
    !billingEnabled && userId ? providers.some((p) => p.userId === userId) : null

  const configureSSOMutation = useConfigureSSO()

  const [isEditing, setIsEditing] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showMapping, setShowMapping] = useState(false)

  const [formData, setFormData] = useState(DEFAULT_FORM_DATA)
  const [originalFormData, setOriginalFormData] = useState(DEFAULT_FORM_DATA)
  const [errors, setErrors] = useState<Record<string, string[]>>(DEFAULT_ERRORS)
  const [showErrors, setShowErrors] = useState(false)

  const [isReplacingClientSecret, setIsReplacingClientSecret] = useState(false)

  /**
   * Editing an OIDC provider always means a secret is stored — the contract
   * requires one to register, and the API returns only its sentinel, never the
   * value. Leaving the field blank therefore means "keep it", not "clear it".
   */
  const hasStoredClientSecret = isEditing && existingProvider?.providerType === 'oidc'
  /** Last four characters of the saved secret, when the API judged it safe to hint. */
  const storedClientSecretHint = hasStoredClientSecret
    ? readClientSecretHint(existingProvider?.oidcConfig)
    : null

  const hasChanges = (Object.keys(formData) as (keyof typeof formData)[]).some(
    (k) => formData[k] !== originalFormData[k]
  )

  useSettingsUnsavedGuard({ isDirty: hasChanges })

  if (isLoadingProviders || (billingEnabled && isLoadingOrganizationBilling)) {
    return null
  }

  const providersLoadingError = providersData === undefined ? providersError : null
  const organizationBillingLoadingError =
    billingEnabled && organizationBillingData === undefined ? organizationBillingError : null
  const loadingError = providersLoadingError ?? organizationBillingLoadingError
  if (loadingError) {
    return (
      <SettingsQueryErrorState
        error={loadingError}
        fallback='Failed to load Single Sign-On settings'
        isRetrying={
          (Boolean(providersLoadingError) && isFetchingProviders) ||
          (Boolean(organizationBillingLoadingError) && isFetchingOrganizationBilling)
        }
        onRetry={() => {
          if (providersLoadingError) void refetchProviders()
          if (organizationBillingLoadingError) void refetchOrganizationBilling()
        }}
      />
    )
  }

  if (billingEnabled) {
    if (!hasEnterprisePlan) {
      return (
        <SettingsEmptyState>
          Single Sign-On is available on Enterprise plans only.
        </SettingsEmptyState>
      )
    }
  } else {
    if (!isLoadingProviders && isSSOProviderOwner === false && providers.length > 0) {
      return (
        <>
          <SettingsEmptyState>
            Only the user who configured SSO can manage these settings.
          </SettingsEmptyState>
          <ScimSection organizationId={organizationId} />
        </>
      )
    }
  }

  const validateProviderId = (value: string): string[] => {
    if (!value || !value.trim()) return ['Provider ID is required.']
    if (!/^[-a-z0-9]+$/i.test(value.trim())) return ['Use letters, numbers, and dashes only.']
    return []
  }

  const validateIssuerUrl = (value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) return ['Issuer URL is required.']
    try {
      const url = new URL(value.trim())
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      if (url.protocol !== 'https:' && !isLocalhost) {
        out.push('Issuer URL must use HTTPS.')
      }
    } catch {
      out.push('Enter a valid issuer URL like https://your-identity-provider.com/oauth2/default')
    }
    return out
  }

  const validateDomain = (value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) return ['Domain is required.']
    if (/^https?:\/\//i.test(value.trim())) out.push('Do not include protocol (https://).')
    if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim()))
      out.push('Enter a valid domain like company.com')
    return out
  }

  const validateRequired = (label: string, value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) out.push(`${label} is required.`)
    return out
  }

  /**
   * `isReplacingSecret` is a parameter rather than a closure read: callers that
   * validate in the same tick as toggling it would otherwise see the previous
   * value and leave a stale "required" error on a field that is no longer an input.
   */
  const validateAll = (data: typeof formData, isReplacingSecret = isReplacingClientSecret) => {
    const newErrors: Record<string, string[]> = {
      providerType: [],
      providerId: validateProviderId(data.providerId),
      issuerUrl: validateIssuerUrl(data.issuerUrl),
      domain: validateDomain(data.domain),
      clientId: [],
      clientSecret: [],
      entryPoint: [],
      cert: [],
      scopes: [],
      callbackUrl: [],
      audience: [],
    }

    const providerType = data.providerType || 'oidc'

    if (providerType === 'oidc') {
      newErrors.clientId = validateRequired('Client ID', data.clientId)
      // Skipped only while the stored secret is being kept. Once Replace is
      // clicked the field is a real input again, so a blank or whitespace-only
      // value has to fail rather than quietly overwrite a working secret.
      newErrors.clientSecret =
        hasStoredClientSecret && !isReplacingSecret
          ? []
          : validateRequired('Client Secret', data.clientSecret)
      if (!data.scopes || !data.scopes.trim()) {
        newErrors.scopes = ['Scopes are required for OIDC providers']
      }
    } else if (providerType === 'saml') {
      newErrors.entryPoint = validateIssuerUrl(data.entryPoint || '')
      if (!newErrors.entryPoint.length && !data.entryPoint) {
        newErrors.entryPoint = ['Entry Point URL is required for SAML providers']
      }
      newErrors.cert = validateRequired('Certificate', data.cert)
    }

    setErrors(newErrors)
    return newErrors
  }

  const hasAnyErrors = (errs: Record<string, string[]>) =>
    Object.values(errs).some((l) => l.length > 0)

  const handleDiscard = () => {
    setIsEditing(false)
    setFormData(DEFAULT_FORM_DATA)
    setOriginalFormData(DEFAULT_FORM_DATA)
    setErrors(DEFAULT_ERRORS)
    setShowErrors(false)
    setShowAdvanced(false)
    setIsReplacingClientSecret(false)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    setShowErrors(true)
    const validation = validateAll(formData)
    if (hasAnyErrors(validation)) {
      return
    }

    try {
      const providerType = formData.providerType || 'oidc'

      const requestBody: SsoRegistrationBody =
        providerType === 'oidc'
          ? {
              providerType: 'oidc',
              providerId: formData.providerId,
              issuer: formData.issuerUrl,
              domain: formData.domain,
              orgId: organizationId,
              jitProvisioningEnabled: formData.jitProvisioningEnabled,
              mapping: {
                id: formData.mapId.trim() || OIDC_DEFAULT_MAPPING.id,
                email: formData.mapEmail.trim() || OIDC_DEFAULT_MAPPING.email,
                name: formData.mapName.trim() || OIDC_DEFAULT_MAPPING.name,
                image: OIDC_DEFAULT_MAPPING.image,
              },
              clientId: formData.clientId,
              // Blank on an edit means the admin did not retype it: send the
              // sentinel so the server keeps the stored secret. Trimmed because a
              // pasted secret often carries a trailing newline, and because a
              // whitespace-only value must never be stored as the secret.
              clientSecret:
                hasStoredClientSecret && !formData.clientSecret.trim()
                  ? REDACTED_MARKER
                  : formData.clientSecret.trim(),
              scopes: formData.scopes.split(',').map((s) => s.trim()),
              ...(formData.authorizationEndpoint.trim()
                ? { authorizationEndpoint: formData.authorizationEndpoint.trim() }
                : {}),
              ...(formData.tokenEndpoint.trim()
                ? { tokenEndpoint: formData.tokenEndpoint.trim() }
                : {}),
              ...(formData.jwksEndpoint.trim()
                ? { jwksEndpoint: formData.jwksEndpoint.trim() }
                : {}),
            }
          : {
              providerType: 'saml',
              providerId: formData.providerId,
              issuer: formData.issuerUrl,
              domain: formData.domain,
              orgId: organizationId,
              jitProvisioningEnabled: formData.jitProvisioningEnabled,
              mapping: {
                id: formData.mapId.trim() || SAML_DEFAULT_MAPPING.id,
                email: formData.mapEmail.trim() || SAML_DEFAULT_MAPPING.email,
                name: formData.mapName.trim() || SAML_DEFAULT_MAPPING.name,
              },
              entryPoint: formData.entryPoint,
              cert: formData.cert,
              wantAssertionsSigned: formData.wantAssertionsSigned,
              ...(formData.callbackUrl ? { callbackUrl: formData.callbackUrl } : {}),
              ...(formData.audience ? { audience: formData.audience } : {}),
              ...(formData.idpMetadata ? { idpMetadata: formData.idpMetadata } : {}),
              identifierFormat: formData.identifierFormat,
            }

      await configureSSOMutation.mutateAsync(requestBody)

      logger.info('SSO provider configured', { providerId: formData.providerId })
      toast.success(isEditing ? 'SSO provider updated' : 'SSO provider configured')
      setFormData(DEFAULT_FORM_DATA)
      setOriginalFormData(DEFAULT_FORM_DATA)
      setErrors(DEFAULT_ERRORS)
      setShowErrors(false)
      setIsEditing(false)
      setShowAdvanced(false)
      setIsReplacingClientSecret(false)
    } catch (err) {
      const message = getErrorMessage(err, 'Unknown error occurred')
      toast.error(message)
      logger.error('Failed to configure SSO provider', { error: err })
    }
  }

  const handleInputChange = (field: keyof typeof formData, value: string | boolean) => {
    const next = { ...formData, [field]: value }
    // Claim names are protocol-specific, so an override must not survive a switch.
    if (field === 'providerType') {
      next.mapId = ''
      next.mapEmail = ''
      next.mapName = ''
      setShowErrors(false)
    }

    setFormData(next)
    validateAll(next)
  }

  /**
   * Backs out of a replacement: drops what was typed and revalidates as "keeping
   * the saved secret", so a required-error from a failed submit does not linger on
   * a row that is no longer an input.
   */
  const handleKeepSavedSecret = () => {
    setIsReplacingClientSecret(false)
    const next = { ...formData, clientSecret: '' }
    setFormData(next)
    validateAll(next, false)
  }

  const isSaml = formData.providerType === 'saml'
  const mappingDefaults = isSaml ? SAML_DEFAULT_MAPPING : OIDC_DEFAULT_MAPPING
  const callbackUrl = `${getBaseUrl()}/api/auth/${isSaml ? 'sso/saml2/callback' : 'sso/callback'}/${formData.providerId || existingProvider?.providerId || 'provider-id'}`

  const handleEdit = () => {
    if (!existingProvider) return

    try {
      let clientId = ''
      let clientSecret = ''
      let scopes = 'openid,profile,email'
      let entryPoint = ''
      let cert = ''
      let callbackUrl = ''
      let audience = ''
      let wantAssertionsSigned = true
      let idpMetadata = ''
      // Blank means "use the protocol default", so only carry over a stored value
      // that differs — otherwise editing rewrites a default as an explicit override.
      let mapping: { id?: string; email?: string; name?: string } = {}
      let identifierFormat = ''
      let authorizationEndpoint = ''
      let tokenEndpoint = ''
      let jwksEndpoint = ''

      if (existingProvider.providerType === 'oidc' && existingProvider.oidcConfig) {
        const config = JSON.parse(existingProvider.oidcConfig)
        clientId = config.clientId || ''
        // The API returns the sentinel, never the secret. Showing it verbatim put
        // the literal "[REDACTED]" in the field; blanking it lets the placeholder
        // say a secret is stored, and submit re-sends the sentinel to keep it.
        clientSecret = config.clientSecret === REDACTED_MARKER ? '' : config.clientSecret || ''
        scopes = config.scopes?.join(',') || 'openid,profile,email'
        mapping = config.mapping ?? {}
        authorizationEndpoint = config.authorizationEndpoint || ''
        tokenEndpoint = config.tokenEndpoint || ''
        jwksEndpoint = config.jwksEndpoint || ''
      } else if (existingProvider.providerType === 'saml' && existingProvider.samlConfig) {
        const config = JSON.parse(existingProvider.samlConfig)
        entryPoint = config.entryPoint || ''
        cert = config.cert || ''
        callbackUrl = config.callbackUrl || ''
        audience = config.audience || ''
        wantAssertionsSigned = config.wantAssertionsSigned ?? true
        // Two stored shapes: `{ metadata }` from the route, a bare string from older
        // rows. Narrow on type, not truthiness — `{ metadata: '' }` is falsy at
        // `.metadata` but truthy as an object, putting an object in a string field.
        idpMetadata =
          typeof config.idpMetadata === 'string'
            ? config.idpMetadata
            : (config.idpMetadata?.metadata ?? '')
        mapping = config.mapping ?? {}
        identifierFormat = config.identifierFormat || ''
      }

      const defaults =
        existingProvider.providerType === 'saml' ? SAML_DEFAULT_MAPPING : OIDC_DEFAULT_MAPPING
      const overrideOf = (value: string | undefined, fallback: string) =>
        value && value !== fallback ? value : ''

      const snapshot = {
        providerType: existingProvider.providerType,
        providerId: existingProvider.providerId,
        issuerUrl: existingProvider.issuer,
        domain: existingProvider.domain,
        clientId,
        clientSecret,
        scopes,
        entryPoint,
        cert,
        callbackUrl,
        audience,
        wantAssertionsSigned,
        idpMetadata,
        mapId: overrideOf(mapping.id, defaults.id),
        mapEmail: overrideOf(mapping.email, defaults.email),
        mapName: overrideOf(mapping.name, defaults.name),
        identifierFormat,
        authorizationEndpoint,
        tokenEndpoint,
        jwksEndpoint,
        jitProvisioningEnabled: existingProvider.jitProvisioningEnabled ?? true,
      }
      setFormData(snapshot)
      setOriginalFormData(snapshot)
      setIsEditing(true)
      setShowErrors(false)
      setShowAdvanced(false)
      setIsReplacingClientSecret(false)
      setShowMapping(Boolean(snapshot.mapId || snapshot.mapEmail || snapshot.mapName))
    } catch (err) {
      logger.error('Failed to parse provider config', { error: err })
      toast.error('Failed to load provider configuration')
    }
  }

  if (existingProvider && !isEditing) {
    const providerCallbackUrl = `${getBaseUrl()}/api/auth/${existingProvider.providerType === 'saml' ? 'sso/saml2/callback' : 'sso/callback'}/${existingProvider.providerId}`

    return (
      <SettingsPanel actions={[{ text: 'Edit', variant: 'primary', onSelect: handleEdit }]}>
        <VerifiedDomainsSection organizationId={organizationId} />
        <ScimSection organizationId={organizationId} />

        <SettingsSection label='Identity provider'>
          <div className='flex flex-col gap-4.5'>
            <SettingRow label='Provider ID'>
              <p className='text-[var(--text-primary)] text-small'>{existingProvider.providerId}</p>
            </SettingRow>

            <SettingRow label='Provider Type'>
              <p className='text-[var(--text-primary)] text-small'>
                {existingProvider.providerType.toUpperCase()}
              </p>
            </SettingRow>

            <SettingRow label='Domain'>
              <p className='text-[var(--text-primary)] text-small'>{existingProvider.domain}</p>
            </SettingRow>

            <SettingRow label='Issuer URL'>
              <p className='break-all text-[var(--text-primary)] text-small'>
                {existingProvider.issuer}
              </p>
            </SettingRow>

            <SettingRow
              label={
                existingProvider.providerType === 'saml' ? 'ACS URL (Reply URL)' : 'Callback URL'
              }
            >
              <ChipCopyInput value={providerCallbackUrl} copyLabel='Copy callback URL' />
              <p className='text-[var(--text-muted)] text-small'>
                Configure this in your identity provider
              </p>
            </SettingRow>

            {existingProvider.providerType === 'saml' && (
              <SettingRow label='SP Entity ID'>
                <ChipCopyInput value={getBaseUrl()} copyLabel='Copy entity ID' />
              </SettingRow>
            )}
          </div>
        </SettingsSection>

        <SettingsSection label='Member provisioning'>
          <SettingRow label='On first SSO sign-in'>
            <p className='text-[var(--text-body)] text-small'>
              {existingJitProvisioningEnabled ? 'Automatic' : 'Invite only'}
            </p>
            <p className='text-[var(--text-muted)] text-small'>
              {existingJitProvisioningEnabled
                ? 'Users authenticated through this verified SSO connection join as Members and consume a seat. No workspace access is granted automatically.'
                : 'SSO authenticates users, but an invitation is required before they join the organization or gain workspace access.'}
            </p>
          </SettingRow>
          <p className='text-[var(--text-muted)] text-small'>
            Disabling a user in your identity provider does not remove their Sim membership or
            active sessions. Remove or suspend access in Sim as part of offboarding.
          </p>
        </SettingsSection>
      </SettingsPanel>
    )
  }

  return (
    <form onSubmit={handleSubmit} autoComplete='off'>
      <input
        type='text'
        name='fakeusernameremembered'
        autoComplete='username'
        className='-left-[9999px] pointer-events-none absolute opacity-0'
        tabIndex={-1}
        readOnly
      />
      <input
        type='password'
        name='fakepasswordremembered'
        autoComplete='current-password'
        className='-left-[9999px] pointer-events-none absolute opacity-0'
        tabIndex={-1}
        readOnly
      />
      <input
        type='email'
        name='fakeemailremembered'
        autoComplete='email'
        className='-left-[9999px] pointer-events-none absolute opacity-0'
        tabIndex={-1}
        readOnly
      />
      <input type='text' name='hidden' className='hidden' autoComplete='off' />

      <SettingsPanel
        actions={[
          ...(isEditing && !hasChanges
            ? [
                {
                  text: 'Cancel',
                  onSelect: handleDiscard,
                  disabled: configureSSOMutation.isPending,
                } satisfies SettingsAction,
              ]
            : []),
          ...saveDiscardActions({
            dirty: hasChanges,
            saving: configureSSOMutation.isPending,
            // Never disabled on validation errors: showErrors is only set by
            // handleSubmit, so disabling Save left a greyed button and no message.
            saveLabel: isEditing ? 'Update' : 'Save',
            savingLabel: isEditing ? 'Updating...' : 'Saving...',
            onSave: () => void handleSubmit(),
            onDiscard: handleDiscard,
          }),
        ]}
      >
        <VerifiedDomainsSection organizationId={organizationId} />
        <ScimSection organizationId={organizationId} />

        <SettingsSection label='Identity provider'>
          <div className='flex flex-col gap-4.5'>
            <SettingRow label='Provider Type'>
              <ChipSelect
                align='start'
                value={formData.providerType}
                onChange={(value: string) =>
                  handleInputChange('providerType', value as 'oidc' | 'saml')
                }
                options={[
                  { label: 'OIDC', value: 'oidc' },
                  { label: 'SAML', value: 'saml' },
                ]}
                placeholder='Select provider type'
              />
              <p className='text-[var(--text-muted)] text-small'>
                {formData.providerType === 'oidc'
                  ? 'OpenID Connect (Okta, Azure AD, Auth0, etc.)'
                  : 'Security Assertion Markup Language (ADFS, Shibboleth, etc.)'}
              </p>
            </SettingRow>

            <SettingRow
              label='Provider ID'
              error={
                showErrors && errors.providerId.length > 0 ? errors.providerId.join(' ') : undefined
              }
            >
              {isEditing ? (
                <>
                  <ChipCopyInput value={formData.providerId} copyLabel='Copy provider ID' />
                  <p className='text-[var(--text-muted)] text-small'>
                    Fixed once saved — it forms the redirect URL registered with your identity
                    provider.
                  </p>
                </>
              ) : (
                <>
                  <ChipCombobox
                    value={formData.providerId}
                    onChange={(value: string) => handleInputChange('providerId', value)}
                    options={PROVIDER_ID_SUGGESTIONS}
                    placeholder='Select or enter a provider ID'
                    editable
                  />
                  <p className='text-[var(--text-muted)] text-small'>
                    Must be unique across all Sim organizations — include something specific to you,
                    like <span className='font-mono'>azure-ad-acme</span>. It cannot be changed
                    later.
                  </p>
                </>
              )}
            </SettingRow>

            <SettingRow
              label='Issuer URL'
              error={
                showErrors && errors.issuerUrl.length > 0 ? errors.issuerUrl.join(' ') : undefined
              }
            >
              <ChipInput
                id='sso-issuer'
                type='url'
                placeholder='https://your-identity-provider.com/oauth2/default'
                value={formData.issuerUrl}
                name='sso_issuer_endpoint'
                autoComplete='off'
                autoCapitalize='none'
                spellCheck={false}
                readOnly
                onFocus={(e) => e.target.removeAttribute('readOnly')}
                onChange={(e) => handleInputChange('issuerUrl', e.target.value)}
                error={showErrors && errors.issuerUrl.length > 0}
              />
            </SettingRow>

            <SettingRow
              label='Domain'
              error={showErrors && errors.domain.length > 0 ? errors.domain.join(' ') : undefined}
            >
              <ChipInput
                id='sso-domain'
                type='text'
                placeholder='company.com'
                value={formData.domain}
                name='sso_identity_domain'
                autoComplete='off'
                autoCapitalize='none'
                spellCheck={false}
                readOnly
                onFocus={(e) => e.target.removeAttribute('readOnly')}
                onChange={(e) => handleInputChange('domain', e.target.value)}
                error={showErrors && errors.domain.length > 0}
              />
              <p className='text-[var(--text-muted)] text-small'>
                The email domain users sign in with (e.g. company.com)
              </p>
            </SettingRow>

            {formData.providerType === 'oidc' ? (
              <>
                <SettingRow
                  label='Client ID'
                  error={
                    showErrors && errors.clientId.length > 0 ? errors.clientId.join(' ') : undefined
                  }
                >
                  <ChipInput
                    id='sso-client-id'
                    type='text'
                    placeholder='Enter Client ID'
                    value={formData.clientId}
                    name='sso_client_identifier'
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    readOnly
                    onFocus={(e) => e.target.removeAttribute('readOnly')}
                    onChange={(e) => handleInputChange('clientId', e.target.value)}
                    error={showErrors && errors.clientId.length > 0}
                  />
                </SettingRow>

                <SettingRow
                  label='Client Secret'
                  htmlFor={CLIENT_SECRET_FIELD_ID}
                  description={
                    isReplacingClientSecret ? 'Replaces the saved secret when you save.' : undefined
                  }
                  error={
                    showErrors && errors.clientSecret.length > 0
                      ? errors.clientSecret.join(' ')
                      : undefined
                  }
                >
                  <ClientSecretField
                    hasStoredSecret={hasStoredClientSecret}
                    storedHint={storedClientSecretHint}
                    isReplacing={isReplacingClientSecret}
                    onReplace={() => setIsReplacingClientSecret(true)}
                    onCancelReplace={handleKeepSavedSecret}
                    value={formData.clientSecret}
                    onChange={(next) => handleInputChange('clientSecret', next)}
                    hasError={showErrors && errors.clientSecret.length > 0}
                  />
                </SettingRow>

                <div className='flex flex-col gap-2'>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => setShowAdvanced((v) => !v)}
                    className='w-fit gap-1.5 px-0 text-[var(--text-muted)] hover:bg-transparent hover:text-[var(--text-primary)]'
                  >
                    <ChevronDown
                      className={cn(
                        'size-[14px] transition-transform',
                        showAdvanced && 'rotate-180'
                      )}
                    />
                    Advanced Options
                  </Button>

                  <Expandable expanded={showAdvanced}>
                    <ExpandableContent>
                      <div className='flex flex-col gap-4.5 pt-2'>
                        <SettingRow label='Authorization endpoint' optional>
                          <ChipInput
                            type='url'
                            placeholder='Discovered from the issuer'
                            value={formData.authorizationEndpoint}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) =>
                              handleInputChange('authorizationEndpoint', e.target.value)
                            }
                          />
                        </SettingRow>

                        <SettingRow label='Token endpoint' optional>
                          <ChipInput
                            type='url'
                            placeholder='Discovered from the issuer'
                            value={formData.tokenEndpoint}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('tokenEndpoint', e.target.value)}
                          />
                        </SettingRow>

                        <SettingRow label='JWKS endpoint' optional>
                          <ChipInput
                            type='url'
                            placeholder='Discovered from the issuer'
                            value={formData.jwksEndpoint}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('jwksEndpoint', e.target.value)}
                          />
                          <p className='text-[var(--text-muted)] text-small'>
                            Sim reads these from the issuer's discovery document. Set them only if
                            your provider does not publish one.
                          </p>
                        </SettingRow>
                      </div>
                    </ExpandableContent>
                  </Expandable>
                </div>

                <SettingRow
                  label='Scopes'
                  error={
                    showErrors && errors.scopes.length > 0 ? errors.scopes.join(' ') : undefined
                  }
                >
                  <ChipInput
                    id='sso-scopes'
                    type='text'
                    placeholder='openid,profile,email'
                    value={formData.scopes}
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    onChange={(e) => handleInputChange('scopes', e.target.value)}
                    error={showErrors && errors.scopes.length > 0}
                  />
                  <p className='text-[var(--text-muted)] text-small'>
                    Comma-separated list of OIDC scopes to request
                  </p>
                </SettingRow>
              </>
            ) : (
              <>
                <SettingRow
                  label='Entry Point URL'
                  error={
                    showErrors && errors.entryPoint.length > 0
                      ? errors.entryPoint.join(' ')
                      : undefined
                  }
                >
                  <ChipInput
                    id='sso-entry-point'
                    type='url'
                    placeholder='https://idp.example.com/sso/saml'
                    value={formData.entryPoint}
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    onChange={(e) => handleInputChange('entryPoint', e.target.value)}
                    error={showErrors && errors.entryPoint.length > 0}
                  />
                </SettingRow>

                <SettingRow
                  label='Identity Provider Certificate'
                  error={showErrors && errors.cert.length > 0 ? errors.cert.join(' ') : undefined}
                >
                  <ChipTextarea
                    id='sso-cert'
                    placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                    value={formData.cert}
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    onChange={(e) => handleInputChange('cert', e.target.value)}
                    className='min-h-[80px] font-mono'
                    error={showErrors && errors.cert.length > 0}
                    rows={3}
                  />
                </SettingRow>

                <div className='flex flex-col gap-2'>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => setShowAdvanced((v) => !v)}
                    className='w-fit gap-1.5 px-0 text-[var(--text-muted)] hover:bg-transparent hover:text-[var(--text-primary)]'
                  >
                    <ChevronDown
                      className={cn(
                        'size-[14px] transition-transform',
                        showAdvanced && 'rotate-180'
                      )}
                    />
                    Advanced Options
                  </Button>

                  <Expandable expanded={showAdvanced}>
                    <ExpandableContent>
                      <div className='flex flex-col gap-4.5 pt-2'>
                        <SettingRow label='Audience (Entity ID)' optional>
                          <ChipInput
                            type='text'
                            placeholder='Enter Audience'
                            value={formData.audience}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('audience', e.target.value)}
                          />
                        </SettingRow>

                        <SettingRow label='Callback URL Override' optional>
                          <ChipInput
                            type='url'
                            placeholder={`${getBaseUrl()}/api/auth/sso/saml2/callback/provider-id`}
                            value={formData.callbackUrl}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('callbackUrl', e.target.value)}
                          />
                        </SettingRow>

                        <SettingRow label='Require signed SAML assertions'>
                          <Switch
                            checked={formData.wantAssertionsSigned}
                            onCheckedChange={(checked) =>
                              handleInputChange('wantAssertionsSigned', checked)
                            }
                          />
                        </SettingRow>

                        <SettingRow label='NameID format' optional>
                          <ChipSelect
                            align='start'
                            value={formData.identifierFormat}
                            onChange={(value: string) =>
                              handleInputChange('identifierFormat', value)
                            }
                            options={[...SAML_NAMEID_FORMATS]}
                            placeholder='Provider default'
                          />
                        </SettingRow>

                        <SettingRow label='IDP Metadata XML' optional>
                          <ChipTextarea
                            placeholder='Paste IDP metadata XML here'
                            value={formData.idpMetadata}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('idpMetadata', e.target.value)}
                            className='min-h-[60px] font-mono'
                            rows={2}
                          />
                        </SettingRow>
                      </div>
                    </ExpandableContent>
                  </Expandable>
                </div>
              </>
            )}

            <SettingRow label={isSaml ? 'ACS URL (Reply URL)' : 'Callback URL'}>
              <ChipCopyInput value={callbackUrl} copyLabel='Copy callback URL' />
              <p className='text-[var(--text-muted)] text-small'>
                Configure this in your identity provider
              </p>
            </SettingRow>

            {/* Sim publishes no SP metadata document; these are the values it would carry. */}
            {isSaml && (
              <SettingRow label='SP Entity ID'>
                <ChipCopyInput value={getBaseUrl()} copyLabel='Copy entity ID' />
                <p className='text-[var(--text-muted)] text-small'>
                  Sim's identifier in your IdP. With the ACS URL above, this is everything needed to
                  add Sim as a service provider.
                </p>
              </SettingRow>
            )}

            <div className='flex flex-col gap-2'>
              <Button
                type='button'
                variant='ghost'
                onClick={() => setShowMapping((v) => !v)}
                className='w-fit gap-1.5 px-0 text-[var(--text-muted)] hover:bg-transparent hover:text-[var(--text-primary)]'
              >
                <ChevronDown
                  className={cn('size-[14px] transition-transform', showMapping && 'rotate-180')}
                />
                Attribute mapping
              </Button>

              <Expandable expanded={showMapping}>
                <ExpandableContent>
                  <div className='flex flex-col gap-4.5 pt-2'>
                    <SettingRow label='Email attribute' optional>
                      <ChipInput
                        type='text'
                        placeholder={mappingDefaults.email}
                        value={formData.mapEmail}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        inputClassName='font-mono'
                        onChange={(e) => handleInputChange('mapEmail', e.target.value)}
                      />
                    </SettingRow>

                    <SettingRow label='Name attribute' optional>
                      <ChipInput
                        type='text'
                        placeholder={mappingDefaults.name}
                        value={formData.mapName}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        inputClassName='font-mono'
                        onChange={(e) => handleInputChange('mapName', e.target.value)}
                      />
                    </SettingRow>

                    <SettingRow label='User ID attribute' optional>
                      <ChipInput
                        type='text'
                        placeholder={mappingDefaults.id}
                        value={formData.mapId}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        inputClassName='font-mono'
                        onChange={(e) => handleInputChange('mapId', e.target.value)}
                      />
                      <p className='text-[var(--text-muted)] text-small'>
                        Must be stable and unique per user — changing it later re-links accounts.
                      </p>
                    </SettingRow>
                  </div>
                </ExpandableContent>
              </Expandable>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection label='Member provisioning'>
          <SettingRow label='On first SSO sign-in'>
            <ChipSwitch
              value={formData.jitProvisioningEnabled ? 'automatic' : 'invite-only'}
              onChange={(value) =>
                handleInputChange('jitProvisioningEnabled', value === 'automatic')
              }
              aria-label='SSO member provisioning mode'
              options={[
                { value: 'automatic', label: 'Automatic' },
                { value: 'invite-only', label: 'Invite only' },
              ]}
            />
            <p className='text-[var(--text-muted)] text-small'>
              {formData.jitProvisioningEnabled
                ? 'Users authenticated through this verified SSO connection join as Members and consume a seat on first sign-in. They receive no workspace access until it is granted separately.'
                : 'SSO only authenticates users. Invite them to grant organization membership or workspace access.'}
            </p>
          </SettingRow>
          <p className='text-[var(--text-muted)] text-small'>
            Existing members are not removed when you choose Invite only or disable them in your
            identity provider. Offboarding remains an explicit Sim admin action.
          </p>
        </SettingsSection>
      </SettingsPanel>
    </form>
  )
}
