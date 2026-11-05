'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ActionRow,
  LoadingState,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/sections/access-control/permission-rows.module.css'
import {
  Button,
  Checkbox,
  FailureNotice,
  Modal,
  SearchField,
} from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { useOrganizationRoster } from '@/platform/lib/data/access-control'

interface AddMembersModalProps {
  organizationId: string
  existingUserIds: readonly string[]
  onClose: () => void
  onAdd: (userIds: string[]) => Promise<void>
  isAdding: boolean
}

/** External members cannot join a permission group, and current members are not offered again. */
export function AddMembersModal({
  organizationId,
  existingUserIds,
  onClose,
  onAdd,
  isAdding,
}: AddMembersModalProps) {
  const {
    data: roster,
    isPending,
    error,
    isFetching,
    refetch,
  } = useOrganizationRoster(organizationId)
  const scrollRef = useScrollEdges<HTMLDivElement>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const existing = new Set(existingUserIds)
  const available = (roster?.members ?? []).filter(
    (member) => member.role !== 'external' && !existing.has(member.userId)
  )
  const query = search.trim().toLowerCase()
  const filtered = query
    ? available.filter(
        (member) =>
          (member.name ?? '').toLowerCase().includes(query) ||
          member.email.toLowerCase().includes(query)
      )
    : available
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((member) => selected.has(member.userId))

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current)
      for (const member of filtered) {
        if (allFilteredSelected) next.delete(member.userId)
        else next.add(member.userId)
      }
      return next
    })
  }

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Add members'
      confirmLabel={isAdding ? 'Adding…' : 'Add members'}
      confirmDisabled={selected.size === 0}
      onConfirm={() => onAdd([...selected])}
    >
      {isPending ? (
        <LoadingState label='Loading members…' />
      ) : roster === undefined ? (
        <FailureNotice
          message={getErrorMessage(error, 'Failed to load members')}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : available.length === 0 ? (
        <Muted>All organization members are already in this group.</Muted>
      ) : (
        <>
          <SearchField
            label='Search members'
            placeholder='Search members...'
            onValueChange={setSearch}
          />
          <ActionRow>
            <Button size='compact' onClick={toggleAll}>
              {allFilteredSelected ? 'Deselect all' : 'Select all'}
            </Button>
          </ActionRow>
          {filtered.length === 0 ? (
            <Muted>{`No members found matching "${search}"`}</Muted>
          ) : (
            <div ref={scrollRef} className={styles.memberPicker}>
              {filtered.map((member) => (
                <Checkbox
                  key={member.userId}
                  label={member.name || 'Unknown'}
                  description={member.email}
                  checked={selected.has(member.userId)}
                  onCheckedChange={() => toggle(member.userId)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
