'use client'

import { useId, useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/workspace-access/workspace-access.module.css'
import {
  ActivityRow,
  EmptyState,
  FieldFrame,
  Modal,
  ScrollArea,
  SearchField,
  Select,
} from '@/platform/design-system/components'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import type { IntegrationsData, WorkspaceAccess } from '@/platform/lib/integrations/model'

type Workspace = IntegrationsData['workspaces'][number]
type CredentialType = IntegrationsData['credentialTypes'][number]

interface WorkspaceAccessListProps {
  workspaces: readonly Workspace[]
  credentialTypes: readonly CredentialType[]
  grants: IntegrationsData['workspaceGrants']
  onSave: (id: string, access: WorkspaceAccess | null) => void
}

const ACCESS_CHOICES = [
  { value: 'none', label: 'No access' },
  { value: 'all', label: 'All credential types' },
  { value: 'selected', label: 'Selected credential types' },
] as const

function accessSummary(grant?: WorkspaceAccess) {
  if (!grant) return 'No access'
  if (grant.mode === 'all') return 'All credential types'
  const count = grant.credentialTypes.length
  return `${count} credential ${count === 1 ? 'type' : 'types'}`
}

export function WorkspaceAccessList({
  workspaces,
  credentialTypes,
  grants,
  onSave,
}: WorkspaceAccessListProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = workspaces.find(({ id }) => id === editingId)
  const filter = query.trim().toLowerCase()
  const matches = workspaces.filter(({ name }) => name.toLowerCase().includes(filter))

  if (workspaces.length === 0) return <EmptyState title='No workspaces' />
  return (
    <section className={styles.section} aria-label='Workspace access'>
      <div className={styles.search}>
        <SearchField
          label='Search workspaces'
          placeholder='Search workspaces…'
          onValueChange={setQuery}
        />
      </div>
      {matches.length > 0 ? (
        <ul className={styles.workspaces} aria-label='Workspaces'>
          {matches.map(({ id, name }) => (
            <ActivityRow
              key={id}
              title={name}
              detail={accessSummary(grants[id])}
              onOpen={() => setEditingId(id)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState title='No matching workspaces' />
      )}
      {editing && (
        <WorkspaceAccessEditor
          key={JSON.stringify([editing.id, grants[editing.id]])}
          workspace={editing}
          grant={grants[editing.id]}
          types={credentialTypes}
          onClose={() => setEditingId(null)}
          onSave={(access) => onSave(editing.id, access)}
        />
      )}
    </section>
  )
}

interface WorkspaceAccessEditorProps {
  workspace: Workspace
  grant?: WorkspaceAccess
  types: readonly CredentialType[]
  onClose: () => void
  onSave: (access: WorkspaceAccess | null) => void
}

function WorkspaceAccessEditor({
  workspace,
  grant,
  types,
  onClose,
  onSave,
}: WorkspaceAccessEditorProps) {
  const fieldId = useId()
  const [mode, setMode] = useState<WorkspaceAccess['mode'] | 'none'>(grant?.mode ?? 'none')
  const [checkedIds, setCheckedIds] = useState(
    grant?.mode === 'selected' ? grant.credentialTypes : []
  )
  const [query, setQuery] = useState('')
  const selectedIds = types.filter(({ id }) => checkedIds.includes(id)).map(({ id }) => id)
  const filter = query.trim().toLowerCase()
  const matches = types.filter(({ label }) => label.toLowerCase().includes(filter))

  function save() {
    if (mode === 'selected') {
      if (selectedIds.length) onSave({ mode, credentialTypes: selectedIds })
    } else {
      onSave(mode === 'all' ? { mode } : null)
    }
  }

  return (
    <Modal
      open
      onOpenChange={onClose}
      title='Edit workspace access'
      description={workspace.name}
      confirmLabel='Save'
      confirmDisabled={mode === 'selected' && selectedIds.length === 0}
      onConfirm={save}
    >
      <FieldFrame id={fieldId} label='Credential access'>
        <Select
          id={fieldId}
          label='Credential access'
          value={mode}
          options={ACCESS_CHOICES}
          onValueChange={(next) => {
            const choice = ACCESS_CHOICES.find(({ value }) => value === next)
            if (choice) setMode(choice.value)
          }}
        />
      </FieldFrame>
      {mode === 'selected' && (
        <FieldFrame label={`Credential types (${selectedIds.length} selected)`}>
          <SearchField
            label='Search credential types'
            placeholder='Search credential types…'
            defaultValue={query}
            onValueChange={setQuery}
          />
          {matches.length > 0 ? (
            <div className={styles.choices}>
              <ScrollArea label='Credential types'>
                <div className={styles.rows}>
                  {matches.map(({ id, label }) => {
                    const selected = checkedIds.includes(id)
                    return (
                      <ControlRow
                        key={id}
                        label={label}
                        trailingIcon={selected ? 'I072' : undefined}
                        render={<button type='button' aria-pressed={selected} />}
                        onClick={() =>
                          setCheckedIds((current) =>
                            current.includes(id)
                              ? current.filter((value) => value !== id)
                              : [...current, id]
                          )
                        }
                      />
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <EmptyState
              title={types.length ? 'No matching credential types' : 'No credential types'}
            />
          )}
        </FieldFrame>
      )}
    </Modal>
  )
}
