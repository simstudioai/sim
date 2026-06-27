'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useTranslations } from 'next-intl'
import {
  ChipDropdown,
  type ChipDropdownOption,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { useInviteMember } from '@/hooks/queries/organization'

const logger = createLogger('OrganizationInviteModal')

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'write', label: 'Write' },
  { value: 'read', label: 'Read' },
] as const

interface OrganizationInviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  /** Workspaces the inviter can grant access to. */
  workspaces: Array<{ id: string; name: string }>
  /** Emails of external collaborators (rejected — they cannot join the organization). */
  externalEmails?: string[]
  /**
   * Non-member emails with a pending invitation (rejected as duplicates).
   * Member emails are always allowed — they receive workspace invitations for
   * the selected workspaces they aren't in yet, deduped per workspace by the
   * server — so the parent excludes them from this list.
   */
  pendingEmails?: string[]
}

/**
 * Organization-level invite modal: enter emails, pick one or more workspaces to
 * grant access to, choose a role applied to every selected workspace, and send
 * through the organization invite path. Emails of existing organization
 * members are accepted — the server sends them workspace-only invitations for
 * the selected workspaces they don't already have access to.
 */
export function OrganizationInviteModal({
  open,
  onOpenChange,
  organizationId,
  workspaces,
  externalEmails = [],
  pendingEmails = [],
}: OrganizationInviteModalProps) {
  const t = useTranslations('auto')
  const [emails, setEmails] = useState<string[]>([])
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([])
  const [inviteRole, setInviteRole] = useState<PermissionType>('write')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data: session } = useSession()
  const inviteMember = useInviteMember()
  const isSubmitting = inviteMember.isPending

  const workspaceOptions = useMemo<ChipDropdownOption[]>(
    () => workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
    [workspaces]
  )

  const externalEmailSet = useMemo(
    () => new Set(externalEmails.map((email) => email.toLowerCase())),
    [externalEmails]
  )

  const pendingEmailSet = useMemo(
    () => new Set(pendingEmails.map((email) => email.toLowerCase())),
    [pendingEmails]
  )

  const validateEmail = useCallback(
    (email: string): string | null => {
      if (session?.user?.email && session.user.email.toLowerCase() === email) {
        return 'You cannot invite yourself'
      }
      if (externalEmailSet.has(email)) {
        return `${email} belongs to another organization and can't be invited. Invite them to individual workspaces from the Teammates tab.`
      }
      if (pendingEmailSet.has(email)) {
        return `${email} already has a pending invitation`
      }
      return null
    },
    [session?.user?.email, externalEmailSet, pendingEmailSet]
  )

  const handleEmailsChange = useCallback((next: string[]) => {
    setEmails(next)
    setErrorMessage(null)
  }, [])

  const handleSend = useCallback(() => {
    setErrorMessage(null)
    if (emails.length === 0 || selectedWorkspaceIds.length === 0 || !organizationId) return

    const workspaceInvitations = selectedWorkspaceIds.map((workspaceId) => ({
      workspaceId,
      permission: inviteRole as 'admin' | 'write' | 'read',
    }))

    inviteMember.mutate(
      { emails, orgId: organizationId, workspaceInvitations },
      {
        onSuccess: (result) => {
          const summary =
            'data' in result && result.data && typeof result.data === 'object'
              ? (result.data as {
                  invitationsSent?: number
                  directlyAddedCount?: number
                  failedInvitations?: Array<{ email: string; error: string }>
                })
              : null
          const addedCount = summary?.directlyAddedCount ?? 0
          const sentCount = summary?.invitationsSent ?? 0
          const failed = summary?.failedInvitations ?? []

          // Surface partial successes even when some addresses fail.
          const parts: string[] = []
          if (addedCount > 0) {
            parts.push(`${addedCount} member${addedCount === 1 ? '' : 's'} added`)
          }
          if (sentCount > 0) {
            parts.push(`${sentCount} invite${sentCount === 1 ? '' : 's'} sent`)
          }
          if (parts.length > 0) {
            toast.success(parts.join(' · '))
          }

          if (failed.length > 0) {
            // Keep only the failed addresses (workspaces stay selected) for retry.
            setEmails(failed.map((entry) => entry.email))
            setErrorMessage(
              failed.length === 1
                ? failed[0].error
                : `${failed.length} invitations failed. ${failed[0].error}`
            )
            return
          }

          setEmails([])
          setSelectedWorkspaceIds([])
          onOpenChange(false)
        },
        onError: (error) => {
          logger.error('Failed to invite members', { error })
          setErrorMessage(error.message || 'An unexpected error occurred. Please try again.')
        },
      }
    )
  }, [emails, selectedWorkspaceIds, organizationId, inviteRole, inviteMember, onOpenChange])

  const resetState = useCallback(() => {
    setEmails([])
    setSelectedWorkspaceIds([])
    setInviteRole('write')
    setErrorMessage(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetState()
      onOpenChange(next)
    },
    [onOpenChange, resetState]
  )

  const isSendDisabled =
    isSubmitting || emails.length === 0 || selectedWorkspaceIds.length === 0 || !organizationId

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      srTitle='Invite teammates to organization'
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>
        {t('invite_teammates')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title={t('emails')}
          value={emails}
          onChange={handleEmailsChange}
          validate={validateEmail}
          error={errorMessage}
          placeholder={t('enter_emails')}
          disabled={isSubmitting}
        />
        <ChipModalField type='custom' title={t('workspaces')}>
          <ChipDropdown
            multiple
            value={selectedWorkspaceIds}
            onChange={setSelectedWorkspaceIds}
            options={workspaceOptions}
            allLabel='Select workspaces'
            showAllOption={false}
            searchable
            searchPlaceholder='Search workspaces...'
            fullWidth
            flush
            disabled={isSubmitting || workspaceOptions.length === 0}
          />
        </ChipModalField>
        <ChipModalField
          type='dropdown'
          title={t('invite_as')}
          options={ROLE_OPTIONS}
          value={inviteRole}
          placeholder={t('select_role')}
          align='start'
          onChange={(role) => setInviteRole(role as PermissionType)}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleOpenChange(false)}
        primaryAction={{
          label: isSubmitting ? 'Sending...' : 'Send invites',
          onClick: handleSend,
          disabled: isSendDisabled,
        }}
      />
    </ChipModal>
  )
}
