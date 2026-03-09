'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import {
  FormErrorState,
  FormField,
  FormLoadingState,
  PasswordAuth,
  PoweredBySim,
  ThankYouScreen,
} from '@/app/form/[identifier]/components'

const logger = createLogger('Form')

interface FieldConfig {
  name: string
  type: string
  label: string
  description?: string
  required?: boolean
}

interface FormConfig {
  id: string
  title: string
  description?: string
  customizations: {
    primaryColor?: string
    thankYouMessage?: string
    logoUrl?: string
    fieldConfigs?: FieldConfig[]
  }
  authType?: 'public' | 'password' | 'email'
  showBranding?: boolean
  inputSchema?: InputField[]
}

interface InputField {
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
  description?: string
  value?: unknown
  required?: boolean
}

export default function Form({ identifier }: { identifier: string }) {
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState<'password' | 'email' | null>(null)
  const [thankYouData, setThankYouData] = useState<{
    title: string
    message: string
  } | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchFormConfig = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(`/api/form/${identifier}`, { signal })
        if (signal?.aborted) return

        const data = await response.json()

        if (!response.ok) {
          if (response.status === 401) {
            const authError = data.error
            if (authError === 'auth_required_password') {
              setAuthRequired('password')
              setFormConfig({
                id: '',
                title: data.title || 'Form',
                customizations: data.customizations || {},
              })
              return
            }
            if (authError === 'auth_required_email') {
              setAuthRequired('email')
              setFormConfig({
                id: '',
                title: data.title || 'Form',
                customizations: data.customizations || {},
              })
              return
            }
          }
          throw new Error(data.error || 'Failed to load form')
        }

        setFormConfig(data)
        setAuthRequired(null)

        // Initialize form data from input schema
        const fields = data.inputSchema || []
        if (fields.length > 0) {
          const initialData: Record<string, unknown> = {}
          for (const field of fields) {
            if (field.value !== undefined) {
              initialData[field.name] = field.value
            } else {
              switch (field.type) {
                case 'boolean':
                  initialData[field.name] = false
                  break
                case 'number':
                  initialData[field.name] = ''
                  break
                case 'array':
                case 'files':
                  initialData[field.name] = []
                  break
                case 'object':
                  initialData[field.name] = {}
                  break
                default:
                  initialData[field.name] = ''
              }
            }
          }
          setFormData(initialData)
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        logger.error('Error fetching form config:', err)
        setError(err instanceof Error ? err.message : 'Failed to load form')
      } finally {
        setIsLoading(false)
      }
    },
    [identifier]
  )

  useEffect(() => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    fetchFormConfig(controller.signal)
    return () => controller.abort()
  }, [fetchFormConfig])

  const handleFieldChange = useCallback((fieldName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }))
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!formConfig) return

      try {
        setIsSubmitting(true)
        setError(null)

        const response = await fetch(`/api/form/${identifier}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formData }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to submit form')
        }

        setThankYouData({
          title: data.thankYouTitle || 'Thank you!',
          message:
            data.thankYouMessage ||
            formConfig.customizations.thankYouMessage ||
            'Your response has been submitted successfully.',
        })
        setIsSubmitted(true)
      } catch (err: unknown) {
        logger.error('Error submitting form:', err)
        setError(err instanceof Error ? err.message : 'Failed to submit form')
      } finally {
        setIsSubmitting(false)
      }
    },
    [identifier, formConfig, formData]
  )

  const handlePasswordAuth = useCallback(
    async (password: string) => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(`/api/form/${identifier}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Invalid password')
        }

        await fetchFormConfig()
      } catch (err: unknown) {
        logger.error('Error authenticating:', err)
        setError(err instanceof Error ? err.message : 'Invalid password')
        setIsLoading(false)
      }
    },
    [identifier, fetchFormConfig]
  )

  const primaryColor = formConfig?.customizations?.primaryColor || 'var(--brand-primary-hex)'

  if (isLoading && !authRequired) {
    return <FormLoadingState />
  }

  if (error && !authRequired) {
    return <FormErrorState error={error} />
  }

  if (authRequired === 'password') {
    return <PasswordAuth onSubmit={handlePasswordAuth} error={error} />
  }

  if (isSubmitted && thankYouData) {
    return (
      <AuthBackground>
        <main className='relative flex min-h-screen flex-col text-foreground'>
          <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
            <ThankYouScreen
              title={thankYouData.title}
              message={thankYouData.message}
              primaryColor={formConfig?.customizations?.primaryColor}
            />
          </div>
          {formConfig?.showBranding !== false ? (
            <PoweredBySim />
          ) : (
            <SupportFooter position='absolute' />
          )}
        </main>
      </AuthBackground>
    )
  }

  if (!formConfig) {
    return <FormErrorState error='Form not found' />
  }

  // Get fields from input schema
  const fields = formConfig.inputSchema || []

  // Create a map of field configs for quick lookup
  const fieldConfigMap = new Map(
    (formConfig.customizations?.fieldConfigs || []).map((fc) => [fc.name, fc])
  )

  return (
    <AuthBackground>
      <main className='relative flex min-h-screen flex-col text-foreground'>
        <div className='relative z-30 flex flex-1 justify-center px-4 pt-16 pb-24'>
          <div className='w-full max-w-[410px]'>
            {/* Form title */}
            <div className='mb-8 text-center'>
              <h1
                className={`${soehne.className} font-medium text-[28px] text-foreground tracking-tight`}
              >
                {formConfig.title}
              </h1>
              {formConfig.description && (
                <p
                  className={`${inter.className} mt-2 font-[380] text-[15px] text-muted-foreground`}
                >
                  {formConfig.description}
                </p>
              )}
            </div>

            <form onSubmit={handleSubmit} className={`${inter.className} space-y-6`}>
              {fields.length === 0 ? (
                <div className='rounded-[10px] border border-border bg-muted/50 p-6 text-center text-muted-foreground'>
                  This form has no fields configured.
                </div>
              ) : (
                fields.map((field) => {
                  const config = fieldConfigMap.get(field.name)
                  return (
                    <FormField
                      key={field.name}
                      field={field}
                      value={formData[field.name]}
                      onChange={(value) => handleFieldChange(field.name, value)}
                      primaryColor={primaryColor}
                      label={config?.label}
                      description={config?.description}
                      required={config?.required}
                    />
                  )
                })
              )}

              {error && (
                <div className='rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-4)] p-3 text-red-500 text-sm'>
                  {error}
                </div>
              )}

              {fields.length > 0 && (
                <BrandedButton
                  type='submit'
                  loading={isSubmitting}
                  loadingText='Submitting...'
                  fullWidth
                >
                  Submit
                </BrandedButton>
              )}
            </form>
          </div>
        </div>
        {formConfig.showBranding !== false ? (
          <PoweredBySim />
        ) : (
          <SupportFooter position='absolute' />
        )}
      </main>
    </AuthBackground>
  )
}
