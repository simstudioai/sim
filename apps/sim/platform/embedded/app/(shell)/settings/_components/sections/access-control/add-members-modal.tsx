'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { EmptyState } from '@sim/emcn/empty-state'
import { Modal } from '@sim/emcn/modal'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { errorMessageOr, QueryBoundary } from '@sim/emcn/status/query-boundary'
import {
  ActionRow,
  Muted,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/access-control/permission-rows.module.css'
import { useOrganizationRoster } from '@/platform/embedded/lib/data/access-control'

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
  const { data: roster, error, isFetching, refetch } = useOrganizationRoster(organizationId)
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
      <QueryBoundary
        query={{ data: roster, error, isFetching, refetch }}
        failure={errorMessageOr('Failed to load members')}
        loadingLabel='Loading members…'
        empty={() =>
          available.length === 0 && (
            <EmptyState title='All organization members are already in this group.' />
          )
        }
      >
        {() => (
          <>
            <SectionSearch subject='members' onValueChange={setSearch} />
            <ActionRow>
              <Button size='compact' onClick={toggleAll}>
                {allFilteredSelected ? 'Deselect all' : 'Select all'}
              </Button>
            </ActionRow>
            {filtered.length === 0 ? (
              // A picker's no-match line stays quiet: a block would take over the dialog.
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
      </QueryBoundary>
    </Modal>
  )
}
