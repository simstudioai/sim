'use client'

import { ChipModalField, SecretInput } from '@sim/emcn'

interface ClientCredentialsFieldsProps {
  clientId: string
  clientSecret: string
  onClientIdChange: (value: string) => void
  onClientSecretChange: (value: string) => void
  /** Guidance under the client ID field, such as the scopes the credential needs. */
  clientIdHint?: string
  /** Form field name for the secret, distinct per provider so password managers keep them apart. */
  secretInputName: string
}

/**
 * The client ID and secret a credential's client-credentials mode signs in with, shared by every
 * connect form that offers that mode so their labels, autofill behavior, and accessibility match.
 */
export function ClientCredentialsFields({
  clientId,
  clientSecret,
  onClientIdChange,
  onClientSecretChange,
  clientIdHint,
  secretInputName,
}: ClientCredentialsFieldsProps) {
  return (
    <>
      <ChipModalField
        type='input'
        title='Client ID'
        value={clientId}
        onChange={onClientIdChange}
        placeholder='Paste the client ID'
        autoComplete='off'
        required
        hint={clientIdHint}
      />
      <ChipModalField type='custom' title='Client secret' required>
        {(aria) => (
          <SecretInput
            {...aria}
            value={clientSecret}
            onChange={onClientSecretChange}
            placeholder='Paste the client secret'
            name={secretInputName}
            autoComplete='new-password'
            autoCorrect='off'
            autoCapitalize='off'
            data-lpignore='true'
            data-form-type='other'
          />
        )}
      </ChipModalField>
    </>
  )
}
