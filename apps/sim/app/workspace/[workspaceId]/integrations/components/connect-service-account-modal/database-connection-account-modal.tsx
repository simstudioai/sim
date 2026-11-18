'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretInput,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import type { DatabaseConnectionDescriptor } from '@/lib/credentials/database-connections/descriptors'
import type { ServiceAccountSecretFields } from '@/lib/credentials/service-account-secret'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'

interface DatabaseConnectionAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  descriptor: DatabaseConnectionDescriptor
  serviceIcon: ComponentType<{ className?: string }>
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onCreated?: (credentialId: string) => void
  onSubmitCredentials?: (
    fields: ServiceAccountSecretFields & { displayName?: string; description?: string }
  ) => Promise<string>
  submitPending?: boolean
}

const MAX_PORT = 65535

interface LoginFields {
  host: string
  port: string
  database: string
  username: string
  password: string
}

/**
 * Saved PostgreSQL, MySQL, and SQL Server connections share the standard
 * credential create/reconnect lifecycle; the server proves each with
 * `SELECT 1` before storing it.
 */
export function DatabaseConnectionAccountModal(props: DatabaseConnectionAccountModalProps) {
  if (!props.open) return null
  return (
    <DatabaseConnectionAccountForm
      key={`${props.descriptor.providerId}:${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function DatabaseConnectionAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  descriptor,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
  onSubmitCredentials,
  submitPending,
}: DatabaseConnectionAccountModalProps) {
  const [login, setLogin] = useState<LoginFields>({
    host: '',
    port: String(descriptor.defaultPort),
    database: '',
    username: '',
    password: '',
  })
  const [tls, setTls] = useState<Record<string, string>>(() =>
    Object.fromEntries(descriptor.tls.map((field) => [field.id, field.defaultValue]))
  )
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()
  const isPending =
    createCredential.isPending || updateCredential.isPending || submitPending === true
  const action = credentialId ? 'Reconnect' : 'Add'
  const title = `${action} ${descriptor.label} connection`
  const port = login.port.trim()
  const portIsValid = /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= MAX_PORT
  const disabled =
    isPending ||
    !login.host.trim() ||
    !portIsValid ||
    !login.database.trim() ||
    !login.username.trim() ||
    !login.password
  const setLoginField = (field: keyof LoginFields, value: string) => {
    setLogin((current) => ({ ...current, [field]: value }))
    setError(null)
  }
  const submit = async () => {
    if (disabled) return
    setError(null)
    const serviceAccountJson = JSON.stringify({
      host: login.host.trim(),
      port: Number(port),
      database: login.database.trim(),
      username: login.username.trim(),
      password: login.password,
      ...tls,
    })
    try {
      let connectedId = credentialId
      if (onSubmitCredentials) {
        connectedId = await onSubmitCredentials({
          serviceAccountJson,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
      } else if (credentialId) {
        await updateCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          credentialId,
          serviceAccountJson,
          displayName: displayName.trim() || undefined,
          description: description.trim() || null,
        })
      } else {
        const created = await createCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          type: 'service_account',
          providerId: descriptor.providerId,
          serviceAccountJson,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        connectedId = created.credential.id
      }
      if (connectedId) onCreated?.(connectedId)
      onOpenChange(false)
    } catch (submitError) {
      setError(
        isApiClientError(submitError) && submitError.code === 'duplicate_display_name'
          ? 'A credential with that name already exists. Choose a different display name.'
          : onSubmitCredentials
            ? getErrorMessage(submitError, `Could not verify the ${descriptor.label} connection.`)
            : `Could not verify the ${descriptor.label} connection. Check the connection details, network access, and database permissions.`
      )
    }
  }
  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Host'
          value={login.host}
          onChange={(value) => setLoginField('host', value)}
          placeholder='db.example.com'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='input'
          title='Port'
          value={login.port}
          onChange={(value) => setLoginField('port', value)}
          placeholder={String(descriptor.defaultPort)}
          required
          autoComplete='off'
          error={
            port !== '' && !portIsValid ? `Enter a whole number from 1 to ${MAX_PORT}.` : undefined
          }
        />
        <ChipModalField
          type='input'
          title='Database'
          value={login.database}
          onChange={(value) => setLoginField('database', value)}
          placeholder='your_database'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='input'
          title='Username'
          value={login.username}
          onChange={(value) => setLoginField('username', value)}
          placeholder={descriptor.usernamePlaceholder}
          required
          autoComplete='off'
        />
        <ChipModalField type='custom' title='Password' required>
          {(aria) => (
            <SecretInput
              {...aria}
              value={login.password}
              onChange={(value) => setLoginField('password', value)}
              placeholder='Enter the database password'
              autoComplete='new-password'
              data-lpignore='true'
            />
          )}
        </ChipModalField>
        {descriptor.tls.map((field) => (
          <ChipModalField
            key={field.id}
            type='dropdown'
            title={field.label}
            value={tls[field.id] ?? field.defaultValue}
            onChange={(value) => {
              setTls((current) => ({ ...current, [field.id]: value }))
              setError(null)
            }}
            options={[...field.options]}
            placeholder={`Choose ${field.label.toLowerCase()}`}
            required
            hint={field.hint}
          />
        ))}
        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to user@host/database'
        />
        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Optional description'
          maxLength={500}
          minHeight={80}
        />
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        secondaryActions={[
          {
            label: 'Setup guide',
            onClick: () => window.open(descriptor.docsUrl, '_blank', 'noopener,noreferrer'),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Verifying...' : `${action} connection`,
          onClick: submit,
          disabled,
        }}
      />
    </ChipModal>
  )
}
