'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access.module.css'
import {
  ActionMenu,
  Avatar,
  Button,
  ChoiceMenu,
  EmptyState,
  Modal,
  SearchableSelect,
  SelectField,
  Tooltip,
} from '@/platform/design-system/components'
import { ActivityBody } from '@/platform/design-system/components/activity-row/activity-body'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type {
  CredentialMember,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'

interface CredentialAccessProps {
  credential: IntegrationCredential
  viewer: IntegrationPerson
  people: readonly IntegrationPerson[]
  onChange: (credential: IntegrationCredential) => void
  onLeave: () => void
}

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

export function CredentialAccess({
  credential,
  viewer,
  people,
  onChange,
  onLeave,
}: CredentialAccessProps) {
  const [adding, setAdding] = useState(false)
  const [personId, setPersonId] = useState<string | null>(null)
  const [role, setRole] = useState<CredentialMember['role']>('member')
  const [removing, setRemoving] = useState<CredentialMember | null>(null)
  const members = credential.members.filter((member) => member.status !== 'revoked')
  const active = members.filter((member) => member.status === 'active')
  const existing = new Set(members.map((member) => member.userId))
  const available = people.filter((person) => !existing.has(person.id))
  const admins = active.filter((member) => member.explicitAdmin).length
  const editable = credential.role === 'admin'
  function lockReason(member: CredentialMember) {
    return member.roleSource === 'workspace-admin'
      ? 'Access follows workspace admin permissions.'
      : member.status === 'active' && member.role === 'admin' && member.explicitAdmin && admins <= 1
        ? 'Make someone else an admin before removing or changing this access.'
        : undefined
  }

  function update(member: CredentialMember, role: CredentialMember['role']) {
    if (!editable || lockReason(member)) return
    onChange({
      ...credential,
      role: member.userId === viewer.id ? role : credential.role,
      members: credential.members.map((entry) =>
        entry.id === member.id ? { ...entry, role, explicitAdmin: role === 'admin' } : entry
      ),
    })
  }

  return (
    <section className={styles.section} aria-label='People with access'>
      <div className={styles.heading}>
        <h2 data-type='T093'>
          <CountedLabel label='People with access' count={active.length} />
        </h2>
        {editable && (
          <Button
            variant='quiet'
            size='compact'
            disabled={!available.length}
            onClick={() => setAdding(true)}
          >
            Add people
          </Button>
        )}
      </div>
      {credential.scope.kind === 'workspace' && (
        <p className={styles.detail} data-type='T060'>
          Access is limited to {credential.scope.name} workspace members.
        </p>
      )}
      <ul className={styles.rows}>
        {members.map((member) => {
          const reason = lockReason(member)
          const own = member.userId === viewer.id
          return (
            <li key={member.id} className={styles.row}>
              <ActivityBody leading={<Avatar name={member.name} src={member.src} size='inline' />}>
                <span data-type='T059'>{member.name}</span>
                <span className={styles.detail} data-type='T050'>
                  {member.email ?? (own ? 'You' : 'Organization member')}
                </span>
              </ActivityBody>
              <div className={styles.actions}>
                {member.status === 'pending' ? (
                  <span className={styles.detail} data-type='T060'>
                    Pending
                  </span>
                ) : editable && !reason ? (
                  <ChoiceMenu
                    label={`Role for ${member.name}`}
                    value={member.role === 'admin' ? 'Admin' : 'Member'}
                    options={['Member', 'Admin']}
                    onValueChange={(value) =>
                      update(member, value === 'Admin' ? 'admin' : 'member')
                    }
                  />
                ) : (
                  <Tooltip label={reason ?? 'Only credential admins can change access.'}>
                    <span data-type='T060'>{member.role === 'admin' ? 'Admin' : 'Member'}</span>
                  </Tooltip>
                )}
                {(own || editable) && (
                  <ActionMenu
                    label={`Manage access for ${member.name}`}
                    icon='I108'
                    triggerSize='row'
                    tooltip={false}
                    align='end'
                    actions={[
                      {
                        id: own ? 'leave' : 'remove',
                        label: own ? 'Leave' : 'Remove',
                        destructive: true,
                        disabled: Boolean(reason),
                        onSelect: () => setRemoving(member),
                      },
                    ]}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {!members.length && <EmptyState title='No people have access' />}
      {adding && (
        <Modal
          open
          title='Add people'
          confirmLabel='Add'
          confirmDisabled={!personId}
          onOpenChange={setAdding}
          onConfirm={() => {
            const person = available.find((entry) => entry.id === personId)
            if (!person || !editable) return false
            onChange({
              ...credential,
              members: [
                ...credential.members.filter((member) => member.userId !== person.id),
                {
                  ...person,
                  userId: person.id,
                  role,
                  roleSource: 'explicit',
                  explicitAdmin: role === 'admin',
                  status: 'active',
                },
              ],
            })
            setPersonId(null)
          }}
        >
          <SearchableSelect
            label='Person'
            searchLabel='Search people'
            options={available.map((person) => ({ value: person.id, label: person.name }))}
            value={personId}
            onValueChange={setPersonId}
            placeholder='Choose a person'
          />
          <SelectField
            label='Role'
            options={ROLES}
            value={role}
            onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
          />
        </Modal>
      )}
      {removing && (
        <Modal
          open
          title={removing.userId === viewer.id ? 'Leave credential?' : `Remove ${removing.name}?`}
          description={
            removing.userId === viewer.id
              ? 'You will lose access until an admin adds you back.'
              : 'This person will lose access to this credential.'
          }
          variant='confirm'
          destructive
          confirmLabel={removing.userId === viewer.id ? 'Leave' : 'Remove'}
          onOpenChange={(open) => {
            if (!open) setRemoving(null)
          }}
          onConfirm={() => {
            if (lockReason(removing)) return false
            if (removing.userId === viewer.id) onLeave()
            else if (editable)
              onChange({
                ...credential,
                members: credential.members.map((entry) =>
                  entry.id === removing.id ? { ...entry, status: 'revoked' } : entry
                ),
              })
          }}
        />
      )}
    </section>
  )
}
