'use client'

import { useState } from 'react'
import { DatePicker, Modal, SearchableSelect, TextField } from '@/platform/design-system/components'
import {
  type Person,
  type PersonDraft,
  useEditPerson,
  usePeoplePicker,
} from '@/platform/lib/data/people'

/** Profile text's server bound; a longer draft would only come back refused. */
const PROFILE_TEXT_MAX_LENGTH = 200

/** The picker's value for no manager; membership ids are never this. */
const NO_MANAGER = 'no-manager'

const TEXT_FIELDS = [
  { field: 'title', label: 'Title', placeholder: 'Staff Engineer' },
  { field: 'department', label: 'Department', placeholder: 'Engineering' },
  { field: 'location', label: 'Location', placeholder: 'San Francisco' },
] as const

interface PersonModalProps {
  organizationId: string
  person: Person
  onClose: () => void
}

/** A validation problem keeps the dialog open like a refused save, with its message on the field. */
class FieldProblems extends Error {}

export function PersonModal({ organizationId, person, onClose }: PersonModalProps) {
  const edit = useEditPerson(organizationId, person.memberId)
  const picker = usePeoplePicker(organizationId, 'members', person.memberId)
  const [draft, setDraft] = useState<PersonDraft>({
    title: person.title,
    department: person.department,
    location: person.location,
    startDate: person.startDate,
    managerMemberId: person.managerMemberId,
  })
  const [errors, setErrors] = useState<Partial<Record<keyof PersonDraft, string>>>({})
  // The chosen manager's name, kept with the choice: the search results may no longer include them.
  // Only a stored manager who is suspended has an id and no name.
  const [managerName, setManagerName] = useState(person.manager?.name ?? null)
  const change = <Key extends keyof PersonDraft>(field: Key, value: PersonDraft[Key]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Edit ${person.name}`}
      confirmLabel='Save'
      onConfirm={async () => {
        const problems = await edit.save(draft)
        if (problems) {
          setErrors(problems)
          throw new FieldProblems('Check the highlighted fields.')
        }
      }}
    >
      {TEXT_FIELDS.map(({ field, label, placeholder }) => (
        <TextField
          key={field}
          label={label}
          placeholder={placeholder}
          maxLength={PROFILE_TEXT_MAX_LENGTH}
          value={draft[field] ?? ''}
          onChange={(value) => change(field, value || null)}
          error={errors[field]}
        />
      ))}
      <DatePicker
        label='Start date'
        placeholder='Not recorded'
        clearable
        value={draft.startDate ?? null}
        onValueChange={(value) => change('startDate', value)}
        error={errors.startDate}
      />
      <SearchableSelect
        label='Manager'
        searchLabel='Search people'
        options={[{ value: NO_MANAGER, label: 'No manager' }, ...picker.options]}
        value={draft.managerMemberId ?? NO_MANAGER}
        selectedLabel={draft.managerMemberId ? (managerName ?? 'Suspended member') : 'No manager'}
        search={picker.search}
        onOpenChange={picker.onOpenChange}
        error={errors.managerMemberId}
        onValueChange={(value) => {
          const manager = picker.people.find((candidate) => candidate.memberId === value)
          setManagerName(manager?.name ?? null)
          change('managerMemberId', manager?.memberId ?? null)
        }}
      />
    </Modal>
  )
}
