'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { CredentialDetail } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-detail/credential-detail'
import { ManualSecretFields } from '@/app/(product)/o/[organizationId]/integrations/_components/manual-secret-fields/manual-secret-fields'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import { validCredentialMembers } from '@/platform/lib/integrations/credential-access'
import { credentialSharing } from '@/platform/lib/integrations/credential-display'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import {
  MANUAL_SECRET_TYPES,
  type ManualCredential,
  manualCredentialAccess,
  validateManualSecret,
} from '@/platform/lib/integrations/manual-secret'

interface ManualCredentialDetailProps {
  resource: ManualCredential
  data: IntegrationCenterData
  appName?: string
  onSave: (resource: IntegrationResource) => void
  onRemove: () => void
  onLeave: () => void
}

export function ManualCredentialDetail({
  resource,
  data,
  appName,
  onSave,
  onRemove,
  onLeave,
}: ManualCredentialDetailProps) {
  const [action, setAction] = useState<'replace' | 'delete' | null>(null)
  const credential = manualCredentialAccess(resource, data)
  function save(next: IntegrationCredential) {
    if (!resource.canEdit || !validCredentialMembers(credential, next.members)) return
    onSave({
      ...resource,
      name: next.displayName,
      description: next.description,
      members: next.members,
      scope: credentialSharing(next),
      people: next.members.filter((member) => member.status !== 'revoked'),
      canEdit: next.role === 'admin',
    })
  }
  return (
    <>
      <CredentialDetail
        credential={credential}
        integrationName={appName ?? 'Credential'}
        providerId={resource.appId}
        viewer={data.viewer}
        onSaveDetails={(details) => save({ ...credential, ...details })}
        access={{ people: data.people, onChange: save, onLeave }}
        onDisconnect={() => setAction('delete')}
        onReplace={() => setAction('replace')}
        fields={
          <>
            <TextField label='Key' placeholder='Credential key' value={resource.key} viewOnly />
            <TextField
              label='Type'
              placeholder='Credential type'
              value={
                MANUAL_SECRET_TYPES.find((type) => type.value === resource.credentialType)?.label ??
                'Secret'
              }
              viewOnly
            />
          </>
        }
      />
      {action === 'replace' && (
        <Modal
          open
          title={`Replace ${resource.name}`}
          confirmLabel='Save value'
          onOpenChange={(open) => {
            if (!open) setAction(null)
          }}
          onConfirm={(values) => {
            validateManualSecret(resource.credentialType, values)
            setAction(null)
          }}
        >
          <ManualSecretFields type={resource.credentialType} replacing />
        </Modal>
      )}
      {action === 'delete' && (
        <ConfirmDialog
          target={action === 'delete'}
          onClose={() => setAction(null)}
          title='Delete credential'
          description={`People and workflows using ${resource.name} will lose access.`}
          confirmLabel='Delete'
          pendingLabel='Deleting…'
          onConfirm={onRemove}
        />
      )}
    </>
  )
}
