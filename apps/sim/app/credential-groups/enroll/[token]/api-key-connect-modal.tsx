'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import {
  type CredentialGroupApiKeyProvider,
  getCredentialGroupApiKeyFields,
  getCredentialGroupApiKeyLocation,
  getCredentialGroupProviderPresentation,
} from '@/lib/credential-groups/providers'
import { useSubmitCredentialGroupApiKey } from '@/hooks/queries/credential-group-enrollment'

interface ApiKeyConnectModalProps {
  token: string
  optionId: string
  /**
   * The provider id rather than its resolved presentation: this renders from a server
   * component, and an icon is a function, which cannot cross that boundary. Everything the
   * modal needs is derived here on the client from this one serializable value.
   */
  provider: CredentialGroupApiKeyProvider
  connected: boolean
}

/**
 * Collects the values one API-key option needs.
 *
 * The row itself offers a plain Connect action so an API-key account reads the same as an
 * OAuth one; the difference — that this service hands you a key instead of a sign-in — belongs
 * inside the modal, next to the link explaining where to find it.
 */
export function ApiKeyConnectModal({
  token,
  optionId,
  provider,
  connected,
}: ApiKeyConnectModalProps) {
  const { name: serviceName, icon: Icon } = getCredentialGroupProviderPresentation(provider)
  const fields = getCredentialGroupApiKeyFields(provider)
  const keyLocation = getCredentialGroupApiKeyLocation(provider)
  const router = useRouter()
  const submit = useSubmitCredentialGroupApiKey(token, optionId)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    if (submit.isPending) return
    setOpen(next)
    if (!next) {
      setValues({})
      setError(null)
    }
  }

  const handleSubmit = async () => {
    const missing = fields.find((field) => !(values[field.id] ?? '').trim())
    if (missing) {
      setError(`${missing.label} is required.`)
      return
    }
    setError(null)
    try {
      await submit.mutateAsync({
        fields: Object.fromEntries(fields.map((field) => [field.id, values[field.id].trim()])),
      })
      handleOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(getErrorMessage(err, 'Those credentials could not be verified. Please try again.'))
    }
  }

  return (
    <>
      <Chip onClick={() => setOpen(true)}>{connected ? 'Reconnect' : 'Connect'}</Chip>
      <ChipModal
        open={open}
        onOpenChange={handleOpenChange}
        dismissDisabled={submit.isPending}
        srTitle={`Connect ${serviceName}`}
        size='md'
      >
        <ChipModalHeader
          icon={Icon}
          onClose={() => handleOpenChange(false)}
          closeDisabled={submit.isPending}
        >
          Connect {serviceName}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='text-pretty px-2 text-[var(--text-muted)] text-small leading-relaxed'>
            {keyLocation.steps}
            {keyLocation.url && (
              <>
                {' '}
                <a
                  href={keyLocation.url}
                  target='_blank'
                  rel='noreferrer'
                  className='underline underline-offset-2 hover:text-[var(--text-body)]'
                >
                  Open {serviceName}
                </a>
              </>
            )}
          </p>
          {fields.map((field) => (
            <ChipModalField
              key={field.id}
              type='input'
              inputType={field.secret ? 'password' : 'text'}
              title={field.label}
              value={values[field.id] ?? ''}
              onChange={(value: string) =>
                setValues((current) => ({ ...current, [field.id]: value }))
              }
              placeholder={field.placeholder}
              autoComplete='off'
              disabled={submit.isPending}
              required
            />
          ))}
          <ChipModalError>{error}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => handleOpenChange(false)}
          cancelDisabled={submit.isPending}
          primaryAction={{
            label: submit.isPending ? 'Checking…' : 'Connect',
            onClick: () => void handleSubmit(),
            disabled: submit.isPending,
          }}
        />
      </ChipModal>
    </>
  )
}
