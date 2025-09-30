'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-react'
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { env } from '@/lib/env'
import { isBillingEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useOrganizationStore } from '@/stores/organization'

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

export function SSO() {
  const { data: session } = useSession()
  const { activeOrganization, getUserRole, hasEnterprisePlan } = useOrganizationStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [providers, setProviders] = useState<SSOProvider[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const [formData, setFormData] = useState({
    providerType: 'oidc' as 'oidc' | 'saml',
    providerId: '',
    issuerUrl: '',
    domain: '',
    // OIDC fields
    clientId: '',
    clientSecret: '',
    scopes: 'openid,profile,email',
    // SAML fields
    entryPoint: '',
    cert: '',
    callbackUrl: '',
    audience: '',
    wantAssertionsSigned: true,
    idpMetadata: '', // Optional IDP metadata XML
    // Advanced options
    showAdvanced: false,
  })

  const [errors, setErrors] = useState<Record<string, string[]>>({
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
  })
  const [showErrors, setShowErrors] = useState(false)

  const userEmail = session?.user?.email
  const userId = session?.user?.id
  const userRole = getUserRole(userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const canManageSSO = isOwner || isAdmin

  const [isSSOProviderOwner, setIsSSOProviderOwner] = useState<boolean | null>(null)

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/auth/sso/providers')
        if (!response.ok) {
          throw new Error(`Failed to fetch providers: ${response.statusText}`)
        }

        const data = await response.json()
        setProviders(data.providers || [])

        if (!isBillingEnabled && userId) {
          const ownsProvider = data.providers.some((p: any) => p.userId === userId)
          setIsSSOProviderOwner(ownsProvider)
        } else {
          setIsSSOProviderOwner(null)
        }
      } catch (error) {
        logger.error('Failed to fetch SSO providers', { error })
        setProviders([])
        setIsSSOProviderOwner(false)
      } finally {
        setIsLoadingProviders(false)
      }
    }

    const shouldFetch = !isBillingEnabled
      ? true
      : canManageSSO && activeOrganization && hasEnterprisePlan

    if (shouldFetch) {
      fetchProviders()
    } else {
      setIsLoadingProviders(false)
    }
  }, [canManageSSO, activeOrganization, hasEnterprisePlan, userId, isBillingEnabled])

  if (isBillingEnabled) {
    if (!activeOrganization) {
      return (
        <div className='flex h-full items-center justify-center p-6'>
          <Alert>
            <AlertDescription>
              You must be part of an organization to configure Single Sign-On.
            </AlertDescription>
          </Alert>
        </div>
      )
    }

    if (!hasEnterprisePlan) {
      return (
        <div className='flex h-full items-center justify-center p-6'>
          <Alert>
            <AlertDescription>
              Single Sign-On is available on Enterprise plans only.
              <br />
              Contact your admin to upgrade your plan.
            </AlertDescription>
          </Alert>
        </div>
      )
    }

    if (!canManageSSO) {
      return (
        <div className='flex h-full items-center justify-center p-6'>
          <Alert>
            <AlertDescription>
              Only organization owners and admins can configure Single Sign-On settings.
            </AlertDescription>
          </Alert>
        </div>
      )
    }
  } else {
    if (!isLoadingProviders && isSSOProviderOwner === false && providers.length > 0) {
      return (
        <div className='flex h-full items-center justify-center p-6'>
          <Alert>
            <AlertDescription>
              Only the user who configured SSO can manage these settings.
            </AlertDescription>
          </Alert>
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    setShowErrors(true)
    const validation = validateAll(formData)
    if (hasAnyErrors(validation)) {
      setIsLoading(false)
      return
    }

    try {
      const requestBody: any = {
        providerId: formData.providerId,
        issuer: formData.issuerUrl,
        domain: formData.domain,
        providerType: formData.providerType,
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

      const response = await fetch('/api/auth/sso/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.details || 'Failed to configure SSO provider')
      }

      const result = await response.json()
      logger.info('SSO provider configured', { providerId: result.providerId })

      setFormData({
        providerType: 'oidc',
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
      })

      const providersResponse = await fetch('/api/auth/sso/providers')
      if (providersResponse.ok) {
        const providersData = await providersResponse.json()
        setProviders(providersData.providers || [])

        if (!isBillingEnabled && userId) {
          const ownsProvider = providersData.providers.some((p: any) => p.userId === userId)
          setIsSSOProviderOwner(ownsProvider)
        }
      }

      setShowConfigForm(false)
      setIsEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(message)
      logger.error('Failed to configure SSO provider', { error: err })
    } finally {
      setIsLoading(false)
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
        setErrors({
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
        })
      } else {
        validateAll(next)
      }

      return next
    })
  }

  const callbackUrl = `${env.NEXT_PUBLIC_APP_URL}/api/auth/sso/callback/${formData.providerId}`

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const handleReconfigure = (provider: SSOProvider) => {
    try {
      // Parse config based on provider type
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
      setIsEditing(true)
      setShowConfigForm(true)
    } catch (error) {
      logger.error('Failed to parse provider config', { error })
      setError('Failed to load provider configuration')
    }
  }

  if (isLoadingProviders) {
    return <SsoSkeleton />
  }

  const hasProviders = providers.length > 0
  const showStatus = hasProviders && !showConfigForm

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto px-6 pt-4 pb-4'>
        <div className='space-y-6'>
          {error && (
            <Alert variant='destructive' className='rounded-[8px]'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {showStatus ? (
            // SSO Provider Status View
            <div className='space-y-4'>
              {providers.map((provider) => (
                <div key={provider.id} className='rounded-[12px] border border-border p-6'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='flex-1'>
                      <h3 className='font-medium text-base'>Single Sign-On Provider</h3>
                      <p className='mt-1 text-muted-foreground text-sm'>
                        {provider.providerId} • {provider.domain}
                      </p>
                    </div>
                    <div className='flex items-center space-x-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => handleReconfigure(provider)}
                        className='rounded-[8px]'
                      >
                        Reconfigure
                      </Button>
                    </div>
                  </div>

                  <div className='mt-4 border-border border-t pt-4'>
                    <div className='grid grid-cols-2 gap-4 text-sm'>
                      <div>
                        <span className='font-medium text-muted-foreground'>Issuer URL</span>
                        <p className='mt-1 break-all font-mono text-foreground text-xs'>
                          {provider.issuer}
                        </p>
                      </div>
                      <div>
                        <span className='font-medium text-muted-foreground'>Provider ID</span>
                        <p className='mt-1 text-foreground'>{provider.providerId}</p>
                      </div>
                    </div>

                    <div className='mt-4'>
                      <span className='font-medium text-muted-foreground text-sm'>
                        Callback URL
                      </span>
                      <div className='relative mt-2'>
                        <Input
                          readOnly
                          value={`${env.NEXT_PUBLIC_APP_URL}/api/auth/sso/callback/${provider.providerId}`}
                          className='h-9 w-full cursor-text pr-10 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary/20'
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          type='button'
                          onClick={() => {
                            const url = `${env.NEXT_PUBLIC_APP_URL}/api/auth/sso/callback/${provider.providerId}`
                            navigator.clipboard.writeText(url)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1500)
                          }}
                          aria-label='Copy callback URL'
                          className='-translate-y-1/2 absolute top-1/2 right-3 rounded p-1 text-muted-foreground transition hover:text-foreground'
                        >
                          {copied ? (
                            <Check className='h-4 w-4 text-green-500' />
                          ) : (
                            <Copy className='h-4 w-4' />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // SSO Configuration Form
            <>
              {hasProviders && (
                <div className='mb-4'>
                  <Button
                    variant='outline'
                    onClick={() => {
                      setShowConfigForm(false)
                      setIsEditing(false)
                    }}
                    className='rounded-[8px]'
                  >
                    ← Back to SSO Status
                  </Button>
                </div>
              )}
              <form onSubmit={handleSubmit} className='space-y-3' autoComplete='off'>
                {/* Hidden dummy input to prevent autofill */}
                <input type='text' name='hidden' style={{ display: 'none' }} autoComplete='false' />
                {/* Provider Type Selection */}
                <div className='space-y-1'>
                  <Label>Provider Type</Label>
                  <div className='flex rounded-[10px] border border-input bg-background p-1'>
                    <button
                      type='button'
                      className={cn(
                        'flex-1 rounded-[6px] px-3 py-2 font-medium text-sm transition-colors',
                        formData.providerType === 'oidc'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => handleInputChange('providerType', 'oidc')}
                    >
                      OIDC
                    </button>
                    <button
                      type='button'
                      className={cn(
                        'flex-1 rounded-[6px] px-3 py-2 font-medium text-sm transition-colors',
                        formData.providerType === 'saml'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => handleInputChange('providerType', 'saml')}
                    >
                      SAML
                    </button>
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {formData.providerType === 'oidc'
                      ? 'OpenID Connect (Okta, Azure AD, Auth0, etc.)'
                      : 'Security Assertion Markup Language (ADFS, Shibboleth, etc.)'}
                  </p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='provider-id'>Provider ID</Label>
                  <select
                    id='provider-id'
                    value={formData.providerId}
                    onChange={(e) => handleInputChange('providerId', e.target.value)}
                    className={cn(
                      'w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.providerId.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  >
                    <option value=''>Select a provider ID</option>
                    {TRUSTED_SSO_PROVIDERS.map((providerId) => (
                      <option key={providerId} value={providerId}>
                        {providerId}
                      </option>
                    ))}
                  </select>
                  {showErrors && errors.providerId.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.providerId.join(' ')}</p>
                    </div>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    Select a pre-configured provider ID from the trusted providers list
                  </p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='issuer-url'>Issuer URL</Label>
                  <Input
                    id='issuer-url'
                    type='url'
                    placeholder='Enter Issuer URL'
                    value={formData.issuerUrl}
                    name='sso_issuer_endpoint'
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    readOnly
                    onFocus={(e) => e.target.removeAttribute('readOnly')}
                    onChange={(e) => handleInputChange('issuerUrl', e.target.value)}
                    className={cn(
                      'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.issuerUrl.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && errors.issuerUrl.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.issuerUrl.join(' ')}</p>
                    </div>
                  )}
                  <p className='text-muted-foreground text-xs' />
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='domain'>Domain</Label>
                  <Input
                    id='domain'
                    type='text'
                    placeholder='Enter Domain'
                    value={formData.domain}
                    name='sso_identity_domain'
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    readOnly
                    onFocus={(e) => e.target.removeAttribute('readOnly')}
                    onChange={(e) => handleInputChange('domain', e.target.value)}
                    className={cn(
                      'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.domain.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && errors.domain.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.domain.join(' ')}</p>
                    </div>
                  )}
                </div>

                {/* Provider-specific fields */}
                {formData.providerType === 'oidc' ? (
                  <>
                    <div className='space-y-1'>
                      <Label htmlFor='client-id'>Client ID</Label>
                      <Input
                        id='client-id'
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
                          'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.clientId.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                      />
                      {showErrors && errors.clientId.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.clientId.join(' ')}</p>
                        </div>
                      )}
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='client-secret'>Client Secret</Label>
                      <div className='relative'>
                        <Input
                          id='client-secret'
                          type={showClientSecret ? 'text' : 'password'}
                          placeholder='Enter Client Secret'
                          value={formData.clientSecret}
                          name='sso_client_key'
                          autoComplete='new-password'
                          autoCapitalize='none'
                          spellCheck={false}
                          readOnly
                          onFocus={(e) => {
                            e.target.removeAttribute('readOnly')
                            setShowClientSecret(true)
                          }}
                          onBlurCapture={() => setShowClientSecret(false)}
                          onChange={(e) => handleInputChange('clientSecret', e.target.value)}
                          className={cn(
                            'rounded-[10px] pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                            showErrors &&
                              errors.clientSecret.length > 0 &&
                              'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                          )}
                        />
                        <button
                          type='button'
                          onClick={() => setShowClientSecret((s) => !s)}
                          className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
                          aria-label={
                            showClientSecret ? 'Hide client secret' : 'Show client secret'
                          }
                        >
                          {showClientSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {showErrors && errors.clientSecret.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.clientSecret.join(' ')}</p>
                        </div>
                      )}
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='scopes'>Scopes</Label>
                      <Input
                        id='scopes'
                        type='text'
                        placeholder='openid,profile,email'
                        value={formData.scopes}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        onChange={(e) => handleInputChange('scopes', e.target.value)}
                        className={cn(
                          'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.scopes.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                      />
                      {showErrors && errors.scopes.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.scopes.join(' ')}</p>
                        </div>
                      )}
                      <p className='text-muted-foreground text-xs'>
                        Comma-separated list of OIDC scopes to request
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className='space-y-1'>
                      <Label htmlFor='entry-point'>Entry Point URL</Label>
                      <Input
                        id='entry-point'
                        type='url'
                        placeholder='Enter Entry Point URL'
                        value={formData.entryPoint}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        onChange={(e) => handleInputChange('entryPoint', e.target.value)}
                        className={cn(
                          'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.entryPoint.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                      />
                      {showErrors && errors.entryPoint.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.entryPoint.join(' ')}</p>
                        </div>
                      )}
                      <p className='text-muted-foreground text-xs' />
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='cert'>Identity Provider Certificate</Label>
                      <textarea
                        id='cert'
                        placeholder='-----BEGIN CERTIFICATE-----&#10;MIIDBjCCAe4CAQAwDQYJKoZIhvcNAQEFBQAwEjEQMA...&#10;-----END CERTIFICATE-----'
                        value={formData.cert}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        onChange={(e) => handleInputChange('cert', e.target.value)}
                        className={cn(
                          'min-h-[100px] w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.cert.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                        rows={4}
                      />
                      {showErrors && errors.cert.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.cert.join(' ')}</p>
                        </div>
                      )}
                      <p className='text-muted-foreground text-xs' />
                    </div>

                    {/* Advanced SAML Options */}
                    <div className='space-y-3'>
                      <button
                        type='button'
                        onClick={() =>
                          handleInputChange(
                            'showAdvanced',
                            formData.showAdvanced ? 'false' : 'true'
                          )
                        }
                        className='flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground'
                      >
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 transition-transform',
                            formData.showAdvanced && 'rotate-180'
                          )}
                        />
                        Advanced SAML Options
                      </button>

                      {formData.showAdvanced && (
                        <>
                          <div className='space-y-1'>
                            <Label htmlFor='audience'>Audience (Entity ID)</Label>
                            <Input
                              id='audience'
                              type='text'
                              placeholder='Enter Audience'
                              value={formData.audience}
                              autoComplete='off'
                              autoCapitalize='none'
                              spellCheck={false}
                              onChange={(e) => handleInputChange('audience', e.target.value)}
                              className='rounded-[10px] shadow-sm'
                            />
                            <p className='text-muted-foreground text-xs'>
                              The SAML audience restriction (optional, defaults to app URL)
                            </p>
                          </div>

                          <div className='space-y-1'>
                            <Label htmlFor='callback-url'>Callback URL Override</Label>
                            <Input
                              id='callback-url'
                              type='url'
                              placeholder='Enter Callback URL'
                              value={formData.callbackUrl}
                              autoComplete='off'
                              autoCapitalize='none'
                              spellCheck={false}
                              onChange={(e) => handleInputChange('callbackUrl', e.target.value)}
                              className='rounded-[10px] shadow-sm'
                            />
                            <p className='text-muted-foreground text-xs'>
                              Custom SAML callback URL (optional, auto-generated if empty)
                            </p>
                          </div>

                          <div className='flex items-center space-x-2'>
                            <input
                              type='checkbox'
                              id='want-assertions-signed'
                              checked={formData.wantAssertionsSigned}
                              onChange={(e) =>
                                handleInputChange(
                                  'wantAssertionsSigned',
                                  e.target.checked ? 'true' : 'false'
                                )
                              }
                              className='rounded'
                            />
                            <Label htmlFor='want-assertions-signed' className='text-sm'>
                              Require signed SAML assertions
                            </Label>
                          </div>

                          <div className='space-y-1'>
                            <Label htmlFor='idp-metadata'>Identity Provider Metadata XML</Label>
                            <textarea
                              id='idp-metadata'
                              placeholder='<?xml version="1.0" encoding="UTF-8"?>&#10;<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata">&#10;  ...&#10;</md:EntityDescriptor>'
                              value={formData.idpMetadata}
                              autoComplete='off'
                              autoCapitalize='none'
                              spellCheck={false}
                              onChange={(e) => handleInputChange('idpMetadata', e.target.value)}
                              className='min-h-[100px] w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
                              rows={4}
                            />
                            <p className='text-muted-foreground text-xs'>
                              Paste the complete IDP metadata XML from your identity provider for
                              advanced configuration
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}

                <Button
                  type='submit'
                  className='w-full rounded-[10px]'
                  disabled={isLoading || hasAnyErrors(errors) || !isFormValid()}
                >
                  {isLoading
                    ? isEditing
                      ? 'Updating...'
                      : 'Configuring...'
                    : isEditing
                      ? 'Update SSO Provider'
                      : 'Configure SSO Provider'}
                </Button>
              </form>

              <div className='space-y-1'>
                <Label htmlFor='callback-url'>Callback URL</Label>
                <p className='text-muted-foreground text-xs'>
                  Configure this URL in your identity provider as the callback/redirect URI
                </p>
                <div className='relative'>
                  <Input
                    id='callback-url'
                    readOnly
                    value={callbackUrl}
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    className='h-9 w-full cursor-text pr-10 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary/20'
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type='button'
                    onClick={copyCallback}
                    aria-label='Copy callback URL'
                    className='-translate-y-1/2 absolute top-1/2 right-3 rounded p-1 text-muted-foreground transition hover:text-foreground'
                  >
                    {copied ? (
                      <Check className='h-4 w-4 text-green-500' />
                    ) : (
                      <Copy className='h-4 w-4' />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SsoSkeleton() {
  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto px-6 pt-4 pb-4'>
        <div className='space-y-4'>
          {/* Provider type toggle */}
          <div className='space-y-1'>
            <Skeleton className='h-4 w-28' />
            <div className='flex items-center gap-2'>
              <Skeleton className='h-9 w-20 rounded-[8px]' />
              <Skeleton className='h-9 w-20 rounded-[8px]' />
            </div>
            <Skeleton className='h-3 w-56' />
          </div>

          {/* Core fields */}
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-9 w-full rounded-[10px]' />
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-9 w-full rounded-[10px]' />
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-9 w-full rounded-[10px]' />
            </div>
          </div>

          {/* OIDC section (client id/secret/scopes) */}
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-9 w-full rounded-[10px]' />
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-24' />
              <div className='relative'>
                <Skeleton className='h-9 w-full rounded-[10px]' />
                <Skeleton className='-translate-y-1/2 absolute top-1/2 right-3 h-4 w-4 rounded' />
              </div>
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-9 w-full rounded-[10px]' />
            </div>
          </div>

          {/* Submit button */}
          <Skeleton className='h-9 w-full rounded-[10px]' />

          {/* Callback URL */}
          <div className='space-y-1'>
            <Skeleton className='h-4 w-20' />
            <div className='relative'>
              <Skeleton className='h-9 w-full rounded-[10px]' />
              <Skeleton className='-translate-y-1/2 absolute top-1/2 right-3 h-4 w-4 rounded' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
