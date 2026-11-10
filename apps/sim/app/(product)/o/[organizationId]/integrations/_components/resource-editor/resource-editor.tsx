'use client'

import { useState } from 'react'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { generateId } from '@sim/utils/id'
import { ManualSecretFields } from '@/app/(product)/o/[organizationId]/integrations/_components/manual-secret-fields/manual-secret-fields'
import {
  ResourceAccessFields,
  ResourceFields,
  type SkillDefaults,
  useResourceDraft,
} from '@/app/(product)/o/[organizationId]/integrations/_components/resource-fields'
import type {
  AppSummary,
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import {
  MANUAL_SECRET_TYPES,
  type ManualSecretType,
  validateManualSecret,
} from '@/platform/lib/integrations/manual-secret'

interface ResourceEditorProps {
  kind: 'skill' | 'credential'
  resource?: Extract<IntegrationResource, { kind: 'skill' }>
  data: IntegrationCenterData
  onSave: (resource: IntegrationResource) => void
  onClose: () => void
  onDelete?: () => void
  apps?: readonly Pick<AppSummary, 'id' | 'name'>[]
  appId?: string
  skillDefaults?: SkillDefaults
  createLabel?: string
  deleteLabel?: string
}

export function ResourceEditor({
  kind,
  resource,
  data,
  onSave,
  onClose,
  onDelete,
  apps,
  appId,
  skillDefaults,
  createLabel,
  deleteLabel,
}: ResourceEditorProps) {
  return kind === 'credential' ? (
    <ManualCredentialEditor
      kind={kind}
      data={data}
      onSave={onSave}
      onClose={onClose}
      apps={apps}
      appId={appId}
    />
  ) : (
    <LibraryResourceEditor
      kind={kind}
      resource={resource}
      data={data}
      onSave={onSave}
      onClose={onClose}
      onDelete={onDelete}
      skillDefaults={skillDefaults}
      createLabel={createLabel}
      deleteLabel={deleteLabel}
    />
  )
}

interface LibraryResourceEditorProps extends Omit<ResourceEditorProps, 'kind'> {
  kind: 'skill'
}

function LibraryResourceEditor({
  kind,
  resource,
  data,
  onSave,
  onClose,
  onDelete,
  skillDefaults,
  createLabel,
  deleteLabel,
}: LibraryResourceEditorProps) {
  const editor = useResourceDraft({ kind, data, resource, skillDefaults })
  const [deleting, setDeleting] = useState(false)
  const noun = 'skill'
  const removeLabel = deleteLabel ?? `Delete ${noun}`
  return (
    <>
      <Modal
        open
        title={skillDefaults?.name ?? `${resource ? 'Edit' : 'Create'} ${noun}`}
        confirmLabel={resource ? 'Save' : (createLabel ?? `Create ${noun}`)}
        confirmDisabled={!editor.editable || Boolean(resource && !editor.dirty)}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        onConfirm={() => onSave(editor.value())}
        footerStartAction={
          resource && onDelete && editor.editable
            ? {
                label: removeLabel,
                variant: 'quiet',
                destructive: true,
                onClick: () => setDeleting(true),
              }
            : undefined
        }
      >
        <ResourceFields kind={kind} editor={editor} />
        <ResourceAccessFields editor={editor} data={data} resource={resource} />
      </Modal>
      {deleting && resource && onDelete && (
        <ConfirmDialog
          target={deleting}
          onClose={() => setDeleting(false)}
          title={`${deleteLabel ? 'Remove' : 'Delete'} ${noun}`}
          description={`This removes ${resource.name} from your integrations.`}
          confirmLabel={removeLabel}
          pendingLabel={deleteLabel ? 'Removing…' : 'Deleting…'}
          onConfirm={() => {
            onDelete()
            onClose()
          }}
        />
      )}
    </>
  )
}

function ManualCredentialEditor({ data, onSave, onClose, apps = [], appId }: ResourceEditorProps) {
  const [secretType, setSecretType] = useState<ManualSecretType>('secret')
  const [provider, setProvider] = useState(appId ?? '')
  return (
    <Modal
      open
      title='Create credential'
      confirmLabel='Create credential'
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onConfirm={(values) => {
        const read = (name: string) => String(values.get(name) ?? '').trim()
        const name = read('name')
        if (!name) throw new Error('Enter a name.')
        const key = read('key')
        if (!key) throw new Error('Enter a credential key.')
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
          throw new Error('Use letters, numbers, and underscores for the key.')
        validateManualSecret(secretType, values)
        onSave({
          id: generateId(),
          kind: 'credential',
          name,
          description: read('description'),
          key,
          credentialType: secretType,
          appId: provider || undefined,
          scope: 'personal',
          people: [data.viewer],
          owner: data.viewer,
          canEdit: true,
          members: [
            {
              ...data.viewer,
              userId: data.viewer.id,
              role: 'admin',
              roleSource: 'explicit',
              explicitAdmin: true,
              status: 'active',
            },
          ],
        })
      }}
    >
      <TextField label='Name' placeholder='Credential name' name='name' required maxLength={120} />
      <TextAreaField
        label='Description'
        placeholder='Describe what this is for'
        name='description'
        maxLength={500}
      />
      <SelectField
        label='App'
        value={provider}
        onValueChange={setProvider}
        disabled={Boolean(appId)}
        disabledReason={
          appId ? 'This credential is being created for the selected app.' : undefined
        }
        options={[
          { value: '', label: 'No app' },
          ...apps.map((app) => ({ value: app.id, label: app.name })),
        ]}
      />
      <SelectField
        label='Type'
        value={secretType}
        onValueChange={(value) => {
          const option = MANUAL_SECRET_TYPES.find((option) => option.value === value)
          if (option) setSecretType(option.value)
        }}
        options={MANUAL_SECRET_TYPES}
      />
      <TextField
        label='Key'
        name='key'
        placeholder='API_KEY'
        pattern='[A-Za-z_][A-Za-z0-9_]*'
        hint='Use letters, numbers, and underscores.'
        required
      />
      <ManualSecretFields key={secretType} type={secretType} />
    </Modal>
  )
}
