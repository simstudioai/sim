'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Modal } from '@sim/emcn/modal'
import { Tooltip } from '@sim/emcn/tooltip'
import { useQueryStates } from 'nuqs'
import styles from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access.module.css'
import {
  CredentialAccessControls,
  CredentialAccessSearch,
} from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access-controls'
import { CredentialInvite } from '@/platform/app/(shell)/integrations/_components/credential-access/credential-invite'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import {
  canShareCredential,
  validCredentialMembers,
} from '@/platform/lib/integrations/credential-access'
import type {
  CredentialMember,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'
import { credentialAccessParams } from '@/platform/lib/integrations/credential-navigation'

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

function roleLabel(member: CredentialMember) {
  if (member.roleSource === 'organization-admin') return 'Organization admin'
  if (member.roleSource === 'workspace-admin') return 'Workspace admin'
  return member.role === 'admin' ? 'Admin' : 'Member'
}

export function CredentialAccess({
  credential,
  viewer,
  people,
  onChange,
  onLeave,
}: CredentialAccessProps) {
  const [view, setView] = useQueryStates(credentialAccessParams)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [removingIds, setRemovingIds] = useState<readonly string[]>([])
  const retained = credential.members.filter((member) => member.status !== 'revoked')
  const members: readonly CredentialMember[] =
    !retained.length &&
    credential.scope.kind === 'personal' &&
    credential.scope.ownerId === viewer.id
      ? [
          {
            ...viewer,
            userId: viewer.id,
            role: 'admin',
            roleSource: 'explicit',
            explicitAdmin: true,
            status: 'active',
          },
        ]
      : retained
  const existing = new Set(members.map((member) => member.userId))
  const available = people.filter((person) => !existing.has(person.id))
  const shareable = canShareCredential(credential)
  const editable = shareable && credential.role === 'admin'
  const admins = members.filter(
    (member) => member.status === 'active' && member.explicitAdmin
  ).length
  const term = view.accessQ.trim().toLowerCase()
  const current = view.accessTab
  const title = current === 'people' ? 'People with access' : 'Pending invitations'
  const visible = members
    .filter(
      (member) =>
        (current === 'people' ? member.status === 'active' : member.status === 'pending') &&
        `${member.name} ${member.email ?? ''}`.toLowerCase().includes(term) &&
        (view.accessRole === 'all' ||
          (view.accessRole.endsWith('-admin')
            ? member.roleSource === view.accessRole
            : member.role === view.accessRole && member.roleSource === 'explicit'))
    )
    .sort((a, b) => (view.accessOrder === 'asc' ? 1 : -1) * a.name.localeCompare(b.name))

  function lockReason(member: CredentialMember) {
    if (!shareable)
      return credential.scope.kind === 'organization-managed'
        ? 'Access is managed by your organization.'
        : 'This credential cannot be shared.'
    if (member.roleSource === 'organization-admin')
      return 'Access is inherited from organization administration.'
    if (member.roleSource === 'workspace-admin')
      return 'Access is inherited from workspace administration.'
    if (member.status === 'active' && member.explicitAdmin && admins <= 1)
      return 'This is the last directly assigned admin. Make someone else an admin first.'
    return undefined
  }

  const selected = visible.filter(
    (member) => selectedIds.includes(member.id) && !lockReason(member)
  )
  const removing = members.filter((member) => removingIds.includes(member.id))
  const ownRemoval = removing.length === 1 && removing[0].userId === viewer.id

  function proposed(ids: readonly string[], role: CredentialMember['role'] | null) {
    const targets = members.filter((member) => ids.includes(member.id))
    if (!targets.length || targets.some((member) => lockReason(member))) return null
    if (!editable && !(role === null && targets.every((member) => member.userId === viewer.id)))
      return null
    const next = credential.members.map((member) =>
      ids.includes(member.id)
        ? role
          ? { ...member, role, explicitAdmin: role === 'admin' }
          : { ...member, status: 'revoked' as const }
        : member
    )
    return validCredentialMembers(credential, next) ? next : null
  }

  function update(ids: readonly string[], role: CredentialMember['role']) {
    const next = proposed(ids, role)
    if (!editable || !next) return
    const own = next.find((member) => member.userId === viewer.id && member.status === 'active')
    onChange({ ...credential, members: next, role: own?.role ?? credential.role })
    setSelectedIds([])
  }

  const selectedKeys = selected.map((member) => member.id)
  return (
    <section className={styles.section} aria-label='Credential access'>
      {editable && (
        <CredentialInvite
          people={available}
          onAdd={(people, role) => {
            const additions = people.filter((person) =>
              available.some((entry) => entry.id === person.id)
            )
            if (!additions.length) return
            const ids = new Set(additions.map((person) => person.id))
            onChange({
              ...credential,
              members: [
                ...credential.members.filter((member) => !ids.has(member.userId)),
                ...additions.map((person) => ({
                  ...person,
                  userId: person.id,
                  role,
                  roleSource: 'explicit' as const,
                  explicitAdmin: role === 'admin',
                  status: 'active' as const,
                })),
              ],
            })
          }}
        />
      )}
      <DataTable
        title={title}
        titleHidden
        rowActions={shareable}
        tabs={{
          label: 'Credential access views',
          items: [
            { id: 'people', label: 'People with access' },
            { id: 'invitations', label: 'Invitations' },
          ],
          current,
          onSelect: (tab) => {
            if (tab === 'people' || tab === 'invitations') {
              setSelectedIds([])
              void setView({ accessTab: tab, accessQ: null, accessRole: null })
            }
          },
        }}
        toolbar={
          <CredentialAccessSearch
            value={view.accessQ}
            onChange={(accessQ) => {
              setSelectedIds([])
              void setView({ accessQ })
            }}
          />
        }
        toolbarEnd={
          <CredentialAccessControls
            view={view}
            onRoleChange={(accessRole) => {
              setSelectedIds([])
              void setView({ accessRole })
            }}
            onOrderChange={(accessOrder) => void setView({ accessOrder })}
          />
        }
        columns={[
          { key: 'person', label: 'Name', kind: 'text', primary: true, width: 'regular' },
          { key: 'email', label: 'Email', kind: 'text', showFrom: 'compact' },
          { key: 'role', label: 'Role', kind: 'status', width: 'compact' },
        ]}
        selection={
          editable
            ? {
                selectedIds: selectedKeys,
                onChange: setSelectedIds,
                rowLabel: (row) => String(row.values.person ?? ''),
                actions: (
                  <>
                    <ActionMenu
                      label='Change access'
                      icon={null}
                      triggerSize='compact'
                      disabled={!selected.length}
                      actions={ROLES.map(({ value, label }) => ({
                        id: value,
                        label,
                        disabled: !proposed(selectedKeys, value),
                        disabledReason: selectedKeys.length
                          ? 'Keep at least one directly assigned admin with access.'
                          : 'Select people to change their access.',
                        onSelect: () => update(selectedKeys, value),
                      }))}
                    />
                    <Button
                      variant='quiet'
                      destructive
                      size='compact'
                      disabled={!proposed(selectedKeys, null)}
                      disabledReason='Keep at least one directly assigned admin with access.'
                      onClick={() => setRemovingIds(selectedKeys)}
                    >
                      {current === 'people' ? 'Remove access' : 'Cancel invitations'}
                    </Button>
                  </>
                ),
              }
            : undefined
        }
        rows={visible.map((member) => {
          const reason = lockReason(member)
          const label = roleLabel(member)
          const own = member.userId === viewer.id
          return {
            id: member.id,
            values: { person: member.name, email: member.email, role: label },
            selectionDisabled: Boolean(reason),
            selectionDisabledReason: reason,
            cells: {
              person: (
                <TableLabel
                  leading={<Avatar name={member.name} src={member.src} size='inline' />}
                  compactDetail={member.email ?? '—'}
                >
                  {member.name}
                </TableLabel>
              ),
              email: <span className={styles.detail}>{member.email ?? '—'}</span>,
              role:
                member.roleSource === 'explicit' ? (
                  <span className={styles.role}>
                    <ChoiceMenu
                      label={`Role for ${member.name}`}
                      value={member.role}
                      options={ROLES}
                      disabled={!editable || Boolean(reason)}
                      disabledReason={reason ?? 'Only credential admins can change access.'}
                      onValueChange={(value) =>
                        update([member.id], value === 'admin' ? 'admin' : 'member')
                      }
                    />
                  </span>
                ) : (
                  <Tooltip label={reason ?? label}>
                    <span className={styles.detail}>{label}</span>
                  </Tooltip>
                ),
            },
            action:
              shareable && (own || editable) ? (
                <ActionMenu
                  label={`Manage access for ${member.name}`}
                  icon='I108'
                  triggerSize='row'
                  tooltip={false}
                  align='end'
                  actions={[
                    {
                      id: own ? 'leave' : 'remove',
                      label: own
                        ? 'Leave'
                        : member.status === 'pending'
                          ? 'Cancel invitation'
                          : 'Remove',
                      destructive: true,
                      disabled: !proposed([member.id], null),
                      disabledReason:
                        reason ?? 'Keep at least one directly assigned admin with access.',
                      onSelect: () => setRemovingIds([member.id]),
                    },
                  ]}
                />
              ) : undefined,
          }
        })}
      />
      {!visible.length && (
        <EmptyState
          title={
            term || view.accessRole !== 'all'
              ? 'No matching people'
              : current === 'people'
                ? 'No people have access'
                : 'No pending invitations'
          }
        />
      )}
      {removing.length > 0 && (
        <Modal
          open
          title={
            ownRemoval
              ? 'Leave credential?'
              : removing.length === 1
                ? `Remove ${removing[0].name}?`
                : `Remove ${removing.length} people?`
          }
          description={
            ownRemoval
              ? 'You will lose access until an admin adds you back.'
              : 'Selected people will lose access to this credential.'
          }
          variant='confirm'
          destructive
          confirmLabel={ownRemoval ? 'Leave' : 'Remove'}
          onOpenChange={(open) => {
            if (!open) setRemovingIds([])
          }}
          onConfirm={() => {
            const next = proposed(removingIds, null)
            if (!next) return false
            if (editable) onChange({ ...credential, members: next })
            if (removing.some((member) => member.userId === viewer.id)) onLeave()
            setSelectedIds([])
            setRemovingIds([])
          }}
        />
      )}
    </section>
  )
}
