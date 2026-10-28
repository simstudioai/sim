'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  SecretInput,
} from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'

interface OracleDatabaseAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceIcon: ComponentType<{ className?: string }>
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onCreated?: (credentialId: string) => void
}

interface ConnectionFields {
  host: string
  port: string
  protocol: string
  connectionType: string
  serviceName: string
  sid: string
  username: string
  password: string
  walletContent: string
  walletPassword: string
}

/** Saved Oracle Net connections share the standard credential create/reconnect lifecycle. */
export function OracleDatabaseAccountModal(props: OracleDatabaseAccountModalProps) {
  if (!props.open) return null
  return (
    <OracleDatabaseAccountForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function OracleDatabaseAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: OracleDatabaseAccountModalProps) {
  const [values, setValues] = useState<ConnectionFields>({
    host: '',
    port: '1521',
    protocol: 'tcps',
    connectionType: 'serviceName',
    serviceName: '',
    sid: '',
    username: '',
    password: '',
    walletContent: '',
    walletPassword: '',
  })
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()
  const isPending = createCredential.isPending || updateCredential.isPending
  const action = credentialId ? 'Reconnect' : 'Add'
  const identifier = values.connectionType === 'sid' ? values.sid : values.serviceName
  const disabled =
    isPending ||
    !values.host.trim() ||
    !values.port.trim() ||
    !identifier.trim() ||
    !values.username.trim() ||
    !values.password
  const setField = (field: keyof ConnectionFields, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setError(null)
  }
  const submit = async () => {
    if (disabled) return
    setError(null)
    const connection = {
      host: values.host.trim(),
      port: Number(values.port),
      protocol: values.protocol,
      connectionType: values.connectionType,
      ...(values.connectionType === 'sid'
        ? { sid: values.sid.trim() }
        : { serviceName: values.serviceName.trim() }),
      username: values.username.trim(),
      password: values.password,
      ...(values.protocol === 'tcps' && values.walletContent
        ? {
            walletContent: values.walletContent,
            ...(values.walletPassword ? { walletPassword: values.walletPassword } : {}),
          }
        : {}),
    }
    const input = {
      ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
      serviceAccountJson: JSON.stringify(connection),
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
    }
    try {
      let connectedId = credentialId
      if (credentialId)
        await updateCredential.mutateAsync({
          ...input,
          credentialId,
          description: description.trim() || null,
        })
      else {
        const created = await createCredential.mutateAsync({
          ...input,
          type: 'service_account',
          providerId: ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
        })
        connectedId = created.credential.id
      }
      if (connectedId) onCreated?.(connectedId)
      onOpenChange(false)
    } catch (error) {
      setError(
        isApiClientError(error) && error.code === 'duplicate_display_name'
          ? 'A credential with that name already exists. Choose a different display name.'
          : 'Could not verify the Oracle Database connection. Check the connection details, network access, and database permissions.'
      )
    }
  }
  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`${action} Oracle Database connection`}
    >
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {action} Oracle Database connection
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Host'
          value={values.host}
          onChange={(value) => setField('host', value)}
          placeholder='db.example.com'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='input'
          title='Port'
          value={values.port}
          onChange={(value) => setField('port', value)}
          placeholder='1521'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='dropdown'
          title='Protocol'
          value={values.protocol}
          onChange={(value) => setField('protocol', value)}
          options={[
            { value: 'tcps', label: 'TCPS (TLS)' },
            { value: 'tcp', label: 'TCP' },
          ]}
          placeholder='Choose a protocol'
          required
          hint={
            values.protocol === 'tcp'
              ? 'TCP sends database traffic without TLS.'
              : 'TCPS verifies the server certificate and hostname.'
          }
        />
        <ChipModalField
          type='dropdown'
          title='Connection identifier'
          value={values.connectionType}
          onChange={(value) => setField('connectionType', value)}
          options={[
            { value: 'serviceName', label: 'Service name' },
            { value: 'sid', label: 'SID' },
          ]}
          placeholder='Choose an identifier type'
          required
        />
        {values.connectionType === 'sid' ? (
          <ChipModalField
            type='input'
            title='SID'
            value={values.sid}
            onChange={(value) => setField('sid', value)}
            placeholder='ORCL'
            required
          />
        ) : (
          <ChipModalField
            type='input'
            title='Service name'
            value={values.serviceName}
            onChange={(value) => setField('serviceName', value)}
            placeholder='FREEPDB1'
            required
          />
        )}
        <ChipModalField
          type='input'
          title='Username'
          value={values.username}
          onChange={(value) => setField('username', value)}
          placeholder='app_user'
          required
          autoComplete='off'
        />
        <ChipModalField type='custom' title='Password' required>
          {(aria) => (
            <SecretInput
              {...aria}
              value={values.password}
              onChange={(value) => setField('password', value)}
              placeholder='Enter the database password'
              autoComplete='new-password'
              data-lpignore='true'
            />
          )}
        </ChipModalField>
        {values.protocol === 'tcps' && (
          <>
            <ChipModalField
              type='custom'
              title='PEM wallet'
              hint='Optional ewallet.pem content for mutual TLS; up to 1 MiB.'
            >
              {(aria) => (
                <ChipTextarea
                  {...aria}
                  value={values.walletContent}
                  onChange={(event) => setField('walletContent', event.target.value)}
                  placeholder='Paste ewallet.pem content'
                  className='min-h-[120px]'
                  spellCheck={false}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              )}
            </ChipModalField>
            {values.walletContent && (
              <ChipModalField type='custom' title='Wallet password'>
                {(aria) => (
                  <SecretInput
                    {...aria}
                    value={values.walletPassword}
                    onChange={(value) => setField('walletPassword', value)}
                    placeholder='Password for an encrypted PEM wallet'
                    autoComplete='new-password'
                    data-lpignore='true'
                  />
                )}
              </ChipModalField>
            )}
          </>
        )}
        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the database username'
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
            onClick: () =>
              window.open(
                'https://docs.sim.ai/integrations/oracledb',
                '_blank',
                'noopener,noreferrer'
              ),
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
