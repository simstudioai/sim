import { SecretField, TextAreaField, TextField } from '@/platform/design-system/components'
import type { ManualSecretType } from '@/platform/lib/integrations/manual-secret'

interface ManualSecretFieldsProps {
  type: ManualSecretType
  replacing?: boolean
}

export function ManualSecretFields({ type, replacing = false }: ManualSecretFieldsProps) {
  if (type === 'basic-auth')
    return (
      <>
        <TextField
          label='Username'
          name='username'
          placeholder='Enter the username'
          required
          autoComplete='off'
        />
        <SecretField
          label='Password'
          name='value'
          placeholder='Enter the password'
          required
          autoComplete='new-password'
        />
      </>
    )
  if (type === 'private-key' || type === 'service-account')
    return (
      <TextAreaField
        label={type === 'private-key' ? 'Private key' : 'JSON key'}
        name='value'
        placeholder={
          type === 'private-key' ? 'Paste the PEM private key' : 'Paste the service account JSON'
        }
        defaultSize='expanded'
        required
        autoComplete='off'
        spellCheck={false}
      />
    )
  return (
    <SecretField
      label={replacing ? 'Replace value' : 'Value'}
      name='value'
      placeholder={`Paste the ${type.replaceAll('-', ' ')}`}
      required
      autoComplete='new-password'
    />
  )
}
