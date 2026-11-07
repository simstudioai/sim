'use client'

import { useState } from 'react'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { AddUserDialog } from '@/platform/app/(shell)/settings/_components/sections/admin/add-user-dialog'
import type {
  AdminExample,
  DirectoryUser,
} from '@/platform/app/(shell)/settings/_components/sections/admin/model'
import {
  ActionMenu,
  Button,
  EmptyState,
  Modal,
  Pagination,
  SearchField,
  StatusTag,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { toast } from '@/platform/shared/toast'

const SEARCH_PARAMS = {
  q: parseAsString.withDefault(''),
  offset: parseAsInteger.withDefault(0),
} as const
const PAGE_SIZE = 20
type UserAction = 'Ban' | 'Promote' | 'Demote'

interface AdminDirectoryProps {
  example: AdminExample | null
  onEdit: (next: AdminExample) => void
  onImpersonate: (user: DirectoryUser) => void
  manageHref: string
}

export function AdminDirectory({
  example,
  onEdit,
  onImpersonate,
  manageHref,
}: AdminDirectoryProps) {
  const [{ q, offset }, setSearch] = useQueryStates(SEARCH_PARAMS, {
    history: 'replace',
    clearOnDefault: true,
  })
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<{ id: string; action: UserAction }>()
  const [reason, setReason] = useState('')
  const pendingUser = example?.users.find((user) => user.id === pending?.id)
  const results =
    q && example
      ? example.users.filter(
          (user) => user.id === q || user.email.toLowerCase().includes(q.toLowerCase())
        )
      : []
  const pages = Math.ceil(results.length / PAGE_SIZE)
  const page = Math.min(Math.max(1, Math.floor(offset / PAGE_SIZE) + 1), Math.max(1, pages))
  const rows = q
    ? results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : (example?.recent.flatMap((id) => example.users.filter((user) => user.id === id)) ?? [])

  function changeUser(user: DirectoryUser) {
    if (example)
      onEdit({ ...example, users: example.users.map((row) => (row.id === user.id ? user : row)) })
  }
  function addUser(user: DirectoryUser) {
    if (!example) return
    if (example.users.some((existing) => existing.email.toLowerCase() === user.email))
      throw new Error('A user with this email already exists.')
    onEdit({ ...example, users: [...example.users, user] })
    void setSearch({ q: user.email, offset: 0 })
  }
  function confirmAction() {
    if (!pendingUser || !pending) return
    if (pending.action === 'Ban')
      changeUser({ ...pendingUser, banned: true, banReason: reason.trim() })
    else changeUser({ ...pendingUser, role: pending.action === 'Promote' ? 'admin' : 'user' })
  }
  const action = pending?.action
  return (
    <SettingsSection title='User management'>
      <FieldStack>
        <DirectorySearch
          key={q}
          initial={q}
          onSearch={(term) => {
            if (example) void setSearch({ q: term, offset: 0 })
            else {
              const destination = new URL(manageHref)
              if (term) destination.searchParams.set('q', term)
              window.location.assign(destination.href)
            }
          }}
          onAdd={example ? () => setAdding(true) : undefined}
          manageHref={manageHref}
        />
        {example && (
          <>
            {q && rows.length === 0 && <EmptyState title='No users found.' />}
            {rows.length > 0 && (
              <div>
                {!q && <Muted>Recently impersonated</Muted>}
                {rows.map((user) => (
                  <SettingsRow
                    key={user.id}
                    field
                    label={user.name || '—'}
                    description={user.email}
                  >
                    <ActionRow>
                      <StatusTag
                        label={user.role}
                        intent={user.role === 'admin' ? 'info' : 'neutral'}
                      />
                      <StatusTag
                        label={user.banned ? 'Banned' : 'Active'}
                        intent={user.banned ? 'danger' : 'success'}
                      />
                      {user.id !== example.operatorId && (
                        <>
                          <Button size='compact' onClick={() => onImpersonate(user)}>
                            Impersonate
                          </Button>
                          <ActionMenu
                            label={`${user.email} actions`}
                            icon='I108'
                            align='end'
                            actions={[
                              {
                                id: 'reset',
                                label: 'Reset password',
                                onSelect: () =>
                                  toast.success(`Password reset requested for ${user.email}.`),
                              },
                              {
                                id: 'role',
                                label: user.role === 'admin' ? 'Demote' : 'Promote',
                                onSelect: () =>
                                  setPending({
                                    id: user.id,
                                    action: user.role === 'admin' ? 'Demote' : 'Promote',
                                  }),
                              },
                              user.banned
                                ? {
                                    id: 'unban',
                                    label: 'Unban',
                                    onSelect: () =>
                                      changeUser({ ...user, banned: false, banReason: undefined }),
                                  }
                                : {
                                    id: 'ban',
                                    label: 'Ban',
                                    separatorBefore: true,
                                    destructive: true,
                                    onSelect: () => {
                                      setReason('')
                                      setPending({ id: user.id, action: 'Ban' })
                                    },
                                  },
                            ]}
                          />
                        </>
                      )}
                    </ActionRow>
                  </SettingsRow>
                ))}
              </div>
            )}
            {pages > 1 && (
              <Pagination
                label='User search pages'
                page={page}
                pageCount={pages}
                onPageChange={(next) => void setSearch({ offset: (next - 1) * PAGE_SIZE })}
              />
            )}
          </>
        )}
      </FieldStack>
      {adding && <AddUserDialog onClose={() => setAdding(false)} onAdd={addUser} />}
      {pending && pendingUser && (
        <Modal
          variant={action === 'Ban' ? 'form' : 'confirm'}
          open
          onOpenChange={(open) => {
            if (!open) setPending(undefined)
          }}
          title={`${action} user`}
          description={
            action === 'Ban'
              ? `Banning ${pendingUser.email} signs them out everywhere and blocks them from signing back in. You can unban them later.`
              : action === 'Demote'
                ? `Demoting ${pendingUser.email} removes their platform admin access.`
                : `Promoting ${pendingUser.email} grants full platform admin access, including impersonating any user.`
          }
          confirmLabel={pending.action}
          destructive={action !== 'Promote'}
          onConfirm={confirmAction}
        >
          {action === 'Ban' && (
            <TextField
              placeholder='Add a reason'
              label='Reason'
              optional
              value={reason}
              onChange={setReason}
            />
          )}
        </Modal>
      )}
    </SettingsSection>
  )
}

interface DirectorySearchProps {
  initial: string
  onSearch: (term: string) => void
  onAdd?: () => void
  manageHref: string
}

function DirectorySearch({ initial, onSearch, onAdd, manageHref }: DirectorySearchProps) {
  const [input, setInput] = useState(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSearch(input.trim())
      }}
    >
      <SectionToolbar
        grow={
          <SearchField
            label='Search users'
            placeholder='Search by email or paste a user ID…'
            value={input}
            onValueChange={setInput}
          />
        }
      >
        <Button size='compact' submit variant='primary'>
          Search
        </Button>
        <Button
          size='compact'
          render={onAdd ? undefined : <a href={manageHref}>Manage users</a>}
          onClick={onAdd}
        >
          {onAdd ? 'Add user' : 'Manage users'}
        </Button>
      </SectionToolbar>
    </form>
  )
}
