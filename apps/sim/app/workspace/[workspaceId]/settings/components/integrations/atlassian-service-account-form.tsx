'use client'

import { createElement, useState } from 'react'
import {
  Badge,
  Button,
  Input,
  Label,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Textarea,
  toast,
} from '@/components/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import type { OAuthServiceConfig } from '@/lib/oauth'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

interface AtlassianServiceAccountFormProps {
  service: OAuthServiceConfig | null
  serviceLabel: string
  workspaceId: string
  onBack: () => void
  onCreate: (input: {
    workspaceId: string
    type: 'service_account'
    providerId: typeof ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID
    apiToken: string
    domain: string
    displayName?: string
    description?: string
  }) => Promise<unknown>
  onCreated: () => void
}

const DOMAIN_HINT_REGEX = /^[a-z0-9-]+\.atlassian\.net$/i

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "We couldn't authenticate with that API token. Double-check the token and that the service account has access to this site.",
  site_not_found:
    "We couldn't find an Atlassian site at that domain. Check the spelling — it should look like your-team.atlassian.net.",
  duplicate_display_name: 'A credential with that name already exists in this workspace.',
  atlassian_unavailable:
    "We couldn't reach Atlassian to verify these credentials. Try again in a moment.",
}

const FALLBACK_ERROR_MESSAGE = "We couldn't add this service account. Try again in a moment."

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

function messageForError(err: unknown): string {
  if (isApiClientError(err) && err.code && ERROR_MESSAGES[err.code]) {
    return ERROR_MESSAGES[err.code]
  }
  return FALLBACK_ERROR_MESSAGE
}

export function AtlassianServiceAccountForm({
  service,
  serviceLabel,
  workspaceId,
  onBack,
  onCreate,
  onCreated,
}: AtlassianServiceAccountFormProps) {
  const [apiToken, setApiToken] = useState('')
  const [domain, setDomain] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const trimmedToken = apiToken.trim()
  const normalizedDomain = normalizeDomain(domain)

  const canSubmit = trimmedToken.length > 0 && normalizedDomain.length > 0 && !isSubmitting
  const showDomainHint = normalizedDomain.length > 0 && !DOMAIN_HINT_REGEX.test(normalizedDomain)

  const handleSubmit = async () => {
    setError(null)
    if (!trimmedToken || !normalizedDomain) return

    setIsSubmitting(true)
    try {
      await onCreate({
        workspaceId,
        type: 'service_account',
        providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
        apiToken: trimmedToken,
        domain: normalizedDomain,
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
      })
      toast.success('Service account connected')
      onCreated()
    } catch (err) {
      setError(messageForError(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <ModalHeader>
        <div className='flex items-center gap-2.5'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setError(null)
              onBack()
            }}
            className='size-6 rounded-[4px] p-0 text-[var(--text-muted)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
            aria-label='Back'
          >
            ←
          </Button>
          <span>Add {serviceLabel}</span>
        </div>
      </ModalHeader>
      <ModalBody>
        {error && (
          <div className='mb-3'>
            <Badge variant='red' size='lg' dot className='max-w-full'>
              {error}
            </Badge>
          </div>
        )}
        <div className='flex flex-col gap-4'>
          <div className='flex items-center gap-3'>
            <div className='flex size-[40px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-5)]'>
              {service && createElement(service.icon, { className: 'h-[18px] w-[18px]' })}
            </div>
            <div>
              <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                Add {service?.name || 'Atlassian service account'}
              </p>
              <p className='text-[12px] text-[var(--text-tertiary)]'>
                {service?.description ||
                  'Use a scoped API token from a service account in admin.atlassian.com.'}
              </p>
              <a
                href='https://docs.sim.ai/integrations/atlassian-service-account'
                target='_blank'
                rel='noopener noreferrer'
                className='text-[12px] text-[var(--accent)] hover:underline'
              >
                View setup guide
              </a>
            </div>
          </div>

          <div>
            <Label>
              API token<span className='ml-1'>*</span>
            </Label>
            <Input
              type='password'
              value={apiToken}
              onChange={(event) => {
                setApiToken(event.target.value)
                setError(null)
              }}
              placeholder='Paste API token'
              autoComplete='off'
              data-lpignore='true'
              className='mt-1.5'
            />
            <p className='mt-1 text-[11px] text-[var(--text-muted)]'>
              Issued from the service account's profile in admin.atlassian.com. Stored encrypted.
            </p>
          </div>

          <div>
            <Label>
              Site domain<span className='ml-1'>*</span>
            </Label>
            <Input
              value={domain}
              onChange={(event) => {
                setDomain(event.target.value)
                setError(null)
              }}
              placeholder='your-team.atlassian.net'
              autoComplete='off'
              data-lpignore='true'
              className='mt-1.5'
            />
            {showDomainHint && (
              <p className='mt-1 text-[11px] text-[var(--text-tertiary)]'>
                Atlassian sites usually look like <code>your-team.atlassian.net</code>. We'll strip
                any leading <code>https://</code>.
              </p>
            )}
          </div>

          <div>
            <Label>Display name</Label>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Defaults to the account's Atlassian display name"
              autoComplete='off'
              data-lpignore='true'
              className='mt-1.5'
            />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder='Optional description'
              maxLength={500}
              autoComplete='off'
              data-lpignore='true'
              className='mt-1.5 min-h-[80px] resize-none'
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          variant='default'
          onClick={() => {
            setError(null)
            onBack()
          }}
        >
          Back
        </Button>
        <Button variant='primary' onClick={handleSubmit} disabled={!canSubmit}>
          {isSubmitting ? 'Adding...' : 'Add Service Account'}
        </Button>
      </ModalFooter>
    </>
  )
}
