'use client'

import { useEffect, useState } from 'react'
import {
  CheckCheck,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Settings as SettingsIcon,
  Shield,
} from 'lucide-react'
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useOrganizationStore } from '@/stores/organization'

const logger = createLogger('SSO')

interface SSOProvider {
  id: string
  providerId: string
  domain: string
  issuer: string
  organizationId: string
  createdAt: string
}

export function SSO() {
  const { data: session } = useSession()
  const { activeOrganization, getUserRole, hasEnterprisePlan } = useOrganizationStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [providers, setProviders] = useState<SSOProvider[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [showConfigForm, setShowConfigForm] = useState(false)

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
  const userRole = getUserRole(userEmail)
  const isOwner = userRole === 'owner'

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/auth/sso/providers')
        if (response.ok) {
          const data = await response.json()
          setProviders(data.providers || [])
        }
      } catch (error) {
        logger.error('Failed to fetch SSO providers', { error })
      } finally {
        setIsLoadingProviders(false)
      }
    }

    if (isOwner && activeOrganization && hasEnterprisePlan) {
      fetchProviders()
    } else {
      setIsLoadingProviders(false)
    }
  }, [isOwner, activeOrganization, hasEnterprisePlan])

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

  if (!isOwner) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <Alert>
          <AlertDescription>
            Only organization owners can configure Single Sign-On settings.
          </AlertDescription>
        </Alert>
      </div>
    )
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
      if (url.protocol !== 'https:') out.push('Issuer URL must use HTTPS.')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    setSuccess(null)

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
        if (formData.callbackUrl) requestBody.callbackUrl = formData.callbackUrl
        if (formData.audience) requestBody.audience = formData.audience
        requestBody.wantAssertionsSigned = formData.wantAssertionsSigned

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
      setSuccess('SSO provider configured successfully!')
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
        showAdvanced: false,
      })

      try {
        const providersResponse = await fetch('/api/auth/sso/providers')
        if (providersResponse.ok) {
          const providersData = await providersResponse.json()
          setProviders(providersData.providers || [])
          setShowConfigForm(false)
        }
      } catch (error) {
        logger.error('Failed to refresh providers list', { error })
      }
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
      validateAll(next)
      return next
    })
  }

  const callbackUrl = `${env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com'}/api/auth/sso/callback/${formData.providerId}`

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  if (isLoadingProviders) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <div>Loading SSO configuration...</div>
      </div>
    )
  }

  const hasProviders = providers.length > 0
  const showStatus = hasProviders && !showConfigForm

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto px-6 pt-3 pb-3'>
        <div className='space-y-4'>
          {error && (
            <Alert variant='destructive' className='rounded-[8px]'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className='rounded-[8px]'>
              <AlertDescription className='text-green-600'>{success}</AlertDescription>
            </Alert>
          )}

          {showStatus ? (
            // SSO Provider Status View
            <div className='space-y-4'>
              {providers.map((provider) => (
                <div key={provider.id} className='rounded-[12px] border border-border p-6'>
                  <div className='flex items-start justify-between'>
                    <div className='flex items-start space-x-3'>
                      <div className='flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/10'>
                        <Shield className='h-5 w-5 text-primary' />
                      </div>
                      <div className='flex-1'>
                        <h3 className='font-medium text-base'>Single Sign-On Provider</h3>
                        <p className='mt-1 text-muted-foreground text-sm'>
                          {provider.providerId} • {provider.domain}
                        </p>
                        <p className='mt-2 text-muted-foreground text-xs'>
                          Configured on {new Date(provider.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className='flex items-center space-x-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setShowConfigForm(true)}
                        className='rounded-[8px]'
                      >
                        <SettingsIcon className='mr-2 h-4 w-4' />
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
                          value={`${env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com'}/api/auth/sso/callback/${provider.providerId}`}
                          className='h-9 w-full cursor-text pr-10 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary/20'
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          type='button'
                          onClick={() => {
                            const url = `${env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com'}/api/auth/sso/callback/${provider.providerId}`
                            navigator.clipboard.writeText(url)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1500)
                          }}
                          aria-label='Copy callback URL'
                          className='-translate-y-1/2 absolute top-1/2 right-3 rounded p-1 text-muted-foreground transition hover:text-foreground'
                        >
                          {copied ? (
                            <CheckCheck className='h-4 w-4 text-green-500' />
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
                    onClick={() => setShowConfigForm(false)}
                    className='rounded-[8px]'
                  >
                    ← Back to SSO Status
                  </Button>
                </div>
              )}
              <form onSubmit={handleSubmit} className='space-y-3'>
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
                  <Input
                    id='provider-id'
                    type='text'
                    placeholder='e.g., your-provider-name'
                    value={formData.providerId}
                    onChange={(e) => handleInputChange('providerId', e.target.value)}
                    className={cn(
                      'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.providerId.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && errors.providerId.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.providerId.join(' ')}</p>
                    </div>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    A unique identifier for your SSO provider
                  </p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='issuer-url'>Issuer URL</Label>
                  <Input
                    id='issuer-url'
                    type='url'
                    placeholder='https://your-domain.identityprovider.com/oauth2/default'
                    value={formData.issuerUrl}
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
                  <p className='text-muted-foreground text-xs'>
                    {formData.providerType === 'oidc'
                      ? 'The OIDC issuer URL from your identity provider'
                      : 'The base URL or entity ID of your SAML identity provider'}
                  </p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='domain'>Domain</Label>
                  <Input
                    id='domain'
                    type='text'
                    placeholder='your-domain.identityprovider.com'
                    value={formData.domain}
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
                  <p className='text-muted-foreground text-xs'>Your identity provider domain</p>
                </div>

                {/* Provider-specific fields */}
                {formData.providerType === 'oidc' ? (
                  <>
                    <div className='space-y-1'>
                      <Label htmlFor='client-id'>Client ID</Label>
                      <Input
                        id='client-id'
                        type='text'
                        placeholder='0oabcdef123456789'
                        value={formData.clientId}
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
                      <p className='text-muted-foreground text-xs'>
                        The application client ID from your identity provider
                      </p>
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='client-secret'>Client Secret</Label>
                      <div className='relative'>
                        <Input
                          id='client-secret'
                          type={showClientSecret ? 'text' : 'password'}
                          placeholder='••••••••••••••••••••••••••••••••'
                          value={formData.clientSecret}
                          onChange={(e) => handleInputChange('clientSecret', e.target.value)}
                          onFocus={() => setShowClientSecret(true)}
                          onBlurCapture={() => setShowClientSecret(false)}
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
                      <p className='text-muted-foreground text-xs'>
                        The application client secret from your identity provider
                      </p>
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='scopes'>Scopes</Label>
                      <Input
                        id='scopes'
                        type='text'
                        placeholder='openid,profile,email'
                        value={formData.scopes}
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
                        placeholder='https://adfs.company.com/adfs/ls/'
                        value={formData.entryPoint}
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
                      <p className='text-muted-foreground text-xs'>
                        The SAML SSO login URL from your identity provider
                      </p>
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='cert'>Identity Provider Certificate</Label>
                      <textarea
                        id='cert'
                        placeholder='-----BEGIN CERTIFICATE-----&#10;MIIDBjCCAe4CAQAwDQYJKoZIhvcNAQEFBQAwEjEQMA...&#10;-----END CERTIFICATE-----'
                        value={formData.cert}
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
                      <p className='text-muted-foreground text-xs'>
                        The X.509 certificate from your SAML identity provider (PEM format)
                      </p>
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
                              placeholder='https://yourapp.com'
                              value={formData.audience}
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
                              placeholder='https://yourapp.com/api/auth/sso/callback/provider-id'
                              value={formData.callbackUrl}
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
                        </>
                      )}
                    </div>
                  </>
                )}

                <Button
                  type='submit'
                  className='w-full rounded-[10px]'
                  disabled={isLoading || hasAnyErrors(errors)}
                >
                  {isLoading ? 'Configuring...' : 'Configure SSO Provider'}
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
                      <CheckCheck className='h-4 w-4 text-green-500' />
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
