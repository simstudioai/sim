'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { Pagination } from '@sim/emcn/pagination'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  ActionRow,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { AddUserDialog } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/add-user-dialog'
import {
  ADMIN_PAGE_SIZE,
  useDirectorySearch,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/directory-search'
import type { AdminConsole, DirectoryUser } from '@/platform/lib/data/admin-model'

type UserAction = 'Ban' | 'Promote' | 'Demote'

interface AdminDirectoryProps {
  directory: AdminConsole['directory']
  onImpersonate: (user: DirectoryUser) => void
}

export function AdminDirectory({ directory, onImpersonate }: AdminDirectoryProps) {
  const [{ q, offset }, setSearch] = useDirectorySearch()
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<{ id: string; action: UserAction }>()
  const [reason, setReason] = useState('')
  const results = q ? directory.results : undefined
  const rows = q ? (results?.users ?? []) : directory.recent
  const pendingUser = rows.find((user) => user.id === pending?.id)
  const pages = Math.ceil((results?.total ?? 0) / ADMIN_PAGE_SIZE)
  const page = Math.floor(offset / ADMIN_PAGE_SIZE) + 1

  function confirmAction() {
    if (!pendingUser || !pending) return
    if (pending.action === 'Ban') return directory.ban(pendingUser, reason.trim())
    return directory.setRole(pendingUser, pending.action === 'Promote' ? 'admin' : 'user')
  }
  const action = pending?.action
  const userRows = rows.map((user) => {
    const busy = directory.busy(user.id)
    return (
      <SettingsRow key={user.id} label={user.name || '—'} description={user.email}>
        <ActionRow>
          <StatusTag
            label={user.role === 'admin' ? 'Admin' : 'User'}
            intent={user.role === 'admin' ? 'info' : 'neutral'}
          />
          {user.banned && <StatusTag label='Banned' intent='danger' />}
          {user.id !== directory.operatorId && (
            <>
              <Button
                size='compact'
                disabled={directory.impersonating || busy}
                onClick={() => onImpersonate(user)}
              >
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
                    disabled: busy,
                    onSelect: () => directory.resetPassword(user),
                  },
                  {
                    id: 'role',
                    label: user.role === 'admin' ? 'Demote' : 'Promote',
                    destructive: user.role === 'admin',
                    disabled: busy,
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
                        disabled: busy,
                        onSelect: () => directory.unban(user),
                      }
                    : {
                        id: 'ban',
                        label: 'Ban',
                        separatorBefore: true,
                        destructive: true,
                        disabled: busy,
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
    )
  })
  return (
    <SectionStack>
      <DirectorySearch
        key={q}
        initial={q}
        searching={directory.searching}
        onSearch={(term) => void setSearch({ q: term || null, offset: null })}
        onAdd={() => setAdding(true)}
      />
      {directory.warning && <InlineNotice intent='warning' message={directory.warning} />}
      {q ? (
        directory.error ? (
          <FailureNotice
            message={directory.error}
            retrying={directory.searching}
            onRetry={directory.retry}
          />
        ) : (
          results && (
            <SettingsList
              title='Users'
              empty={rows.length === 0 ? { title: 'No matching users' } : undefined}
            >
              {userRows}
            </SettingsList>
          )
        )
      ) : (
        rows.length > 0 && <SettingsList title='Recently impersonated'>{userRows}</SettingsList>
      )}
      {q && pages > 1 && (
        <Pagination
          label='User search pages'
          page={page}
          pageCount={pages}
          disabled={directory.searching}
          onPageChange={(next) => void setSearch({ offset: (next - 1) * ADMIN_PAGE_SIZE })}
        />
      )}
      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onAdd={async (input) => {
            const email = await directory.addUser(input)
            void setSearch({ q: email, offset: null })
          }}
        />
      )}
      {pending && pendingUser && (
        <Modal
          variant={action === 'Ban' ? 'form' : 'confirm'}
          open
          onOpenChange={(open) => {
            if (!open) setPending(undefined)
          }}
          title={`${action} ${pendingUser.name || pendingUser.email}`}
          description={
            action === 'Ban'
              ? `Banning ${pendingUser.email} signs them out everywhere and blocks them from signing back in. You can unban them later`
              : action === 'Demote'
                ? `Demoting ${pendingUser.email} removes their platform admin access.`
                : `Promoting ${pendingUser.email} grants full platform admin access, including impersonating any user`
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
    </SectionStack>
  )
}

interface DirectorySearchProps {
  initial: string
  searching: boolean
  onSearch: (term: string) => void
  onAdd: () => void
}

function DirectorySearch({ initial, searching, onSearch, onAdd }: DirectorySearchProps) {
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
        <Button size='compact' submit variant='primary' disabled={searching}>
          Search
        </Button>
        <Button size='compact' onClick={onAdd}>
          Add user
        </Button>
      </SectionToolbar>
    </form>
  )
}
