'use client'

import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { useOracleDatabaseAccount } from '@/platform/lib/data/credentials'

const PROTOCOL_OPTIONS = [
  { value: 'tcps', label: 'TCPS (TLS)' },
  { value: 'tcp', label: 'TCP' },
]

const CONNECTION_TYPE_OPTIONS = [
  { value: 'serviceName', label: 'Service name' },
  { value: 'sid', label: 'SID' },
]

interface OracleDatabaseAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** The vendor the setup is titled with. The dialog names the Oracle Database connection itself. */
  serviceName: string
  /** Receives the new credential id so the picker can select it. */
  onCreated: (credentialId: string) => void
}

/**
 * Adds a saved Oracle Net connection: host, port, protocol, a service name or SID, the database
 * login and, over TCPS, an optional PEM wallet. The server verifies the connection before saving it.
 */
export function OracleDatabaseAccountModal({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: OracleDatabaseAccountModalProps) {
  const form = useOracleDatabaseAccount({ open, workspaceId, onCreated })
  const { values, setField } = form
  const docsUrl = form.docsUrl

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title='Add Oracle Database connection'
      confirmLabel={form.isPending ? 'Verifying…' : 'Add connection'}
      confirmDisabled={form.confirmDisabled}
      pending={form.isPending}
      onConfirm={() => form.submit()}
      footerStartAction={{
        label: 'Setup guide',
        variant: 'quiet',
        onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
      }}
    >
      <TextField
        label='Host'
        value={values.host}
        onChange={(value) => setField('host', value)}
        placeholder='db.example.com'
        autoComplete='off'
        required
      />
      <TextField
        label='Port'
        value={values.port}
        onChange={(value) => setField('port', value)}
        placeholder='1521'
        autoComplete='off'
        required
      />
      <SelectField
        label='Protocol'
        value={values.protocol}
        onValueChange={(value) => setField('protocol', value)}
        options={PROTOCOL_OPTIONS}
        hint={
          values.protocol === 'tcp'
            ? 'TCP sends database traffic without TLS.'
            : 'TCPS verifies the server certificate and hostname.'
        }
      />
      <SelectField
        label='Connection identifier'
        value={values.connectionType}
        onValueChange={(value) => setField('connectionType', value)}
        options={CONNECTION_TYPE_OPTIONS}
      />
      {form.usesSid ? (
        <TextField
          key='sid'
          label='SID'
          value={values.sid}
          onChange={(value) => setField('sid', value)}
          placeholder='ORCL'
          required
        />
      ) : (
        <TextField
          key='serviceName'
          label='Service name'
          value={values.serviceName}
          onChange={(value) => setField('serviceName', value)}
          placeholder='FREEPDB1'
          required
        />
      )}
      <TextField
        label='Username'
        value={values.username}
        onChange={(value) => setField('username', value)}
        placeholder='app_user'
        autoComplete='off'
        required
      />
      <SecretField
        label='Password'
        value={values.password}
        onChange={(value) => setField('password', value)}
        placeholder='Enter the database password'
        autoComplete='new-password'
        maskAsText
        required
      />
      {form.showWallet && (
        <TextAreaField
          label='PEM wallet'
          value={values.walletContent}
          onChange={(value) => setField('walletContent', value)}
          placeholder='Paste ewallet.pem content'
          autoComplete='off'
          spellCheck={false}
          defaultSize='expanded'
          hint='Optional ewallet.pem content for mutual TLS; up to 1 MiB.'
          optional
        />
      )}
      {form.showWalletPassword && (
        <SecretField
          label='Wallet password'
          value={values.walletPassword}
          onChange={(value) => setField('walletPassword', value)}
          placeholder='Password for an encrypted PEM wallet'
          autoComplete='new-password'
          maskAsText
          optional
        />
      )}
      <TextField
        label='Display name'
        value={values.displayName}
        onChange={(value) => setField('displayName', value)}
        placeholder='Defaults to the database username'
        optional
      />
      <TextAreaField
        label='Description'
        value={values.description}
        onChange={(value) => setField('description', value)}
        placeholder='Optional description'
        maxLength={500}
        optional
      />
    </Modal>
  )
}
