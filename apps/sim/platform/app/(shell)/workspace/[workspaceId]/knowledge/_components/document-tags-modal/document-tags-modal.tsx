'use client'

import { useState } from 'react'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { SelectField, TextField } from '@sim/emcn/field'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { DatePicker } from '@sim/emcn/picker/date-picker'
import { InlineNotice } from '@sim/emcn/status'
import {
  ALL_TAG_SLOTS,
  type DocumentData,
  FIELD_TYPE_LABELS,
  KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
  TAG_SLOT_CONFIG,
  type TagDefinitionData,
  useDocumentTagDefinitionsQuery,
  useNextAvailableSlotMutation,
  useSaveDocumentTagDefinitions,
  useTagDefinitionsQuery,
  useUpdateDocumentTags,
} from '@/platform/lib/data/knowledge'
import { formatCalendarDate } from '@/platform/shared/time'

interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

interface TagDraft {
  displayName: string
  fieldType: string
  value: string
}

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; slot: string }

const LIST: View = { kind: 'list' }
const TAG_COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text', primary: true },
  { key: 'type', label: 'Type', kind: 'text' },
  { key: 'value', label: 'Value', kind: 'text' },
] as const
const NEW_TAG = '__new__'
const EMPTY_DRAFT: TagDraft = { displayName: '', fieldType: 'text', value: '' }
const NUMBER = /^-?\d*\.?\d*$/

/** The tags this document carries: each slot holding a value, named by its definition. */
function buildTags(document: DocumentData, definitions: readonly TagDefinitionData[]) {
  const tags: DocumentTag[] = []
  for (const slot of ALL_TAG_SLOTS) {
    const raw = document[slot]
    const definition = definitions.find((item) => item.tagSlot === slot)
    if (raw === null || raw === undefined || !definition) continue
    const value = String(raw).trim()
    if (value)
      tags.push({
        slot,
        displayName: definition.displayName,
        fieldType: definition.fieldType,
        value,
      })
  }
  return tags
}

function displayValue(value: string, fieldType: string) {
  if (fieldType === 'boolean') return value === 'true' ? 'True' : 'False'
  if (fieldType === 'date' && !Number.isNaN(new Date(value).getTime()))
    return formatCalendarDate(value.slice(0, 10), 'full')
  return value
}

interface ValueFieldProps {
  draft: TagDraft
  onChange: (value: string) => void
}

function ValueField({ draft, onChange }: ValueFieldProps) {
  if (draft.fieldType === 'boolean')
    return (
      <SelectField
        label='Value'
        value={draft.value || undefined}
        onValueChange={onChange}
        options={[
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]}
      />
    )
  if (draft.fieldType === 'date')
    return (
      <DatePicker
        label='Value'
        value={draft.value ? draft.value.slice(0, 10) : null}
        onValueChange={(value) => onChange(value ?? '')}
      />
    )
  if (draft.fieldType === 'number')
    return (
      <TextField
        label='Value'
        placeholder='Enter number'
        inputMode='decimal'
        value={draft.value}
        onChange={(value) => {
          if (NUMBER.test(value)) onChange(value)
        }}
        required
      />
    )
  return (
    <TextField
      label='Value'
      placeholder='Enter tag value'
      value={draft.value}
      onChange={onChange}
      required
    />
  )
}

interface DocumentTagsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  documentId: string
  document: DocumentData | null
  /** The document as saved, so a list can show the new values before its next read. */
  onDocumentUpdate?: (document: DocumentData) => void
}

/**
 * A document's tags: each value typed by its tag's definition. Applying a tag either reuses a
 * definition in the base or creates one in the next free slot; editing one can rename it for every
 * document, and removing one clears only this document's value.
 */
export function DocumentTagsModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  documentId,
  document,
  onDocumentUpdate,
}: DocumentTagsModalProps) {
  const documentDefinitions = useDocumentTagDefinitionsQuery(knowledgeBaseId, documentId)
  const baseDefinitions = useTagDefinitionsQuery(knowledgeBaseId)
  const nextSlot = useNextAvailableSlotMutation()
  const updateTags = useUpdateDocumentTags()
  const saveDefinitions = useSaveDocumentTagDefinitions()
  const [view, setView] = useState<View>(LIST)
  const [draft, setDraft] = useState<TagDraft>(EMPTY_DRAFT)
  const [choice, setChoice] = useState<string>(NEW_TAG)
  /** What the list shows while a save is on its way, so it does not fall back mid-write. */
  const [pending, setPending] = useState<DocumentTag[] | null>(null)

  const baseTags = baseDefinitions.data ?? []
  /** The form reads what is saved: the pending list would count the tag being applied as taken. */
  const saved = document ? buildTags(document, documentDefinitions.data ?? []) : []
  const tags = pending ?? saved
  const editing = view.kind === 'edit' ? saved.find((tag) => tag.slot === view.slot) : undefined
  const available = baseTags.filter(
    (definition) =>
      !saved.some((tag) => tag.displayName.toLowerCase() === definition.displayName.toLowerCase())
  )
  const textSlotsFull =
    baseTags.filter((definition) => definition.fieldType === 'text').length >=
    TAG_SLOT_CONFIG.text.maxSlots
  const canAdd = !textSlotsFull || available.length > 0
  const name = draft.displayName.trim()
  const existingDefinition = baseTags.find(
    (definition) => definition.displayName.toLowerCase() === name.toLowerCase()
  )
  const conflict =
    name.length > 0 &&
    saved.some(
      (tag) => tag.slot !== editing?.slot && tag.displayName.toLowerCase() === name.toLowerCase()
    )
  const unchanged =
    editing !== undefined &&
    editing.displayName === draft.displayName &&
    editing.value === draft.value
  const blockedNewDefinition = view.kind === 'create' && !existingDefinition && textSlotsFull
  const canSave = Boolean(
    name && draft.value.trim() && !conflict && !unchanged && !blockedNewDefinition
  )

  function close() {
    setView(LIST)
    setDraft(EMPTY_DRAFT)
    onOpenChange(false)
  }

  function startCreate() {
    const first = available[0]
    setChoice(first ? first.displayName : NEW_TAG)
    setDraft(
      first
        ? { displayName: first.displayName, fieldType: first.fieldType, value: '' }
        : EMPTY_DRAFT
    )
    setView({ kind: 'create' })
  }

  function startEdit(tag: DocumentTag) {
    setDraft({ displayName: tag.displayName, fieldType: tag.fieldType, value: tag.value })
    setView({ kind: 'edit', slot: tag.slot })
  }

  async function saveValues(next: DocumentTag[]) {
    const values: Record<string, string> = {}
    for (const slot of ALL_TAG_SLOTS)
      values[slot] = next.find((tag) => tag.slot === slot)?.value.trim() ?? ''
    const saved = await updateTags.mutateAsync({ knowledgeBaseId, documentId, tags: values })
    onDocumentUpdate?.(saved)
    await documentDefinitions.refetch()
  }

  async function remove(tag: DocumentTag) {
    const next = tags.filter((entry) => entry.slot !== tag.slot)
    setPending(next)
    try {
      await saveValues(next)
    } finally {
      setPending(null)
    }
  }

  async function apply() {
    const form = { ...draft, displayName: name, value: draft.value.trim() }
    let slot: string
    if (editing) slot = editing.slot
    else if (existingDefinition) slot = existingDefinition.tagSlot
    else slot = await nextSlot.mutateAsync({ knowledgeBaseId, fieldType: form.fieldType })
    const next = editing
      ? saved.map((tag) => (tag.slot === editing.slot ? { ...tag, ...form } : tag))
      : [...saved, { slot, ...form }]
    setPending(next)
    try {
      if (editing) {
        const definition = baseTags.find(
          (item) => item.displayName.toLowerCase() === editing.displayName.toLowerCase()
        )
        if (definition && definition.displayName !== form.displayName) {
          /** The API renames the definition it finds under its previous name. */
          const renamed = {
            tagSlot: definition.tagSlot,
            displayName: form.displayName,
            fieldType: definition.fieldType,
            _originalDisplayName: editing.displayName,
          }
          await saveDefinitions.mutateAsync({ knowledgeBaseId, documentId, definitions: [renamed] })
        }
      } else if (!existingDefinition) {
        await saveDefinitions.mutateAsync({
          knowledgeBaseId,
          documentId,
          definitions: [
            { tagSlot: slot, displayName: form.displayName, fieldType: form.fieldType },
          ],
        })
      }
      await baseDefinitions.refetch()
      await saveValues(next)
      setDraft(EMPTY_DRAFT)
      setView(LIST)
    } finally {
      setPending(null)
    }
    return false
  }

  if (view.kind !== 'list') {
    const creating = view.kind === 'create'
    const choosing = creating && available.length > 0
    return (
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        title={creating ? 'Add tag' : 'Edit tag'}
        confirmLabel={creating ? 'Apply tag' : 'Save changes'}
        confirmDisabled={!canSave}
        onBack={() => {
          setDraft(EMPTY_DRAFT)
          setView(LIST)
        }}
        onConfirm={apply}
      >
        {choosing && (
          <SelectField
            label='Tag'
            value={choice}
            onValueChange={(value) => {
              setChoice(value)
              const definition = available.find((item) => item.displayName === value)
              const fieldType = definition?.fieldType ?? 'text'
              setDraft({
                displayName: definition?.displayName ?? '',
                fieldType,
                value: fieldType === draft.fieldType ? draft.value : '',
              })
            }}
            options={[
              ...available.map((definition) => ({
                value: definition.displayName,
                label: `${definition.displayName} (${FIELD_TYPE_LABELS[definition.fieldType] ?? definition.fieldType})`,
              })),
              ...(textSlotsFull ? [] : [{ value: NEW_TAG, label: 'New tag' }]),
            ]}
          />
        )}
        {(!choosing || choice === NEW_TAG) && (
          <TextField
            label='Name'
            placeholder='Enter tag name'
            value={draft.displayName}
            onChange={(displayName) => setDraft({ ...draft, displayName })}
            maxLength={KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH}
            required
            error={conflict ? 'A tag with this name already exists.' : undefined}
          />
        )}
        <ValueField draft={draft} onChange={(value) => setDraft({ ...draft, value })} />
        {blockedNewDefinition && (
          <InlineNotice
            intent='warning'
            message='Every text tag slot is in use. Choose an existing tag instead.'
          />
        )}
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title='Document tags'
      cancelLabel='Close'
      footerStartAction={{
        label: 'Add tag',
        variant: 'secondary',
        disabled: !canAdd || !document,
        onClick: startCreate,
      }}
    >
      {document && documentDefinitions.status === 'success' && tags.length === 0 ? (
        <EmptyState
          title='No tags on this document'
          description='Add a tag to organize and filter documents.'
        />
      ) : (
        <DataTable
          title='Tags'
          titleHidden
          columns={TAG_COLUMNS}
          rows={tags.map((tag) => ({
            id: tag.slot,
            values: {
              name: tag.displayName,
              type: FIELD_TYPE_LABELS[tag.fieldType] ?? tag.fieldType,
              value: displayValue(tag.value, tag.fieldType),
            },
            onOpen: () => startEdit(tag),
            action: (
              <ActionMenu
                label={`${tag.displayName} options`}
                icon='I108'
                align='end'
                actions={[
                  { id: 'edit', label: 'Edit', onSelect: () => startEdit(tag) },
                  {
                    id: 'remove',
                    label: 'Remove tag',
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => void remove(tag),
                  },
                ]}
              />
            ),
          }))}
        />
      )}
    </Modal>
  )
}
