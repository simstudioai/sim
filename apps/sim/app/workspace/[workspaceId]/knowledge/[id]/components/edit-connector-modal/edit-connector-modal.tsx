'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
} from '@sim/emcn'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { ConnectorDocumentsTab } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-documents-tab'
import { ConnectorSettingsFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import { useConnectorSettingsForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form'
import { withBrandIcon } from '@/blocks/brand-icon'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'

interface EditConnectorModalProps {
  scope?: ResourceScope
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  isSearchIndex?: boolean
  connector: ConnectorData
}

export function EditConnectorModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  isSearchIndex = false,
  connector,
  scope,
}: EditConnectorModalProps) {
  const [activeTab, setActiveTab] = useState('settings')
  const form = useConnectorSettingsForm({
    scope,
    knowledgeBaseId,
    isSearchIndex,
    connector,
    onSaved: () => onOpenChange(false),
  })

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Edit ${form.displayName}`}
      size='md'
      dismissDisabled={form.saving}
    >
      <ChipModalHeader
        icon={form.icon ? withBrandIcon(form.icon) : null}
        onClose={() => onOpenChange(false)}
      >
        Edit {form.displayName}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalTabs
          tabs={[
            { value: 'settings', label: 'Settings' },
            { value: 'documents', label: 'Documents' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
          className='mx-2'
        />
        {activeTab === 'settings' ? (
          <ConnectorSettingsFields {...form.fieldsProps} />
        ) : (
          <ConnectorDocumentsTab knowledgeBaseId={knowledgeBaseId} connectorId={connector.id} />
        )}
      </ChipModalBody>
      {activeTab === 'settings' && (
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          secondaryActions={
            form.docsUrl
              ? [
                  {
                    label: 'Setup guide',
                    onClick: () => window.open(form.docsUrl, '_blank', 'noopener,noreferrer'),
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: form.saving ? 'Saving…' : 'Save',
            onClick: form.save,
            disabled: !form.canSave,
          }}
        />
      )}
    </ChipModal>
  )
}
