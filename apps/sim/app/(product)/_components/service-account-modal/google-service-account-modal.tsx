'use client'

import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { CopyField, SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import {
  type ResourceScope,
  type ServiceAccountFormField,
  useGoogleServiceAccount,
} from '@/platform/lib/data/credentials'

interface GoogleServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ResourceScope
  /** The vendor the setup is titled with (family name, e.g. "Google"). */
  serviceName: string
  /** Receives the new credential id so the picker can select it. */
  onCreated: (credentialId: string) => void
  /** The OAuth service the account is for; a Google Cloud service also offers keyless setup. */
  oauthServiceId?: string
}

/**
 * Adds a Google service account from its JSON key, pasted or chosen as a `.json` file, or for a
 * Google Cloud service keyless through Workload Identity Federation, chosen in the Authentication
 * select. The display name fills in from the key's `client_email` until the user types one, and the
 * key is checked against the server's schema before it is sent.
 */
export function GoogleServiceAccountModal({
  open,
  onOpenChange,
  scope,
  serviceName,
  onCreated,
  oauthServiceId,
}: GoogleServiceAccountModalProps) {
  const form = useGoogleServiceAccount({ open, scope, onCreated, oauthServiceId })
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
      <ServiceAccountFormFields fields={form.keylessFields} onChange={form.setKeylessField} />
      {!form.keyless && (
        <>
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
        </>
      )}
      <TextField
        label='Display name'
        value={form.displayName}
        onChange={form.setDisplayName}
        placeholder={
          form.keyless
            ? 'Defaults to the service account email'
            : 'Auto-populated from client_email'
        }
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

interface ServiceAccountFormFieldsProps {
  fields: readonly ServiceAccountFormField[]
  onChange: (id: string, value: string) => void
}

/**
 * A service-account setup form's fields: a choice as a select, a value Sim issues as a copy field
 * (multiline as a read-only text area), a secret masked, and every other value as text. The shared
 * key form renders its fields with it too; it lives here so the dialogs add no module of their own.
 */
export function ServiceAccountFormFields({ fields, onChange }: ServiceAccountFormFieldsProps) {
  return (
    <>
      {fields.map((field) =>
        field.copy ? (
          field.multiline ? (
            <TextAreaField
              key={field.id}
              label={field.label}
              value={field.value}
              placeholder={field.placeholder}
              viewOnly
              spellCheck={false}
            />
          ) : (
            <CopyField key={field.id} label={field.label} value={field.value} />
          )
        ) : field.options ? (
          <SelectField
            key={field.id}
            label={field.label}
            value={field.value}
            onValueChange={(value) => onChange(field.id, value)}
            options={field.options}
            error={field.error}
            optional={!field.required}
          />
        ) : field.multiline ? (
          <TextAreaField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(value) => onChange(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='off'
            spellCheck={false}
            required={field.required}
            optional={!field.required}
            hint={field.formatWarning}
            error={field.error}
          />
        ) : field.secret ? (
          <SecretField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(value) => onChange(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='new-password'
            required={field.required}
            optional={!field.required}
            hint={field.formatWarning}
            error={field.error}
          />
        ) : (
          <TextField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(value) => onChange(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='off'
            required={field.required}
            optional={!field.required}
            hint={field.formatWarning}
            error={field.error}
          />
        )
      )}
    </>
  )
}
