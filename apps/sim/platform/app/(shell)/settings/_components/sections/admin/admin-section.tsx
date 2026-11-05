'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  ActionMenu,
  Button,
  Chip,
  DataTable,
  EmptyState,
  InlineNotice,
  Modal,
  Pagination,
  SearchField,
  SecretField,
  SelectField,
  StatusTag,
  Switch,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  ADMIN_PAGE_SIZE,
  type AdminUser,
  EMAIL_STATUS_OPTIONS,
  MOTHERSHIP_ENV_OPTIONS,
  type MothershipEnvironment,
  PASSWORD_MODE_OPTIONS,
  type PasswordMode,
  useAddUserForm,
  useAdminConsole,
} from '@/platform/lib/data/admin'

const USER_COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'email', label: 'Email', kind: 'text' },
  { key: 'role', label: 'Role', kind: 'status' },
  { key: 'status', label: 'Status', kind: 'status' },
] as const

export default function AdminSection() {
  useCaptureWhenReady('settings_tab_viewed', { plane: 'account', section: 'admin' }, 'admin')
  const admin = useAdminConsole()
  const { settings, importWorkflow, usersData, searchQuery, pendingUserIds } = admin
  const superUser = settings?.superUserModeEnabled ?? false

  const userRows = (users: readonly AdminUser[]) =>
    users.map((user) => ({
      id: user.id,
      values: {
        name: user.name || '—',
        email: user.email,
        role: user.role || 'user',
        status: user.banned ? 'Banned' : 'Active',
      },
      cells: {
        role: (
          <StatusTag
            label={user.role || 'user'}
            intent={user.role === 'admin' ? 'info' : 'neutral'}
          />
        ),
        status: user.banned ? (
          <StatusTag label='Banned' intent='danger' />
        ) : (
          <StatusTag label='Active' intent='success' />
        ),
      },
      action:
        user.id === admin.session?.user?.id ? undefined : (
          <ActionRow>
            <Button
              size='compact'
              disabled={
                importWorkflow.isPending || admin.isImpersonating || pendingUserIds.has(user.id)
              }
              onClick={() => admin.handleImpersonate(user.id, user.email)}
            >
              {admin.impersonatingUserId === user.id ? 'Switching…' : 'Impersonate'}
            </Button>
            <ActionMenu
              label={`${user.email} actions`}
              icon='I108'
              actions={[
                {
                  id: 'reset',
                  label: 'Reset password',
                  disabled: pendingUserIds.has(user.id),
                  onSelect: () => admin.sendReset(user),
                },
                {
                  id: 'role',
                  label: user.role === 'admin' ? 'Demote' : 'Promote',
                  disabled: pendingUserIds.has(user.id),
                  onSelect: () => admin.startRoleChange(user),
                },
                user.banned
                  ? {
                      id: 'unban',
                      label: 'Unban',
                      disabled: pendingUserIds.has(user.id),
                      onSelect: () => admin.unbanUser.mutate({ userId: user.id }),
                    }
                  : {
                      id: 'ban',
                      label: 'Ban',
                      destructive: true,
                      separatorBefore: true,
                      disabled: pendingUserIds.has(user.id),
                      onSelect: () => admin.startBan(user),
                    },
              ]}
            />
          </ActionRow>
        ),
    }))

  const actionError =
    admin.impersonationGuardError ??
    (admin.unbanUser.error || admin.impersonateUser.error
      ? ((admin.unbanUser.error ?? admin.impersonateUser.error)?.message ??
        'Action failed. Try again.')
      : null)
  const pendingEmail = admin.pendingUser?.email ?? 'this user'

  return (
    <SectionStack>
      <SettingsSection title='Platform'>
        <SettingsRow label='Super admin mode'>
          <Switch
            label='Super admin mode'
            checked={superUser}
            disabled={admin.updateSetting.isPending}
            onCheckedChange={(checked) => void admin.handleSuperUserModeToggle(checked)}
          />
        </SettingsRow>
        {superUser && admin.benchmarkAvailability.data?.available && (
          <SettingsRow label='Benchmarks'>
            <Chip href='/benchmark'>Open benchmarks</Chip>
          </SettingsRow>
        )}
        {superUser && (
          <SettingsRow
            label='Mothership environment'
            description='Default uses the configured Sim agent URL.'
            field
          >
            <SelectField
              label='Mothership environment'
              value={settings?.mothershipEnvironment ?? 'default'}
              options={MOTHERSHIP_ENV_OPTIONS}
              disabled={admin.updateSetting.isPending}
              onValueChange={(value) =>
                void admin.handleMothershipEnvironmentChange(value as MothershipEnvironment)
              }
            />
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title='Import workflow'>
        <FieldStack>
          <Muted>Import a workflow and its copilot chats into a target workspace.</Muted>
          <TextField
            label='Source workflow ID'
            placeholder='Source workflow ID'
            value={admin.workflowId}
            disabled={importWorkflow.isPending || admin.isImpersonating}
            onChange={(value) => {
              admin.setWorkflowId(value)
              importWorkflow.reset()
            }}
          />
          <TextField
            label='Target workspace ID'
            placeholder='Target workspace ID'
            value={admin.targetWorkspaceId}
            disabled={importWorkflow.isPending || admin.isImpersonating}
            onChange={(value) => {
              admin.setTargetWorkspaceId(value)
              importWorkflow.reset()
            }}
          />
          <ActionRow>
            <Button
              variant='primary'
              size='compact'
              disabled={
                importWorkflow.isPending ||
                admin.isImpersonating ||
                !admin.workflowId.trim() ||
                !admin.targetWorkspaceId.trim()
              }
              onClick={admin.handleImport}
            >
              {importWorkflow.isPending ? 'Importing…' : 'Import'}
            </Button>
          </ActionRow>
          {importWorkflow.error && (
            <InlineNotice intent='danger' message={importWorkflow.error.message} />
          )}
          {importWorkflow.isSuccess && (
            <InlineNotice
              intent='success'
              message={`Workflow imported (new ID: ${importWorkflow.data.newWorkflowId}, ${importWorkflow.data.copilotChatsImported ?? 0} copilot chats imported)`}
            />
          )}
        </FieldStack>
      </SettingsSection>

      <SettingsSection title='User management'>
        <FieldStack>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              admin.handleSearch()
            }}
          >
            <ActionRow>
              <SearchField
                label='Search users'
                placeholder='Search by email or paste a user ID…'
                value={admin.searchInput}
                onValueChange={admin.setSearchInput}
              />
              <Button size='compact' submit disabled={admin.usersLoading}>
                {admin.usersLoading ? 'Searching…' : 'Search'}
              </Button>
              <Button size='compact' icon='I074' onClick={() => admin.setIsAddUserOpen(true)}>
                Add user
              </Button>
            </ActionRow>
          </form>
          {admin.usersError && (
            <InlineNotice
              intent='danger'
              message={getErrorMessage(admin.usersError, 'Failed to fetch users')}
            />
          )}
          {actionError && <InlineNotice intent='danger' message={actionError} />}
          {admin.provisionWarning && (
            <InlineNotice intent='warning' message={admin.provisionWarning} />
          )}
          {admin.sendPasswordReset.isPending && admin.sendPasswordReset.variables && (
            <Muted>
              {`Sending a password reset email to ${admin.sendPasswordReset.variables.email}...`}
            </Muted>
          )}
          {searchQuery.length > 0 && usersData ? (
            <>
              {usersData.users.length === 0 ? (
                <EmptyState title='No users found.' />
              ) : (
                <DataTable
                  title='Users'
                  titleHidden
                  columns={USER_COLUMNS}
                  rows={userRows(usersData.users)}
                />
              )}
              {admin.totalPages > 1 && (
                <>
                  <Muted>
                    {`Page ${admin.currentPage} of ${admin.totalPages} (${usersData.total} users)`}
                  </Muted>
                  <Pagination
                    label='Users pages'
                    page={admin.currentPage}
                    pageCount={admin.totalPages}
                    disabled={admin.usersLoading}
                    onPageChange={(page) =>
                      void admin.setAdminParams({ offset: (page - 1) * ADMIN_PAGE_SIZE })
                    }
                  />
                </>
              )}
            </>
          ) : (
            searchQuery.length === 0 &&
            admin.recentUsers &&
            admin.recentUsers.length > 0 && (
              <DataTable
                title='Recently impersonated'
                columns={USER_COLUMNS}
                rows={userRows(admin.recentUsers)}
              />
            )
          )}
        </FieldStack>
      </SettingsSection>

      {admin.pendingAction?.type === 'ban' && (
        <Modal
          open
          variant='confirm'
          destructive
          onOpenChange={(open) => {
            if (!open) admin.closePendingAction()
          }}
          title='Ban user'
          confirmLabel={admin.banUser.isPending ? 'Banning…' : 'Ban'}
          confirmDisabled={admin.banUser.isPending}
          pending={admin.banUser.isPending}
          onConfirm={() => {
            admin.handleConfirmBan()
            return false
          }}
        >
          <Muted>
            {`Banning ${pendingEmail} signs them out everywhere and blocks them from signing back in. You can unban them later.`}
          </Muted>
          <TextField
            label='Reason'
            placeholder='Optional'
            value={admin.banReason}
            disabled={admin.banUser.isPending}
            onChange={admin.setBanReason}
          />
          {admin.banUser.error && (
            <InlineNotice intent='danger' message={admin.banUser.error.message} />
          )}
        </Modal>
      )}
      {admin.pendingAction?.type === 'role' && (
        <Modal
          open
          variant='confirm'
          destructive={admin.isDemotion}
          onOpenChange={(open) => {
            if (!open) admin.closePendingAction()
          }}
          title={admin.isDemotion ? 'Demote user' : 'Promote user'}
          confirmLabel={
            admin.setUserRole.isPending
              ? admin.isDemotion
                ? 'Demoting…'
                : 'Promoting…'
              : admin.isDemotion
                ? 'Demote'
                : 'Promote'
          }
          confirmDisabled={admin.setUserRole.isPending}
          pending={admin.setUserRole.isPending}
          onConfirm={() => {
            admin.handleConfirmRoleChange()
            return false
          }}
        >
          <Muted>
            {admin.isDemotion
              ? `Demoting ${pendingEmail} revokes their platform admin access.`
              : `Promoting ${pendingEmail} grants full platform admin access, including impersonating any user.`}
          </Muted>
          {admin.setUserRole.error && (
            <InlineNotice intent='danger' message={admin.setUserRole.error.message} />
          )}
        </Modal>
      )}
      {admin.isAddUserOpen && (
        <AddUserModal
          onClose={() => admin.setIsAddUserOpen(false)}
          onCreated={admin.handleUserCreated}
        />
      )}
    </SectionStack>
  )
}

interface AddUserModalProps {
  onClose: () => void
  onCreated: (user: AdminUser, resetEmailError?: string) => void
}

function AddUserModal({ onClose, onCreated }: AddUserModalProps) {
  const form = useAddUserForm({
    onOpenChange: (open) => {
      if (!open) onClose()
    },
    onCreated,
  })
  const { addUser, isSubmissionPending } = form
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) form.handleClose()
      }}
      title='Add user'
      confirmLabel={isSubmissionPending ? 'Adding…' : 'Add user'}
      confirmDisabled={!form.canSubmit}
      pending={isSubmissionPending}
      onConfirm={() => {
        form.handleAddUser()
        return false
      }}
    >
      <TextField
        label='Name'
        placeholder='Canary Writer'
        maxLength={100}
        autoComplete='off'
        required
        value={form.name}
        error={form.nameError}
        disabled={isSubmissionPending}
        onChange={(value) => {
          form.setName(value)
          addUser.reset()
        }}
      />
      <TextField
        label='Email'
        type='email'
        placeholder='writer@synthetics.example.com'
        autoComplete='off'
        required
        value={form.email}
        error={form.emailError}
        disabled={isSubmissionPending}
        onChange={(value) => {
          form.setEmail(value)
          addUser.reset()
        }}
      />
      <SelectField
        label='Credentials'
        value={form.passwordMode}
        options={PASSWORD_MODE_OPTIONS}
        hint={
          form.setsPassword
            ? undefined
            : 'They pick their own password from the emailed reset link.'
        }
        disabled={isSubmissionPending}
        onValueChange={(value) => {
          form.setPasswordMode(value as PasswordMode)
          addUser.reset()
        }}
      />
      {form.setsPassword && (
        <SecretField
          label='Password'
          placeholder='At least 8 characters'
          autoComplete='new-password'
          required
          value={form.password}
          error={form.passwordError}
          disabled={isSubmissionPending}
          onChange={(value) => {
            form.setPassword(value)
            addUser.reset()
          }}
        />
      )}
      <SelectField
        label='Email status'
        value={form.emailVerified ? 'verified' : 'unverified'}
        options={EMAIL_STATUS_OPTIONS}
        hint='Verified users can sign in when email verification is required.'
        disabled={isSubmissionPending}
        onValueChange={(value) => {
          form.setEmailVerified(value === 'verified')
          addUser.reset()
        }}
      />
      {addUser.error && (
        <InlineNotice
          intent='danger'
          message={getErrorMessage(addUser.error, 'Failed to add user')}
        />
      )}
    </Modal>
  )
}
