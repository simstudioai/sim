'use client'

import { useState } from 'react'
import {
  Chip,
  ChipCombobox,
  ChipDatePicker,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { Person, PersonBody } from '@/lib/api/contracts/people'
import { memberProfileFieldsSchema, PROFILE_TEXT_MAX_LENGTH } from '@/lib/people/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { usePeople, useUpdatePerson } from '@/hooks/queries/people'
import { useDebounce } from '@/hooks/use-debounce'

type TextField = 'title' | 'department' | 'location'

/** The picker's value for no manager; membership ids are never this. */
const NO_MANAGER = 'no-manager'

const TEXT_FIELDS: readonly { field: TextField; title: string; placeholder: string }[] = [
  { field: 'title', title: 'Title', placeholder: 'Staff Engineer' },
  { field: 'department', title: 'Department', placeholder: 'Engineering' },
  { field: 'location', title: 'Location', placeholder: 'San Francisco' },
]

interface PersonModalProps {
  organizationId: string
  person: Person
  onClose: () => void
}

/** Edits one person's profile; managers are chosen from the organization's people. */
export function PersonModal({ organizationId, person, onClose }: PersonModalProps) {
  const update = useUpdatePerson(organizationId)
  const [draft, setDraft] = useState<PersonBody>({
    title: person.title,
    department: person.department,
    location: person.location,
    startDate: person.startDate,
    managerMemberId: person.manager?.memberId ?? null,
  })
  const [errors, setErrors] = useState<Partial<Record<keyof PersonBody, string>>>({})
  const [managerSearch, setManagerSearch] = useState('')
  /** The chosen manager's name, kept with the choice: the search results may no longer include them. */
  const [managerName, setManagerName] = useState(person.manager?.name ?? null)
  const candidates = usePeople(
    organizationId,
    useDebounce(managerSearch.trim(), SEARCH_DEBOUNCE_MS),
    ''
  )
  const found = (candidates.data?.pages ?? []).flatMap((page) =>
    page.people.filter((candidate) => candidate.memberId !== person.memberId)
  )
  const managerOptions = [
    { value: NO_MANAGER, label: 'No manager' },
    ...found.map((candidate) => ({
      value: candidate.memberId,
      label: `${candidate.name} (${candidate.email})`,
    })),
  ]
  const managerLabel = (draft.managerMemberId && managerName) || 'No manager'

  const change = <K extends keyof PersonBody>(field: K, value: PersonBody[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    if (update.isError) update.reset()
  }

  const save = () => {
    const parsed = memberProfileFieldsSchema.safeParse(draft)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
        )
      )
      return
    }
    update.mutate({ memberId: person.memberId, body: parsed.data }, { onSuccess: onClose })
  }

  const title = `Edit ${person.name}`
  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && onClose()}
      dismissDisabled={update.isPending}
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        {TEXT_FIELDS.map(({ field, title: label, placeholder }) => (
          <ChipModalField
            key={field}
            type='input'
            disabled={update.isPending}
            title={label}
            placeholder={placeholder}
            maxLength={PROFILE_TEXT_MAX_LENGTH}
            value={draft[field] ?? ''}
            onChange={(value) => change(field, value || null)}
            error={errors[field]}
          />
        ))}
        <ChipModalField type='custom' title='Start date' error={errors.startDate}>
          {() => (
            <div className='flex items-center gap-2'>
              <ChipDatePicker
                value={draft.startDate ?? undefined}
                onChange={(value) => change('startDate', value)}
                placeholder='Not recorded'
                disabled={update.isPending}
                fullWidth
              />
              {draft.startDate && (
                <Chip disabled={update.isPending} onClick={() => change('startDate', null)}>
                  Clear
                </Chip>
              )}
            </div>
          )}
        </ChipModalField>
        <ChipModalField type='custom' title='Manager' error={errors.managerMemberId}>
          {() => (
            <ChipCombobox
              options={managerOptions}
              value={draft.managerMemberId ?? NO_MANAGER}
              onChange={(value) => {
                const manager = found.find((candidate) => candidate.memberId === value)
                setManagerName(manager?.name ?? null)
                change('managerMemberId', manager?.memberId ?? null)
              }}
              overlayContent={managerLabel}
              searchable
              onSearchChange={setManagerSearch}
              searchPlaceholder='Search people...'
              isLoading={candidates.isFetching && !candidates.isFetchingNextPage}
              hasMore={candidates.hasNextPage}
              isLoadingMore={candidates.isFetchingNextPage}
              onLoadMore={() => void candidates.fetchNextPage()}
              emptyMessage='No one matches'
              disabled={update.isPending}
              className='w-full'
            />
          )}
        </ChipModalField>
        <ChipModalError>{update.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: update.isPending ? 'Saving' : 'Save',
          disabled: update.isPending,
          onClick: save,
        }}
      />
    </ChipModal>
  )
}
