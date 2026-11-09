'use client'

import { TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { type ResourceScope, useGoogleServiceAccount } from '@/platform/lib/data/credentials'

interface GoogleServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ResourceScope
  /** The vendor the setup is titled with (family name, e.g. "Google"). */
  serviceName: string
  /** Receives the new credential id so the picker can select it. */
  onCreated: (credentialId: string) => void
}

/**
 * Adds a Google service account from its JSON key, pasted or chosen as a `.json` file. The display
 * name fills in from the key's `client_email` until the user types one, and the key is checked
 * against the server's schema before it is sent.
 */
export function GoogleServiceAccountModal({
  open,
  onOpenChange,
  scope,
  serviceName,
  onCreated,
}: GoogleServiceAccountModalProps) {
  const form = useGoogleServiceAccount({ open, scope, onCreated })
  const docsUrl = form.docsUrl

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${serviceName} service account`}
      confirmLabel={form.isPending ? 'Adding…' : 'Add service account'}
      confirmDisabled={form.confirmDisabled}
      pending={form.isPending}
      onConfirm={() => form.submit()}
      footerStartAction={{
        label: 'Setup guide',
        variant: 'quiet',
        onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
      }}
    >
      <TextAreaField
        label='JSON key'
        value={form.jsonInput}
        onChange={form.setJsonInput}
        placeholder='Paste your service account JSON key here'
        autoComplete='off'
        spellCheck={false}
        defaultSize='expanded'
        required
      />
      <FileField
        label='Or upload a file'
        accept='.json'
        prompt='Drag & drop a .json file, or click to browse'
        selection={
          form.uploadedFile && {
            name: form.uploadedFile.name,
            detail: 'Click or drop to replace',
          }
        }
        error={form.fileError}
        onFileChange={(file) => void form.chooseFile(file)}
      />
      <TextField
        label='Display name'
        value={form.displayName}
        onChange={form.setDisplayName}
        placeholder='Auto-populated from client_email'
        autoComplete='off'
        optional
      />
      <TextAreaField
        label='Description'
        value={form.description}
        onChange={form.setDescription}
        placeholder='Optional description'
        maxLength={500}
        optional
      />
    </Modal>
  )
}
