'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, ChevronDown, Clipboard, Eye, EyeOff } from 'lucide-react'
import {
  Button,
  Combobox,
  Expandable,
  ExpandableContent,
  FormField,
  Input,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { SSO_TRUSTED_PROVIDERS } from '@/ee/sso/constants'
import { useConfigureSSO, useSSOProviders } from '@/ee/sso/hooks/sso'
import { useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'

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
  providerType: 'oidc' | 'saml'
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

export function SSO() {
  const { data: session } = useSession()
  const { data: orgsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()

  const activeOrganization = orgsData?.activeOrganization

  const { data: providersData, isLoading: isLoadingProviders } = useSSOProviders({
    organizationId: activeOrganization?.id,
  })

  const providers = providersData?.providers || []
  const existingProvider = providers[0] as SSOProvider | undefined

  const userEmail = session?.user?.email
  const userId = session?.user?.id
  const userRole = getUserRole(orgsData?.activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const canManageSSO = isOwner || isAdmin
  const subscriptionAccess = getSubscriptionAccessState(subscriptionData?.data)
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const isSSOProviderOwner =
    !isBillingEnabled && userId ? providers.some((p: any) => p.userId === userId) : null

  const configureSSOMutation = useConfigureSSO()

  const [showClientSecret, setShowClientSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [formData, setFormData] = useState(DEFAULT_FORM_DATA)
  const [originalFormData, setOriginalFormData] = useState(DEFAULT_FORM_DATA)
  const [errors, setErrors] = useState<Record<string, string[]>>(DEFAULT_ERRORS)
  const [showErrors, setShowErrors] = useState(false)

  if (isBillingEnabled) {
    if (!activeOrganization) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
          You must be part of an organization to configure Single Sign-On.
        </div>
      )
    }

    if (!hasEnterprisePlan) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
          Single Sign-On is available on Enterprise plans only.
        </div>
      )
    }

    if (!canManageSSO) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
          Only organization owners and admins can configure Single Sign-On settings.
        </div>
      )
    }
  } else {
    if (activeOrganization && !canManageSSO) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
          Only organization owners and admins can configure Single Sign-On settings.
        </div>
      )
    }
    if (
      !activeOrganization &&
      !isLoadingProviders &&
      isSSOProviderOwner === false &&
      providers.length > 0
    ) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
          Only the user who configured SSO can manage these settings.
        </div>
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

  const validateAll = (data: typeof formData) => {
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
      newErrors.clientSecret = validateRequired('Client Secret', data.clientSecret)
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

  const hasChanges = () =>
    (Object.keys(formData) as (keyof typeof formData)[]).some(
      (k) => formData[k] !== originalFormData[k]
    )

  const isFormValid = () => {
    const requiredFields = ['providerId', 'issuerUrl', 'domain']
    const hasRequiredFields = requiredFields.every((field) => {
      const value = formData[field as keyof typeof formData]
      return typeof value === 'string' && value.trim() !== ''
    })

    const providerType = formData.providerType || 'oidc'

    if (providerType === 'oidc') {
      return (
        hasRequiredFields &&
        formData.clientId.trim() !== '' &&
        formData.clientSecret.trim() !== '' &&
        formData.scopes.trim() !== ''
      )
    }
    if (providerType === 'saml') {
      return hasRequiredFields && formData.entryPoint.trim() !== '' && formData.cert.trim() !== ''
    }

    return false
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setShowErrors(true)
    const validation = validateAll(formData)
    if (hasAnyErrors(validation)) {
      return
    }

    try {
      const providerType = formData.providerType || 'oidc'

      const requestBody: any = {
        providerId: formData.providerId,
        issuer: formData.issuerUrl,
        domain: formData.domain,
        providerType,
        orgId: activeOrganization?.id,
        mapping: {
          id: 'sub',
          email: 'email',
          name: 'name',
          image: 'picture',
        },
      }

      if (providerType === 'oidc') {
        requestBody.clientId = formData.clientId
        requestBody.clientSecret = formData.clientSecret
        requestBody.scopes = formData.scopes.split(',').map((s) => s.trim())
      } else if (providerType === 'saml') {
        requestBody.entryPoint = formData.entryPoint
        requestBody.cert = formData.cert
        requestBody.wantAssertionsSigned = formData.wantAssertionsSigned
        if (formData.callbackUrl) requestBody.callbackUrl = formData.callbackUrl
        if (formData.audience) requestBody.audience = formData.audience
        if (formData.idpMetadata) requestBody.idpMetadata = formData.idpMetadata

        requestBody.mapping = {
          id: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
          email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
          name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
        }
      }

      await configureSSOMutation.mutateAsync(requestBody)

      logger.info('SSO provider configured', { providerId: formData.providerId })
      toast.success(isEditing ? 'SSO provider updated' : 'SSO provider configured')
      setFormData(DEFAULT_FORM_DATA)
      setErrors(DEFAULT_ERRORS)
      setShowErrors(false)
      setIsEditing(false)
      setShowAdvanced(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred'
      toast.error(message)
      logger.error('Failed to configure SSO provider', { error: err })
    }
  }

  const handleInputChange = (field: keyof typeof formData, value: string | boolean) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value }

      if (field === 'providerType') {
        setShowErrors(false)
      }

      validateAll(next)

      return next
    })
  }

  const isSaml = formData.providerType === 'saml'
  const callbackUrl = `${getBaseUrl()}/api/auth/${isSaml ? 'sso/saml2/callback' : 'sso/callback'}/${formData.providerId || existingProvider?.providerId || 'provider-id'}`

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

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

      if (existingProvider.providerType === 'oidc' && existingProvider.oidcConfig) {
        const config = JSON.parse(existingProvider.oidcConfig)
        clientId = config.clientId || ''
        clientSecret = config.clientSecret || ''
        scopes = config.scopes?.join(',') || 'openid,profile,email'
      } else if (existingProvider.providerType === 'saml' && existingProvider.samlConfig) {
        const config = JSON.parse(existingProvider.samlConfig)
        entryPoint = config.entryPoint || ''
        cert = config.cert || ''
        callbackUrl = config.callbackUrl || ''
        audience = config.audience || ''
        wantAssertionsSigned = config.wantAssertionsSigned ?? true
        idpMetadata = config.idpMetadata?.metadata || config.idpMetadata || ''
      }

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
      }
      setFormData(snapshot)
      setOriginalFormData(snapshot)
      setIsEditing(true)
      setShowErrors(false)
      setShowAdvanced(false)
    } catch (err) {
      logger.error('Failed to parse provider config', { error: err })
      toast.error('Failed to load provider configuration')
    }
  }

  if (isLoadingProviders) {
    return <SsoSkeleton />
  }

  if (existingProvider && !isEditing) {
    const providerCallbackUrl = `${getBaseUrl()}/api/auth/${existingProvider.providerType === 'saml' ? 'sso/saml2/callback' : 'sso/callback'}/${existingProvider.providerId}`

    return (
      <div className='flex h-full flex-col gap-4.5'>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-4.5'>
            <FormField label='Provider ID'>
              <p className='text-[var(--text-primary)] text-small'>{existingProvider.providerId}</p>
            </FormField>

            <FormField label='Provider Type'>
              <p className='text-[var(--text-primary)] text-small'>
                {existingProvider.providerType.toUpperCase()}
              </p>
            </FormField>

            <FormField label='Domain'>
              <p className='text-[var(--text-primary)] text-small'>{existingProvider.domain}</p>
            </FormField>

            <FormField label='Issuer URL'>
              <p className='break-all font-mono text-[var(--text-primary)] text-small leading-relaxed'>
                {existingProvider.issuer}
              </p>
            </FormField>

            <FormField label='Callback URL'>
              <div className='relative'>
                <Input value={providerCallbackUrl} readOnly className='h-9 pr-9' />
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => copyToClipboard(providerCallbackUrl)}
                  className='-translate-y-1/2 absolute top-1/2 right-[8px] h-6 w-6 p-0 text-[var(--text-icon)] hover:text-[var(--text-primary)]'
                  aria-label='Copy callback URL'
                >
                  {copied ? (
                    <Check className='h-[14px] w-[14px]' />
                  ) : (
                    <Clipboard className='h-[14px] w-[14px]' />
                  )}
                </Button>
              </div>
              <p className='text-[var(--text-muted)] text-small'>
                Configure this in your identity provider
              </p>
            </FormField>
          </div>
        </div>

        <div className='mt-auto flex items-center justify-end'>
          <Button onClick={handleEdit} variant='primary'>
            Edit
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} autoComplete='off' className='flex h-full flex-col gap-4.5'>
      {/* Off-screen inputs to prevent browser password manager autofill */}
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
      <input type='text' name='hidden' className='hidden' autoComplete='false' />

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-4.5'>
          {/* Provider Type */}
          <FormField label='Provider Type'>
            <Combobox
              value={formData.providerType}
              onChange={(value: string) =>
                handleInputChange('providerType', value as 'oidc' | 'saml')
              }
              options={[
                { label: 'OIDC', value: 'oidc' },
                { label: 'SAML', value: 'saml' },
              ]}
              placeholder='Select provider type'
              editable={false}
              className='h-9'
            />
            <p className='text-[var(--text-muted)] text-small'>
              {formData.providerType === 'oidc'
                ? 'OpenID Connect (Okta, Azure AD, Auth0, etc.)'
                : 'Security Assertion Markup Language (ADFS, Shibboleth, etc.)'}
            </p>
          </FormField>

          {/* Provider ID */}
          <FormField
            label='Provider ID'
            error={
              showErrors && errors.providerId.length > 0 ? errors.providerId.join(' ') : undefined
            }
          >
            <Combobox
              value={formData.providerId}
              onChange={(value: string) => handleInputChange('providerId', value)}
              options={SSO_TRUSTED_PROVIDERS.map((id) => ({
                label: id,
                value: id,
              }))}
              placeholder='Select or enter a provider ID'
              editable={true}
              className={cn(
                'h-9',
                showErrors && errors.providerId.length > 0 && 'border-[var(--text-error)]'
              )}
            />
          </FormField>

          {/* Issuer URL */}
          <FormField
            label='Issuer URL'
            error={
              showErrors && errors.issuerUrl.length > 0 ? errors.issuerUrl.join(' ') : undefined
            }
          >
            <Input
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
              className={cn(
                'h-9',
                showErrors && errors.issuerUrl.length > 0 && 'border-[var(--text-error)]'
              )}
            />
          </FormField>

          {/* Domain */}
          <FormField
            label='Domain'
            error={showErrors && errors.domain.length > 0 ? errors.domain.join(' ') : undefined}
          >
            <Input
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
              className={cn(
                'h-9',
                showErrors && errors.domain.length > 0 && 'border-[var(--text-error)]'
              )}
            />
            <p className='text-[var(--text-muted)] text-small'>
              The email domain users sign in with (e.g. company.com)
            </p>
          </FormField>

          {formData.providerType === 'oidc' ? (
            <>
              {/* Client ID */}
              <FormField
                label='Client ID'
                error={
                  showErrors && errors.clientId.length > 0 ? errors.clientId.join(' ') : undefined
                }
              >
                <Input
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
                  className={cn(
                    'h-9',
                    showErrors && errors.clientId.length > 0 && 'border-[var(--text-error)]'
                  )}
                />
              </FormField>

              {/* Client Secret */}
              <FormField
                label='Client Secret'
                error={
                  showErrors && errors.clientSecret.length > 0
                    ? errors.clientSecret.join(' ')
                    : undefined
                }
              >
                <div className='relative'>
                  <Input
                    id='sso-client-secret'
                    type='text'
                    placeholder='Enter Client Secret'
                    value={formData.clientSecret}
                    name='sso_client_key'
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    readOnly
                    onFocus={(e) => {
                      e.target.removeAttribute('readOnly')
                      setShowClientSecret(true)
                    }}
                    onBlurCapture={() => setShowClientSecret(false)}
                    onChange={(e) => handleInputChange('clientSecret', e.target.value)}
                    style={
                      !showClientSecret
                        ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
                        : undefined
                    }
                    className={cn(
                      'h-9 pr-9',
                      showErrors && errors.clientSecret.length > 0 && 'border-[var(--text-error)]'
                    )}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => setShowClientSecret((s) => !s)}
                    className='-translate-y-1/2 absolute top-1/2 right-[8px] h-6 w-6 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    aria-label={showClientSecret ? 'Hide client secret' : 'Show client secret'}
                  >
                    {showClientSecret ? (
                      <EyeOff className='h-[14px] w-[14px]' />
                    ) : (
                      <Eye className='h-[14px] w-[14px]' />
                    )}
                  </Button>
                </div>
              </FormField>

              {/* Scopes */}
              <FormField
                label='Scopes'
                error={showErrors && errors.scopes.length > 0 ? errors.scopes.join(' ') : undefined}
              >
                <Input
                  id='sso-scopes'
                  type='text'
                  placeholder='openid,profile,email'
                  value={formData.scopes}
                  autoComplete='off'
                  autoCapitalize='none'
                  spellCheck={false}
                  onChange={(e) => handleInputChange('scopes', e.target.value)}
                  className={cn(
                    'h-9',
                    showErrors && errors.scopes.length > 0 && 'border-[var(--text-error)]'
                  )}
                />
                <p className='text-[var(--text-muted)] text-small'>
                  Comma-separated list of OIDC scopes to request
                </p>
              </FormField>
            </>
          ) : (
            <>
              {/* Entry Point URL */}
              <FormField
                label='Entry Point URL'
                error={
                  showErrors && errors.entryPoint.length > 0
                    ? errors.entryPoint.join(' ')
                    : undefined
                }
              >
                <Input
                  id='sso-entry-point'
                  type='url'
                  placeholder='https://idp.example.com/sso/saml'
                  value={formData.entryPoint}
                  autoComplete='off'
                  autoCapitalize='none'
                  spellCheck={false}
                  onChange={(e) => handleInputChange('entryPoint', e.target.value)}
                  className={cn(
                    'h-9',
                    showErrors && errors.entryPoint.length > 0 && 'border-[var(--text-error)]'
                  )}
                />
              </FormField>

              {/* Identity Provider Certificate */}
              <FormField
                label='Identity Provider Certificate'
                error={showErrors && errors.cert.length > 0 ? errors.cert.join(' ') : undefined}
              >
                <Textarea
                  id='sso-cert'
                  placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                  value={formData.cert}
                  autoComplete='off'
                  autoCapitalize='none'
                  spellCheck={false}
                  onChange={(e) => handleInputChange('cert', e.target.value)}
                  className={cn(
                    'min-h-[80px] font-mono',
                    showErrors && errors.cert.length > 0 && 'border-[var(--text-error)]'
                  )}
                  rows={3}
                />
              </FormField>

              <div className='flex flex-col gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => setShowAdvanced((v) => !v)}
                  className='w-fit gap-1.5 px-0 text-[var(--text-muted)] hover:bg-transparent hover:text-[var(--text-primary)]'
                >
                  <ChevronDown
                    className={cn(
                      'h-[14px] w-[14px] transition-transform',
                      showAdvanced && 'rotate-180'
                    )}
                  />
                  Advanced Options
                </Button>

                <Expandable expanded={showAdvanced}>
                  <ExpandableContent>
                    <div className='flex flex-col gap-4.5 pt-2'>
                      <FormField label='Audience (Entity ID)' optional>
                        <Input
                          type='text'
                          placeholder='Enter Audience'
                          value={formData.audience}
                          autoComplete='off'
                          autoCapitalize='none'
                          spellCheck={false}
                          onChange={(e) => handleInputChange('audience', e.target.value)}
                          className='h-9'
                        />
                      </FormField>

                      <FormField label='Callback URL Override' optional>
                        <Input
                          type='url'
                          placeholder={`${getBaseUrl()}/api/auth/sso/saml2/callback/provider-id`}
                          value={formData.callbackUrl}
                          autoComplete='off'
                          autoCapitalize='none'
                          spellCheck={false}
                          onChange={(e) => handleInputChange('callbackUrl', e.target.value)}
                          className='h-9'
                        />
                      </FormField>

                      <FormField label='Require signed SAML assertions'>
                        <Switch
                          checked={formData.wantAssertionsSigned}
                          onCheckedChange={(checked) =>
                            handleInputChange('wantAssertionsSigned', checked)
                          }
                        />
                      </FormField>

                      <FormField label='IDP Metadata XML' optional>
                        <Textarea
                          placeholder='Paste IDP metadata XML here'
                          value={formData.idpMetadata}
                          autoComplete='off'
                          autoCapitalize='none'
                          spellCheck={false}
                          onChange={(e) => handleInputChange('idpMetadata', e.target.value)}
                          className='min-h-[60px] font-mono'
                          rows={2}
                        />
                      </FormField>
                    </div>
                  </ExpandableContent>
                </Expandable>
              </div>
            </>
          )}

          {/* Callback URL */}
          <FormField label='Callback URL'>
            <div className='relative'>
              <Input value={callbackUrl} readOnly className='h-9 pr-9' />
              <Button
                type='button'
                variant='ghost'
                onClick={() => copyToClipboard(callbackUrl)}
                className='-translate-y-1/2 absolute top-1/2 right-[8px] h-6 w-6 p-0 text-[var(--text-icon)] hover:text-[var(--text-primary)]'
                aria-label='Copy callback URL'
              >
                {copied ? (
                  <Check className='h-[14px] w-[14px]' />
                ) : (
                  <Clipboard className='h-[14px] w-[14px]' />
                )}
              </Button>
            </div>
            <p className='text-[var(--text-muted)] text-small'>
              Configure this in your identity provider
            </p>
          </FormField>
        </div>
      </div>

      <div className='mt-auto flex items-center justify-end gap-2'>
        {isEditing && (
          <Button
            type='button'
            variant='default'
            onClick={() => {
              setIsEditing(false)
              setFormData(DEFAULT_FORM_DATA)
              setErrors(DEFAULT_ERRORS)
              setShowErrors(false)
              setShowAdvanced(false)
            }}
          >
            Cancel
          </Button>
        )}
        <Button
          type='submit'
          variant='primary'
          disabled={
            configureSSOMutation.isPending ||
            hasAnyErrors(errors) ||
            !isFormValid() ||
            (isEditing && !hasChanges())
          }
        >
          {configureSSOMutation.isPending
            ? isEditing
              ? 'Updating...'
              : 'Saving...'
            : isEditing
              ? 'Update'
              : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function SsoSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-4.5'>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className='flex flex-col gap-2'>
              <Skeleton className='h-[13px] w-[80px]' />
              <Skeleton className='h-9 w-full' />
            </div>
          ))}
        </div>
      </div>
      <div className='mt-auto flex items-center justify-end'>
        <Skeleton className='h-9 w-[60px]' />
      </div>
    </div>
  )
}
