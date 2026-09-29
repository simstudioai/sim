'use client'

import { useState } from 'react'
import {
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTag,
  toast,
} from '@sim/emcn'
import { Database, Plus } from '@sim/emcn/icons'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useCreateMemorySpace,
  useMemorySpaces,
  useSelectMemorySpace,
} from '@/hooks/queries/memory-spaces'

interface KnowledgeGraphsProps {
  organizationId: string
}

export function KnowledgeGraphs({ organizationId }: KnowledgeGraphsProps) {
  const { data, isLoading, error } = useMemorySpaces(organizationId)
  const select = useSelectMemorySpace(organizationId)
  const [creating, setCreating] = useState(false)
  return (
    <SettingsPanel
      actions={[
        {
          text: 'New graph',
          icon: Plus,
          onSelect: () => setCreating(true),
          disabled: isLoading || !!error || select.isPending,
        },
      ]}
    >
      {error ? (
        <SettingsEmptyState tone='error'>{error.message}</SettingsEmptyState>
      ) : isLoading ? (
        <SettingsEmptyState>Loading knowledge graphs...</SettingsEmptyState>
      ) : (
        <div className={RESOURCE_LIST_STACK}>
          {data?.spaces.map((space) => (
            <SettingsResourceRow
              key={space.id ?? 'default'}
              icon={<Database />}
              title={space.name}
              description={
                space.id === null
                  ? 'Your original knowledge graph, preserved.'
                  : 'Private to you in this organization.'
              }
              trailing={
                space.id === data.activeSpaceId ? (
                  <ChipTag>Active</ChipTag>
                ) : (
                  <Chip
                    disabled={select.isPending || creating}
                    onClick={() =>
                      select.mutate(
                        { spaceId: space.id },
                        { onError: (failure) => toast.error(failure.message) }
                      )
                    }
                  >
                    Make active
                  </Chip>
                )
              }
            />
          ))}
        </div>
      )}
      {creating && (
        <CreateKnowledgeGraph organizationId={organizationId} onClose={() => setCreating(false)} />
      )}
    </SettingsPanel>
  )
}

interface CreateKnowledgeGraphProps extends KnowledgeGraphsProps {
  onClose: () => void
}
function CreateKnowledgeGraph({ organizationId, onClose }: CreateKnowledgeGraphProps) {
  const create = useCreateMemorySpace(organizationId)
  const [name, setName] = useState('')
  const submit = () => create.mutate({ name: name.trim() }, { onSuccess: onClose })
  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      dismissDisabled={create.isPending}
      srTitle='New knowledge graph'
    >
      <ChipModalHeader onClose={onClose}>New knowledge graph</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='custom'
          title='Name'
          hint='Creates an empty graph and makes it active for new chats. Your other graphs are kept.'
        >
          <ChipInput
            aria-label='Graph name'
            placeholder='e.g. Fresh exploration'
            value={name}
            maxLength={100}
            disabled={create.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </ChipModalField>
        <ChipModalError>{create.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: create.isPending ? 'Creating...' : 'Create and activate',
          onClick: submit,
          disabled: create.isPending || !name.trim(),
        }}
      />
    </ChipModal>
  )
}
