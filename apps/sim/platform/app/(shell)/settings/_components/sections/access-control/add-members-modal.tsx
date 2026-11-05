'use client'

import { useState } from 'react'
import { Muted } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/sections/access-control/permission-rows.module.css'
import { Button, Checkbox, Modal, SearchField } from '@/platform/design-system/components'
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
  const { data: roster } = useOrganizationRoster(organizationId)
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
      title='Add Members'
      confirmLabel={isAdding ? 'Adding…' : 'Add Members'}
      confirmDisabled={selected.size === 0 || isAdding}
      onConfirm={() => onAdd([...selected])}
    >
      {available.length === 0 ? (
        <Muted>All organization members are already in this group.</Muted>
      ) : (
        <>
          <SearchField
            label='Search members'
            placeholder='Search members...'
            onValueChange={setSearch}
          />
          <Button size='compact' onClick={toggleAll}>
            {allFilteredSelected ? 'Deselect All' : 'Select All'}
          </Button>
          {filtered.length === 0 ? (
            <Muted>{`No members found matching "${search}"`}</Muted>
          ) : (
            <div className={styles.memberPicker}>
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
