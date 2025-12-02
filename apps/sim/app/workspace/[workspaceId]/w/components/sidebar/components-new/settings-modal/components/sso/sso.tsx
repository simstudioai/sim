'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Copy, Eye, EyeOff, Plus, Search } from 'lucide-react'
import { Button, Combobox, Input, Switch, Textarea } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal/modal'
import { Skeleton, Input as UiInput } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client/utils'
import { isBillingEnabled } from '@/lib/core/config/environment'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { useOrganizations } from '@/hooks/queries/organization'
import { useConfigureSSO, useSSOProviders } from '@/hooks/queries/sso'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('SSO')

const TRUSTED_SSO_PROVIDERS = [
  'okta',
  'okta-saml',
  'okta-prod',
  'okta-dev',
  'okta-staging',
  'okta-test',
  'azure-ad',
  'azure-active-directory',
  'azure-corp',
  'azure-enterprise',
  'adfs',
  'adfs-company',
  'adfs-corp',
  'adfs-enterprise',
  'auth0',
  'auth0-prod',
  'auth0-dev',
  'auth0-staging',
  'onelogin',
  'onelogin-prod',
  'onelogin-corp',
  'jumpcloud',
  'jumpcloud-prod',
  'jumpcloud-corp',
  'ping-identity',
  'ping-federate',
  'pingone',
  'shibboleth',
  'shibboleth-idp',
  'google-workspace',
  'google-sso',
  'saml',
  'saml2',
  'saml-sso',
  'oidc',
  'oidc-sso',
  'openid-connect',
  'custom-sso',
  'enterprise-sso',
  'company-sso',
]

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
  showAdvanced: false,
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
  const { data: providersData, isLoading: isLoadingProviders } = useSSOProviders()

  const activeOrganization = orgsData?.activeOrganization
  const providers = providersData?.providers || []

  const userEmail = session?.user?.email
  const userId = session?.user?.id
  const userRole = getUserRole(orgsData?.activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const canManageSSO = isOwner || isAdmin
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasEnterprisePlan = subscriptionStatus.isEnterprise

  const isSSOProviderOwner =
    !isBillingEnabled && userId ? providers.some((p: any) => p.userId === userId) : null

  const configureSSOMutation = useConfigureSSO()

  const [error, setError] = useState<string | null>(null)
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [providerToDelete, setProviderToDelete] = useState<SSOProvider | null>(null)

  const [formData, setFormData] = useState(DEFAULT_FORM_DATA)
  const [errors, setErrors] = useState<Record<string, string[]>>(DEFAULT_ERRORS)
  const [showErrors, setShowErrors] = useState(false)

  const filteredProviders = useMemo(() => {
    if (!searchTerm.trim()) return providers
    const term = searchTerm.toLowerCase()
    return providers.filter(
      (p: SSOProvider) =>
        p.providerId?.toLowerCase().includes(term) || p.domain?.toLowerCase().includes(term)
    )
  }, [providers, searchTerm])

  // Permission checks with early returns
  if (isBillingEnabled) {
    if (!activeOrganization) {
      return (
        <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
          You must be part of an organization to configure Single Sign-On.
        </div>
      )
    }

    if (!hasEnterprisePlan) {
      return (
        <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
          Single Sign-On is available on Enterprise plans only.
        </div>
      )
    }

    if (!canManageSSO) {
      return (
        <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
          Only organization owners and admins can configure Single Sign-On settings.
        </div>
      )
    }
  } else {
    if (!isLoadingProviders && isSSOProviderOwner === false && providers.length > 0) {
      return (
        <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
          Only the user who configured SSO can manage these settings.
        </div>
      )
    }
  }

  const validateProviderId = (value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) out.push('Provider ID is required.')
    if (!/^[-a-z0-9]+$/i.test(value.trim())) out.push('Use letters, numbers, and dashes only.')
    return out
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
      out.push('Enter a valid domain like your-domain.identityprovider.com')
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

    if (data.providerType === 'oidc') {
      newErrors.clientId = validateRequired('Client ID', data.clientId)
      newErrors.clientSecret = validateRequired('Client Secret', data.clientSecret)
      if (!data.scopes || !data.scopes.trim()) {
        newErrors.scopes = ['Scopes are required for OIDC providers']
      }
    } else if (data.providerType === 'saml') {
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

  const isFormValid = () => {
    const requiredFields = ['providerId', 'issuerUrl', 'domain']
    const hasRequiredFields = requiredFields.every((field) => {
      const value = formData[field as keyof typeof formData]
      return typeof value === 'string' && value.trim() !== ''
    })

    if (formData.providerType === 'oidc') {
      return (
        hasRequiredFields &&
        formData.clientId.trim() !== '' &&
        formData.clientSecret.trim() !== '' &&
        formData.scopes.trim() !== ''
      )
    }
    if (formData.providerType === 'saml') {
      return hasRequiredFields && formData.entryPoint.trim() !== '' && formData.cert.trim() !== ''
    }

    return false
  }

  const resetForm = () => {
    setFormData(DEFAULT_FORM_DATA)
    setErrors(DEFAULT_ERRORS)
    setShowErrors(false)
    setShowConfigForm(false)
    setIsEditing(false)
    setEditingProviderId(null)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    setShowErrors(true)
    const validation = validateAll(formData)
    if (hasAnyErrors(validation)) {
      return
    }

    try {
      const requestBody: any = {
        providerId: formData.providerId,
        issuer: formData.issuerUrl,
        domain: formData.domain,
        providerType: formData.providerType,
        orgId: activeOrganization?.id,
        mapping: {
          id: 'sub',
          email: 'email',
          name: 'name',
          image: 'picture',
        },
      }

      if (formData.providerType === 'oidc') {
        requestBody.clientId = formData.clientId
        requestBody.clientSecret = formData.clientSecret
        requestBody.scopes = formData.scopes.split(',').map((s) => s.trim())
      } else if (formData.providerType === 'saml') {
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
      resetForm()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(message)
      logger.error('Failed to configure SSO provider', { error: err })
    }
  }

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => {
      let processedValue: any = value

      if (field === 'wantAssertionsSigned' || field === 'showAdvanced') {
        processedValue = value === 'true'
      }

      const next = { ...prev, [field]: processedValue }

      if (field === 'providerType') {
        setShowErrors(false)
        setErrors(DEFAULT_ERRORS)
      } else {
        validateAll(next)
      }

      return next
    })
  }

  const callbackUrl = `${getBaseUrl()}/api/auth/sso/callback/${formData.providerId}`

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const handleAddNew = () => {
    resetForm()
    setShowConfigForm(true)
    setIsEditing(false)
  }

  const handleReconfigure = (provider: SSOProvider) => {
    try {
      let clientId = ''
      let clientSecret = ''
      let scopes = 'openid,profile,email'

      if (provider.providerType === 'oidc' && provider.oidcConfig) {
        const config = JSON.parse(provider.oidcConfig)
        clientId = config.clientId || ''
        clientSecret = config.clientSecret || ''
        scopes = config.scopes?.join(',') || 'openid,profile,email'
      }

      setFormData({
        providerType: provider.providerType,
        providerId: provider.providerId,
        issuerUrl: provider.issuer,
        domain: provider.domain,
        clientId,
        clientSecret,
        scopes,
        entryPoint: '',
        cert: '',
        callbackUrl: '',
        audience: '',
        wantAssertionsSigned: true,
        idpMetadata: '',
        showAdvanced: false,
      })
      setEditingProviderId(provider.id)
      setIsEditing(true)
      setShowConfigForm(true)
      setError(null)
      setShowErrors(false)
    } catch (err) {
      logger.error('Failed to parse provider config', { error: err })
      setError('Failed to load provider configuration')
    }
  }

  const hasProviders = providers.length > 0
  const showEmptyState = !hasProviders && !showConfigForm
  const showNoResults = searchTerm.trim() && filteredProviders.length === 0 && providers.length > 0

  if (isLoadingProviders) {
    return <SsoSkeleton />
  }

  // Form View (Add/Edit)
  if (showConfigForm) {
    return (
      <>
        <form
          onSubmit={handleSubmit}
          autoComplete='off'
          className='flex h-full flex-col gap-[16px]'
        >
          {/* Hidden dummy inputs to prevent browser password manager autofill */}
          <input
            type='text'
            name='fakeusernameremembered'
            autoComplete='username'
            style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
            tabIndex={-1}
            readOnly
          />
          <input
            type='password'
            name='fakepasswordremembered'
            autoComplete='current-password'
            style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
            tabIndex={-1}
            readOnly
          />
          <input
            type='email'
            name='fakeemailremembered'
            autoComplete='email'
            style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
            tabIndex={-1}
            readOnly
          />
          <input type='text' name='hidden' style={{ display: 'none' }} autoComplete='false' />

          {/* Back Button Header */}
          <div className='mt-[6px] flex items-center gap-[8px]'>
            <button
              type='button'
              onClick={resetForm}
              className='flex items-center gap-[6px] font-medium text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]'
            >
              <ArrowLeft className='h-[14px] w-[14px]' />
              <span>SSO Providers</span>
            </button>
          </div>

          {/* Scrollable Content */}
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-[16px]'>
              {/* Provider Type Selection */}
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  Provider Type
                </span>
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
                <p className='text-[13px] text-[var(--text-muted)]'>
                  {formData.providerType === 'oidc'
                    ? 'OpenID Connect (Okta, Azure AD, Auth0, etc.)'
                    : 'Security Assertion Markup Language (ADFS, Shibboleth, etc.)'}
                </p>
              </div>

              {/* Provider ID */}
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  Provider ID
                </span>
                <Combobox
                  value={formData.providerId}
                  onChange={(value: string) => handleInputChange('providerId', value)}
                  options={TRUSTED_SSO_PROVIDERS.map((id) => ({
                    label: id,
                    value: id,
                  }))}
                  placeholder='Select a provider ID'
                  editable={true}
                  className={cn(
                    'h-9',
                    showErrors &&
                      errors.providerId.length > 0 &&
                      'border-[var(--text-error)] focus:border-[var(--text-error)]'
                  )}
                />
                {showErrors && errors.providerId.length > 0 && (
                  <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                    {errors.providerId.join(' ')}
                  </p>
                )}
              </div>

              {/* Issuer URL */}
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  Issuer URL
                </span>
                <Input
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
                    showErrors &&
                      errors.issuerUrl.length > 0 &&
                      'border-[var(--text-error)] focus:border-[var(--text-error)]'
                  )}
                />
                {showErrors && errors.issuerUrl.length > 0 && (
                  <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                    {errors.issuerUrl.join(' ')}
                  </p>
                )}
              </div>

              {/* Domain */}
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Domain</span>
                <Input
                  type='text'
                  placeholder='your-domain.identityprovider.com'
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
                    showErrors &&
                      errors.domain.length > 0 &&
                      'border-[var(--text-error)] focus:border-[var(--text-error)]'
                  )}
                />
                {showErrors && errors.domain.length > 0 && (
                  <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                    {errors.domain.join(' ')}
                  </p>
                )}
              </div>

              {/* Provider-specific fields */}
              {formData.providerType === 'oidc' ? (
                <>
                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Client ID
                    </span>
                    <Input
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
                        showErrors &&
                          errors.clientId.length > 0 &&
                          'border-[var(--text-error)] focus:border-[var(--text-error)]'
                      )}
                    />
                    {showErrors && errors.clientId.length > 0 && (
                      <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                        {errors.clientId.join(' ')}
                      </p>
                    )}
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Client Secret
                    </span>
                    <div className='relative'>
                      <Input
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
                          'h-9 pr-[36px]',
                          showErrors &&
                            errors.clientSecret.length > 0 &&
                            'border-[var(--text-error)] focus:border-[var(--text-error)]'
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
                          <EyeOff className='h-4 w-4' />
                        ) : (
                          <Eye className='h-4 w-4' />
                        )}
                      </Button>
                    </div>
                    {showErrors && errors.clientSecret.length > 0 && (
                      <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                        {errors.clientSecret.join(' ')}
                      </p>
                    )}
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Scopes
                    </span>
                    <Input
                      type='text'
                      placeholder='openid,profile,email'
                      value={formData.scopes}
                      autoComplete='off'
                      autoCapitalize='none'
                      spellCheck={false}
                      onChange={(e) => handleInputChange('scopes', e.target.value)}
                      className={cn(
                        'h-9',
                        showErrors &&
                          errors.scopes.length > 0 &&
                          'border-[var(--text-error)] focus:border-[var(--text-error)]'
                      )}
                    />
                    {showErrors && errors.scopes.length > 0 && (
                      <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                        {errors.scopes.join(' ')}
                      </p>
                    )}
                    <p className='text-[13px] text-[var(--text-muted)]'>
                      Comma-separated list of OIDC scopes to request
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Entry Point URL
                    </span>
                    <Input
                      type='url'
                      placeholder='https://idp.example.com/sso/saml'
                      value={formData.entryPoint}
                      autoComplete='off'
                      autoCapitalize='none'
                      spellCheck={false}
                      onChange={(e) => handleInputChange('entryPoint', e.target.value)}
                      className={cn(
                        'h-9',
                        showErrors &&
                          errors.entryPoint.length > 0 &&
                          'border-[var(--text-error)] focus:border-[var(--text-error)]'
                      )}
                    />
                    {showErrors && errors.entryPoint.length > 0 && (
                      <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                        {errors.entryPoint.join(' ')}
                      </p>
                    )}
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Identity Provider Certificate
                    </span>
                    <Textarea
                      placeholder='-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----'
                      value={formData.cert}
                      autoComplete='off'
                      autoCapitalize='none'
                      spellCheck={false}
                      onChange={(e) => handleInputChange('cert', e.target.value)}
                      className={cn(
                        'min-h-[80px] font-mono',
                        showErrors &&
                          errors.cert.length > 0 &&
                          'border-[var(--text-error)] focus:border-[var(--text-error)]'
                      )}
                      rows={3}
                    />
                    {showErrors && errors.cert.length > 0 && (
                      <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                        {errors.cert.join(' ')}
                      </p>
                    )}
                  </div>

                  {/* Advanced SAML Options */}
                  <div className='flex flex-col gap-[8px]'>
                    <button
                      type='button'
                      onClick={() =>
                        handleInputChange('showAdvanced', formData.showAdvanced ? 'false' : 'true')
                      }
                      className='flex w-fit items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 transition-transform',
                          formData.showAdvanced && 'rotate-180'
                        )}
                      />
                      Advanced Options
                    </button>

                    {formData.showAdvanced && (
                      <div className='flex flex-col gap-[16px] pt-[8px]'>
                        <div className='flex flex-col gap-[8px]'>
                          <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                            Audience (Entity ID)
                          </span>
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
                        </div>

                        <div className='flex flex-col gap-[8px]'>
                          <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                            Callback URL Override
                          </span>
                          <Input
                            type='url'
                            placeholder='Enter Callback URL'
                            value={formData.callbackUrl}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('callbackUrl', e.target.value)}
                            className='h-9'
                          />
                        </div>

                        <div className='flex flex-col gap-[8px]'>
                          <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                            Require signed SAML assertions
                          </span>
                          <Switch
                            checked={formData.wantAssertionsSigned}
                            onCheckedChange={(checked) =>
                              handleInputChange('wantAssertionsSigned', checked ? 'true' : 'false')
                            }
                          />
                        </div>

                        <div className='flex flex-col gap-[8px]'>
                          <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                            IDP Metadata XML
                          </span>
                          <Textarea
                            placeholder='Paste IDP metadata XML here (optional)'
                            value={formData.idpMetadata}
                            autoComplete='off'
                            autoCapitalize='none'
                            spellCheck={false}
                            onChange={(e) => handleInputChange('idpMetadata', e.target.value)}
                            className='min-h-[60px] font-mono'
                            rows={2}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Callback URL display */}
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  Callback URL
                </span>
                <div className='relative'>
                  <div className='flex h-9 items-center rounded-[6px] border bg-[var(--surface-1)] px-[10px] pr-[40px]'>
                    <code className='flex-1 truncate font-mono text-[13px] text-[var(--text-primary)]'>
                      {callbackUrl}
                    </code>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => copyToClipboard(callbackUrl)}
                    className='-translate-y-1/2 absolute top-1/2 right-[4px] h-[28px] w-[28px] rounded-[4px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  >
                    {copied ? (
                      <Check className='h-[14px] w-[14px]' />
                    ) : (
                      <Copy className='h-[14px] w-[14px]' />
                    )}
                    <span className='sr-only'>Copy callback URL</span>
                  </Button>
                </div>
                <p className='text-[13px] text-[var(--text-muted)]'>
                  Configure this in your identity provider
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className='mt-auto flex items-center justify-end gap-[8px]'>
            {error && <p className='mr-auto text-[12px] text-[var(--text-error)]'>{error}</p>}
            <Button
              type='submit'
              variant='primary'
              disabled={configureSSOMutation.isPending || hasAnyErrors(errors) || !isFormValid()}
              className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
            >
              {configureSSOMutation.isPending
                ? isEditing
                  ? 'Updating...'
                  : 'Adding...'
                : isEditing
                  ? 'Update'
                  : 'Add Provider'}
            </Button>
          </div>
        </form>

        {/* Delete Confirmation Dialog */}
        <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <ModalContent className='w-[400px]'>
            <ModalHeader>Delete SSO Provider</ModalHeader>
            <ModalBody>
              <p className='text-[12px] text-[var(--text-tertiary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>
                  {providerToDelete?.providerId}
                </span>
                ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => {
                  setShowDeleteDialog(false)
                  setProviderToDelete(null)
                }}
              >
                Cancel
              </Button>
              <Button
                variant='primary'
                onClick={() => {
                  setShowDeleteDialog(false)
                  setProviderToDelete(null)
                }}
                className='!bg-[var(--text-error)] !text-white hover:!bg-[var(--text-error)]/90'
              >
                Delete
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </>
    )
  }

  // List View
  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        {/* Search Input and Add Button */}
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border bg-[var(--surface-6)] px-[8px] py-[5px]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <UiInput
              placeholder='Search SSO providers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button
            onClick={handleAddNew}
            variant='primary'
            disabled={isLoadingProviders}
            className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90 disabled:cursor-not-allowed disabled:opacity-60'
          >
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {showEmptyState ? (
            <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
              Click "Add" above to get started
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {/* Provider List */}
              {filteredProviders.map((provider: SSOProvider) => (
                <div key={provider.id} className='flex items-center justify-between gap-[12px]'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <div className='flex items-center gap-[6px]'>
                      <span className='max-w-[280px] truncate font-medium text-[14px]'>
                        {provider.providerId}
                      </span>
                      <span className='text-[13px] text-[var(--text-secondary)]'>
                        ({provider.providerType.toUpperCase()})
                      </span>
                    </div>
                    <p className='truncate text-[13px] text-[var(--text-muted)]'>
                      {provider.domain}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    className='flex-shrink-0'
                    onClick={() => handleReconfigure(provider)}
                  >
                    Edit
                  </Button>
                </div>
              ))}

              {showNoResults && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  No providers found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete SSO Provider</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {providerToDelete?.providerId}
              </span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowDeleteDialog(false)
                setProviderToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={() => {
                setShowDeleteDialog(false)
                setProviderToDelete(null)
              }}
              className='!bg-[var(--text-error)] !text-white hover:!bg-[var(--text-error)]/90'
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

function SsoSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      {/* Search + Add button skeleton */}
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-9 flex-1 rounded-[8px]' />
        <Skeleton className='h-9 w-[70px] rounded-[8px]' />
      </div>

      {/* List skeleton */}
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-[8px]'>
          <SsoProviderSkeleton />
          <SsoProviderSkeleton />
          <SsoProviderSkeleton />
        </div>
      </div>
    </div>
  )
}

function SsoProviderSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <Skeleton className='h-[14px] w-[100px]' />
          <Skeleton className='h-[13px] w-[50px]' />
        </div>
        <Skeleton className='h-[13px] w-[150px]' />
      </div>
      <Skeleton className='h-[26px] w-[40px] rounded-[6px]' />
    </div>
  )
}
