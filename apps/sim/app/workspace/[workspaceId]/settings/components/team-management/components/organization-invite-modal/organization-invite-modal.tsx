'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  ChipDropdown,
  type ChipDropdownOption,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
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
  /** Emails that already belong to the organization (rejected as duplicates). */
  existingEmails?: string[]
}

/**
 * Organization-level invite modal: enter emails, pick one or more workspaces to
 * grant access to, choose a role applied to every selected workspace, and send
 * through the organization invite path.
 */
export function OrganizationInviteModal({
  open,
  onOpenChange,
  organizationId,
  workspaces,
  existingEmails = [],
}: OrganizationInviteModalProps) {
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

  const existingEmailSet = useMemo(
    () => new Set(existingEmails.map((email) => email.toLowerCase())),
    [existingEmails]
  )

  const validateEmail = useCallback(
    (email: string): string | null => {
      if (session?.user?.email && session.user.email.toLowerCase() === email) {
        return 'You cannot invite yourself'
      }
      if (existingEmailSet.has(email)) {
        return `${email} is already in this organization`
      }
      return null
    },
    [session?.user?.email, existingEmailSet]
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
        onSuccess: () => {
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
      <ChipModalHeader onClose={() => handleOpenChange(false)}>Invite teammates</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title='Emails'
          value={emails}
          onChange={handleEmailsChange}
          validate={validateEmail}
          error={errorMessage}
          placeholder='Enter emails'
          disabled={isSubmitting}
        />
        <ChipModalField type='custom' title='Workspaces'>
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
          title='Invite as'
          options={ROLE_OPTIONS}
          value={inviteRole}
          placeholder='Select role'
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
