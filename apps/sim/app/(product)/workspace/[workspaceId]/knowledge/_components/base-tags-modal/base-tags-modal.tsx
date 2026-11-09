'use client'

import { useState } from 'react'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { SelectField, TextField } from '@sim/emcn/field'
import { ListField } from '@sim/emcn/field/list-field'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import styles from '@/app/(product)/workspace/[workspaceId]/knowledge/_components/base-tags-modal/base-tags-modal.module.css'
import {
  FIELD_TYPE_LABELS,
  KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
  SUPPORTED_FIELD_TYPES,
  TAG_SLOT_CONFIG,
  type TagDefinitionData,
  type TagUsageData,
  useCreateTagDefinition,
  useDeleteTagDefinition,
  useTagDefinitionsQuery,
  useTagUsageQuery,
} from '@/platform/lib/data/knowledge'

type FieldType = (typeof SUPPORTED_FIELD_TYPES)[number]

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'documents'; tagId: string }

const LIST: View = { kind: 'list' }

const TAG_COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text', primary: true },
  { key: 'type', label: 'Type', kind: 'text' },
  { key: 'documents', label: 'Documents', kind: 'number' },
] as const

function documentCount(count: number) {
  return `${count.toLocaleString()} document${count === 1 ? '' : 's'}`
}

/** The documents a tag is on, as a bounded list naming each value; the rest are counted. */
function UsageList({ label, usage }: { label: string; usage: TagUsageData }) {
  const hidden = usage.documentCount - usage.documents.length
  return (
    <>
      <ListField
        label={label}
        groups={[
          {
            id: 'documents',
            items: usage.documents.map((document) => ({
              id: document.id,
              label: document.name,
              description: document.tagValue || undefined,
            })),
          },
        ]}
      />
      {hidden > 0 && (
        <p className={styles.note} data-type='T052'>
          and {documentCount(hidden)} more
        </p>
      )}
    </>
  )
}

interface BaseTagsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
}

/**
 * A knowledge base's tag definitions: each with its type and how many documents use it, the
 * documents behind a tag, deleting a tag with the documents it leaves, and creating one in a free
 * slot of its type.
 */
export function BaseTagsModal({ open, onOpenChange, knowledgeBaseId }: BaseTagsModalProps) {
  const definitions = useTagDefinitionsQuery(knowledgeBaseId)
  const usage = useTagUsageQuery(knowledgeBaseId, { enabled: open })
  const createTag = useCreateTagDefinition()
  const deleteTag = useDeleteTagDefinition()
  const [view, setView] = useState<View>(LIST)
  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState<FieldType>('text')
  const [deleting, setDeleting] = useState<TagDefinitionData | null>(null)

  const tags = definitions.data ?? []
  const usageFor = (tag: TagDefinitionData): TagUsageData =>
    usage.data?.find((entry) => entry.tagSlot === tag.tagSlot) ?? {
      tagName: tag.displayName,
      tagSlot: tag.tagSlot,
      documentCount: 0,
      documents: [],
    }
  const slots = (type: FieldType) => ({
    used: tags.filter((tag) => tag.fieldType === type).length,
    max: TAG_SLOT_CONFIG[type].maxSlots,
  })
  const available = SUPPORTED_FIELD_TYPES.filter((type) => slots(type).used < slots(type).max)
  const trimmed = name.trim()
  const conflict =
    trimmed.length > 0 &&
    tags.some((tag) => tag.displayName.toLowerCase() === trimmed.toLowerCase())
  const typeFull = !available.includes(fieldType)

  function close() {
    setView(LIST)
    setName('')
    onOpenChange(false)
  }

  function startCreate() {
    setName('')
    setFieldType(available[0] ?? 'text')
    setView({ kind: 'create' })
  }

  function showDocuments(tag: TagDefinitionData) {
    void usage.refetch()
    setView({ kind: 'documents', tagId: tag.id })
  }

  const viewed = view.kind === 'documents' ? tags.find((tag) => tag.id === view.tagId) : undefined
  const viewedUsage = viewed && usageFor(viewed)
  const deletingUsage = deleting && usageFor(deleting)

  return (
    <>
      {view.kind === 'create' ? (
        <Modal
          open={open}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          title='New tag'
          confirmLabel={createTag.isPending ? 'Creating…' : 'Create tag'}
          confirmDisabled={!trimmed || conflict || typeFull}
          onBack={() => setView(LIST)}
          onConfirm={async () => {
            await createTag.mutateAsync({
              knowledgeBaseId,
              displayName: trimmed,
              fieldType,
            })
            setName('')
            setView(LIST)
            return false
          }}
        >
          <TextField
            label='Name'
            placeholder='Enter tag name'
            value={name}
            onChange={setName}
            maxLength={KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH}
            required
            error={conflict ? 'A tag with this name already exists.' : undefined}
          />
          <SelectField
            label='Type'
            value={fieldType}
            onValueChange={(value) => {
              const type = SUPPORTED_FIELD_TYPES.find((entry) => entry === value)
              if (type) setFieldType(type)
            }}
            options={SUPPORTED_FIELD_TYPES.map((type) => {
              const { used, max } = slots(type)
              return {
                value: type,
                label: `${FIELD_TYPE_LABELS[type] ?? type} (${used}/${max})`,
                disabled: used >= max,
                disabledReason: used >= max ? 'Every slot of this type is in use.' : undefined,
              }
            })}
            error={typeFull ? 'No slots are left for this type. Choose another.' : undefined}
          />
        </Modal>
      ) : view.kind === 'documents' && viewed && viewedUsage ? (
        <Modal
          open={open}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          title={`Documents using “${viewed.displayName}”`}
          description={
            viewedUsage.documentCount === 0
              ? 'No document uses this tag. Deleting it frees its slot.'
              : `${documentCount(viewedUsage.documentCount)} ${viewedUsage.documentCount === 1 ? 'uses' : 'use'} this tag.`
          }
          onBack={() => setView(LIST)}
        >
          {viewedUsage.documentCount > 0 && <UsageList label='Documents' usage={viewedUsage} />}
        </Modal>
      ) : (
        <Modal
          open={open}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          title='Tags'
          cancelLabel='Close'
          footerStartAction={{
            label: 'New tag',
            variant: 'secondary',
            disabled: available.length === 0,
            onClick: startCreate,
          }}
        >
          {definitions.status === 'success' && tags.length === 0 ? (
            <EmptyState
              title='No tags yet'
              description='Create a tag to organize and filter documents.'
            />
          ) : (
            <DataTable
              title='Tags'
              titleHidden
              columns={TAG_COLUMNS}
              rows={tags.map((tag) => ({
                id: tag.id,
                values: {
                  name: tag.displayName,
                  type: FIELD_TYPE_LABELS[tag.fieldType] ?? tag.fieldType,
                  documents: usageFor(tag).documentCount,
                },
                onOpen: () => showDocuments(tag),
                action: (
                  <ActionMenu
                    label={`${tag.displayName} options`}
                    icon='I108'
                    align='end'
                    actions={[
                      {
                        id: 'documents',
                        label: 'View documents',
                        onSelect: () => showDocuments(tag),
                      },
                      {
                        id: 'delete',
                        label: 'Delete tag',
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => {
                          void usage.refetch()
                          setDeleting(tag)
                        },
                      },
                    ]}
                  />
                ),
              }))}
            />
          )}
        </Modal>
      )}
      <ConfirmDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        title='Delete tag'
        description={(tag) => {
          const count = deletingUsage?.documentCount ?? 0
          return `Delete the ${tag.displayName} tag?${count > 0 ? ` It is removed from ${documentCount(count)}.` : ''} This can't be undone.`
        }}
        confirmLabel='Delete tag'
        pendingLabel='Deleting…'
        onConfirm={(tag) => deleteTag.mutateAsync({ knowledgeBaseId, tagDefinitionId: tag.id })}
      >
        {deletingUsage && deletingUsage.documentCount > 0 && (
          <UsageList label='Affected documents' usage={deletingUsage} />
        )}
      </ConfirmDialog>
    </>
  )
}
