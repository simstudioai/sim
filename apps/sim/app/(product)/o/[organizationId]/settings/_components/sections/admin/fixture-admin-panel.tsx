'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { InlineNotice } from '@sim/emcn/status'
import { generateId } from '@sim/utils/id'
import { toast } from '@/lib/toast/sink'
import { AdminPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/admin-panel'
import {
  ADMIN_PAGE_SIZE,
  useDirectorySearch,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/directory-search'
import type {
  AdminConsole,
  AdminExample,
  DirectoryUser,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/model'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'

/** The Admin section on the session's example: every edit stays in the fixture draft. */
export function FixtureAdminPanel({ example }: { example: AdminExample }) {
  const { data: draft, update } = useSettingsFixtureDraft('admin', example)
  const [{ q, offset }] = useDirectorySearch()
  const [viewingAs, setViewingAs] = useState<string>()
  const [notice, setNotice] = useState<{ message: string; failed?: boolean }>()
  const edit = (change: (current: AdminExample) => AdminExample) => update(change)
  const changeUser = (user: DirectoryUser) =>
    edit((current) => ({
      ...current,
      users: current.users.map((row) => (row.id === user.id ? user : row)),
    }))
  const matches = q
    ? draft.users.filter(
        (user) => user.id === q || user.email.toLowerCase().includes(q.toLowerCase())
      )
    : []

  if (viewingAs) {
    return (
      <InlineNotice
        title='Impersonation preview'
        message={`Viewing as ${viewingAs}.`}
        action={
          <Button size='compact' onClick={() => setViewingAs(undefined)}>
            End impersonation
          </Button>
        }
      />
    )
  }

  const admin: AdminConsole = {
    settings: draft,
    retrySettings: () => {},
    savingSetting: false,
    setSuperUserMode: (superUserModeEnabled) =>
      edit((current) => ({ ...current, superUserModeEnabled })),
    setMothershipEnvironment: (mothershipEnvironment) =>
      edit((current) => ({ ...current, mothershipEnvironment })),
    benchmarkAvailable: true,
    importer: {
      placeholders: { workflow: draft.workflows[0]?.id ?? '', target: draft.workspaces[1] ?? '' },
      pending: false,
      blocked: false,
      notice,
      reset: () => setNotice(undefined),
      submit: async ({ workflow, target }) => {
        const source = draft.workflows.find((item) => item.id === workflow.trim())
        if (!source || !draft.workspaces.includes(target.trim())) {
          setNotice({
            message: source ? 'Target workspace not found.' : 'Source workflow not found.',
            failed: true,
          })
          return false
        }
        const copy = { ...source, id: generateId(), workspaceId: target.trim() }
        edit((current) => ({ ...current, workflows: [...current.workflows, copy] }))
        setNotice({
          message: `Workflow imported successfully (new ID: ${copy.id}, ${source.chats} copilot chats imported).`,
        })
        return true
      },
    },
    directory: {
      operatorId: draft.operatorId,
      results: q
        ? { users: matches.slice(offset, offset + ADMIN_PAGE_SIZE), total: matches.length }
        : undefined,
      searching: false,
      recent: draft.recent.flatMap((id) => draft.users.filter((user) => user.id === id)),
      impersonating: false,
      busy: () => false,
      impersonate: (user) => {
        edit((current) => ({
          ...current,
          recent: [user.id, ...current.recent.filter((id) => id !== user.id)].slice(0, 5),
        }))
        setViewingAs(user.email)
      },
      resetPassword: (user) => toast.success(`Password reset requested for ${user.email}.`),
      setRole: async (user, role) => changeUser({ ...user, role }),
      ban: async (user) => changeUser({ ...user, banned: true }),
      unban: (user) => changeUser({ ...user, banned: false }),
      addUser: async (input) => {
        if (draft.users.some((existing) => existing.email.toLowerCase() === input.email))
          throw new Error('A user with this email already exists.')
        edit((current) => ({
          ...current,
          users: [
            ...current.users,
            { id: generateId(), name: input.name, email: input.email, role: 'user', banned: false },
          ],
        }))
        return input.email
      },
    },
  }
  return <AdminPanel console={admin} />
}
