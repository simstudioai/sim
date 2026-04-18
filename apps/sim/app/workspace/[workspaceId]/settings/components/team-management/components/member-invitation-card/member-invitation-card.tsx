'use client'

import { ChevronDown } from 'lucide-react'
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { PermissionSelector, type PermissionType } from '@/components/permissions'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import type { AdminWorkspace } from '@/hooks/queries/workspace'

interface MemberInvitationCardProps {
  inviteEmails: TagItem[]
  setInviteEmails: (emails: TagItem[]) => void
  isInviting: boolean
  showWorkspaceInvite: boolean
  setShowWorkspaceInvite: (show: boolean) => void
  selectedWorkspaces: Array<{ workspaceId: string; permission: string }>
  userWorkspaces: AdminWorkspace[]
  onInviteMember: () => Promise<void>
  onLoadUserWorkspaces: () => Promise<void>
  onWorkspaceToggle: (workspaceId: string, permission: string) => void
  inviteSuccess: boolean
  availableSeats?: number
  maxSeats?: number
  invitationError?: Error | null
  isLoadingWorkspaces?: boolean
}

export function MemberInvitationCard({
  inviteEmails,
  setInviteEmails,
  isInviting,
  showWorkspaceInvite,
  setShowWorkspaceInvite,
  selectedWorkspaces,
  userWorkspaces,
  onInviteMember,
  onLoadUserWorkspaces,
  onWorkspaceToggle,
  inviteSuccess,
  availableSeats = 0,
  maxSeats = 0,
  invitationError = null,
  isLoadingWorkspaces = false,
}: MemberInvitationCardProps) {
  const selectedCount = selectedWorkspaces.length
  const hasAvailableSeats = availableSeats > 0
  const hasValidEmails = inviteEmails.some((e) => e.isValid)

  const handleAddEmail = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false

    const isDuplicate = inviteEmails.some((e) => e.value === normalized)
    if (isDuplicate) return false

    const validation = quickValidateEmail(normalized)
    setInviteEmails([...inviteEmails, { value: normalized, isValid: validation.isValid }])
    return validation.isValid
  }

  const handleRemoveEmail = (_value: string, index: number) => {
    setInviteEmails(inviteEmails.filter((_, i) => i !== index))
  }

  return (
    <div className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='px-3.5 py-2.5'>
        <h4 className='font-medium text-[var(--text-primary)] text-base'>Invite Members</h4>
        <p className='text-[var(--text-muted)] text-small'>
          Invite people to your organization and choose which workspaces they can access.
        </p>
      </div>

      <div className='flex flex-col gap-3 border-[var(--border-1)] border-t bg-[var(--surface-4)] px-3.5 py-3'>
        <div className='flex items-start gap-2'>
          <div className='flex-1'>
            <TagInput
              items={inviteEmails}
              onAdd={handleAddEmail}
              onRemove={handleRemoveEmail}
              placeholder='Enter email addresses'
              placeholderWithTags='Add another email'
              disabled={isInviting || !hasAvailableSeats}
              triggerKeys={['Enter', ',', ' ']}
              maxHeight='max-h-24'
            />
          </div>
          <DropdownMenu
            open={showWorkspaceInvite}
            onOpenChange={(open) => {
              setShowWorkspaceInvite(open)
              if (open) {
                onLoadUserWorkspaces()
              }
            }}
            modal={false}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant='active'
                disabled={isInviting || !hasAvailableSeats}
                className='min-w-[110px]'
              >
                <span className='flex-1 text-left'>
                  Workspaces
                  {selectedCount > 0 && ` (${selectedCount})`}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    showWorkspaceInvite && 'rotate-180'
                  )}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side='bottom'
              align='end'
              sideOffset={4}
              className='max-h-[320px] min-w-[240px] max-w-[240px] overflow-y-auto'
            >
              {isLoadingWorkspaces ? (
                <div className='px-1.5 py-4 text-center'>
                  <p className='text-[var(--text-tertiary)] text-small'>Loading...</p>
                </div>
              ) : userWorkspaces.length === 0 ? (
                <div className='px-1.5 py-4 text-center'>
                  <p className='text-[var(--text-tertiary)] text-small'>No workspaces available</p>
                </div>
              ) : (
                <div className='flex flex-col gap-0.5'>
                  {userWorkspaces.map((workspace) => {
                    const isSelected = selectedWorkspaces.some(
                      (w) => w.workspaceId === workspace.id
                    )
                    const selectedWorkspace = selectedWorkspaces.find(
                      (w) => w.workspaceId === workspace.id
                    )

                    return (
                      <div key={workspace.id} className='flex flex-col gap-1'>
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault()
                            if (isSelected) {
                              onWorkspaceToggle(workspace.id, '')
                            } else {
                              onWorkspaceToggle(workspace.id, 'read')
                            }
                          }}
                          disabled={isInviting}
                          className={cn(isSelected && 'bg-[var(--surface-active)]')}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={isInviting}
                            className='pointer-events-none'
                          />
                          <span className='flex-1 truncate'>{workspace.name}</span>
                        </DropdownMenuItem>
                        {isSelected && (
                          <div className='ml-[31px] flex items-center gap-1.5 pb-1'>
                            <span className='text-[var(--text-tertiary)] text-xs'>Access:</span>
                            <PermissionSelector
                              value={
                                (['read', 'write', 'admin'].includes(
                                  selectedWorkspace?.permission ?? ''
                                )
                                  ? selectedWorkspace?.permission
                                  : 'read') as PermissionType
                              }
                              onChange={(permission) => onWorkspaceToggle(workspace.id, permission)}
                              disabled={isInviting}
                              size='compact'
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant='primary'
            onClick={() => onInviteMember()}
            disabled={!hasValidEmails || isInviting || !hasAvailableSeats || selectedCount === 0}
          >
            {isInviting
              ? 'Inviting...'
              : !hasAvailableSeats
                ? 'No Seats'
                : selectedCount === 0
                  ? 'Select Workspace'
                  : 'Invite'}
          </Button>
        </div>

        {selectedCount === 0 && (
          <p className='text-[var(--text-muted)] text-small leading-tight'>
            Select at least one organization workspace before sending an organization invite.
          </p>
        )}

        {invitationError && (
          <p className='text-[var(--text-error)] text-small leading-tight'>
            {invitationError instanceof Error && invitationError.message
              ? invitationError.message
              : String(invitationError)}
          </p>
        )}

        {inviteSuccess && (
          <p className='text-[var(--text-success)] text-xs leading-tight'>
            Invitation sent successfully
            {selectedCount > 0 &&
              ` with access to ${selectedCount} workspace${selectedCount !== 1 ? 's' : ''}`}
          </p>
        )}
      </div>
    </div>
  )
}
