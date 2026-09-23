'use client'

import { useState } from 'react'
import { Chip, ChipInput } from '@sim/emcn'
import type { CredentialGroupApiKeyOption } from '@/lib/api/contracts/credential-groups'
import {
  CREDENTIAL_GROUP_API_KEY_MAX_LENGTH,
  CREDENTIAL_GROUP_API_KEY_MIN_LENGTH,
} from '@/lib/credential-groups/api-key-constants'
import {
  useDeleteCredentialGroupApiKey,
  useSaveCredentialGroupApiKey,
} from '@/hooks/queries/credential-group-api-keys'

interface ApiKeyInputProps {
  token: string
  option: CredentialGroupApiKeyOption & { connected: boolean }
}

export function CredentialGroupApiKeyInput({ token, option }: ApiKeyInputProps) {
  const [value, setValue] = useState('')
  const save = useSaveCredentialGroupApiKey({ token, optionId: option.id })
  const remove = useDeleteCredentialGroupApiKey({ token, optionId: option.id })
  const pending = save.isPending || remove.isPending
  const error = save.error ?? remove.error
  return (
    <form
      className='flex flex-col gap-[9px] py-3'
      onSubmit={(event) => {
        event.preventDefault()
        if (pending) return
        remove.reset()
        save.mutate(
          { value },
          {
            onSuccess: () => {
              setValue('')
              save.reset()
            },
          }
        )
      }}
    >
      <label htmlFor={`api-key-${option.id}`} className='text-[var(--text-muted)] text-small'>
        {option.name}
      </label>
      {option.description && (
        <p className='text-[var(--text-muted)] text-caption'>{option.description}</p>
      )}
      <div className='flex items-center gap-2'>
        <ChipInput
          id={`api-key-${option.id}`}
          type='password'
          autoComplete='new-password'
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
          minLength={CREDENTIAL_GROUP_API_KEY_MIN_LENGTH}
          maxLength={CREDENTIAL_GROUP_API_KEY_MAX_LENGTH}
          placeholder={
            option.connected ? 'Connected · enter a new key to replace' : 'Enter your API key'
          }
          className='min-w-0 flex-1'
          required
        />
        <Chip
          type='submit'
          disabled={pending || value.length < CREDENTIAL_GROUP_API_KEY_MIN_LENGTH}
        >
          {save.isPending ? 'Saving…' : option.connected ? 'Replace' : 'Connect'}
        </Chip>
        {option.connected && (
          <Chip
            type='button'
            disabled={pending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  setValue('')
                  save.reset()
                  remove.reset()
                },
              })
            }
          >
            Disconnect
          </Chip>
        )}
      </div>
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {error.message}
        </p>
      )}
    </form>
  )
}
