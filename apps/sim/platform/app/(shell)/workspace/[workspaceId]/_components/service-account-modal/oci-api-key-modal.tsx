'use client'

import { TextAreaField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { useOciApiKey } from '@/platform/lib/data/credentials'

interface OciApiKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** The vendor the setup is titled with (family name, e.g. "Oracle Cloud"). */
  serviceName: string
  /** Receives the new credential id so the picker can select it. */
  onCreated: (credentialId: string) => void
}

/**
 * Adds an Oracle Cloud API signing key: tenancy and user OCIDs, fingerprint, PEM private key with
 * its optional passphrase, and region. The server checks the key against OCI before storing it.
 */
export function OciApiKeyModal({
  open,
  onOpenChange,
  workspaceId,
  serviceName,
  onCreated,
}: OciApiKeyModalProps) {
  const form = useOciApiKey({ open, workspaceId, onCreated })
  const { values, setField } = form
  const docsUrl = form.docsUrl

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${serviceName} API key`}
      confirmLabel={form.isPending ? 'Adding…' : 'Add API key'}
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
        label='Tenancy OCID'
        value={values.tenancyOcid}
        onChange={(value) => setField('tenancyOcid', value)}
        placeholder='ocid1.tenancy.oc1..'
        autoComplete='off'
        required
      />
      <TextField
        label='User OCID'
        value={values.userOcid}
        onChange={(value) => setField('userOcid', value)}
        placeholder='ocid1.user.oc1..'
        autoComplete='off'
        required
      />
      <TextField
        label='Fingerprint'
        value={values.fingerprint}
        onChange={(value) => setField('fingerprint', value)}
        placeholder='00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff'
        autoComplete='off'
        required
      />
      <TextAreaField
        label='Private key'
        value={values.privateKey}
        onChange={(value) => setField('privateKey', value)}
        placeholder='-----BEGIN PRIVATE KEY-----'
        autoComplete='off'
        spellCheck={false}
        defaultSize='expanded'
        required
      />
      <SecretField
        label='Private-key passphrase'
        value={values.privateKeyPassphrase}
        onChange={(value) => setField('privateKeyPassphrase', value)}
        placeholder='Optional'
        autoComplete='new-password'
        optional
      />
      <TextField
        label='Region'
        value={values.region}
        onChange={(value) => setField('region', value)}
        placeholder='us-ashburn-1'
        autoComplete='off'
        required
      />
      <TextField
        label='Display name'
        value={values.displayName}
        onChange={(value) => setField('displayName', value)}
        placeholder='Defaults to the OCI user OCID'
        autoComplete='off'
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
