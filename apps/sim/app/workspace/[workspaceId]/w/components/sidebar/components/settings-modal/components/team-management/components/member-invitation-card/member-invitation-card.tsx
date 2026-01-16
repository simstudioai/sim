'use client'

import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import type { AdminWorkspace } from '@/hooks/queries/workspace'

type PermissionType = 'read' | 'write' | 'admin'

interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}

const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className = '' }) => {
    return (
      <ButtonGroup
        value={value}
        onValueChange={(val) => onChange(val as PermissionType)}
        disabled={disabled}
        className={className}
      >
        <ButtonGroupItem
          value='read'
          className='h-[22px] min-w-[38px] px-[6px] py-0 text-[11px]'
          title='View only'
        >
          Read
        </ButtonGroupItem>
        <ButtonGroupItem
          value='write'
          className='h-[22px] min-w-[38px] px-[6px] py-0 text-[11px]'
          title='Edit content'
        >
          Write
        </ButtonGroupItem>
        <ButtonGroupItem
          value='admin'
          className='h-[22px] min-w-[38px] px-[6px] py-0 text-[11px]'
          title='Full access'
        >
          Admin
        </ButtonGroupItem>
      </ButtonGroup>
    )
  }
)

PermissionSelector.displayName = 'PermissionSelector'

interface MemberInvitationCardProps {
  inviteEmail: string
  setInviteEmail: (email: string) => void
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
  inviteEmail,
  setInviteEmail,
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
  const [emailError, setEmailError] = useState<string>('')

  const validateEmailInput = (email: string) => {
    if (!email.trim()) {
      setEmailError('')
      return
    }

    const validation = quickValidateEmail(email.trim())
    if (!validation.isValid) {
      setEmailError(validation.reason || 'Please enter a valid email address')
    } else {
      setEmailError('')
    }
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInviteEmail(value)
    if (emailError) {
      setEmailError('')
    }
  }

  const handleInviteClick = () => {
    if (inviteEmail.trim()) {
      validateEmailInput(inviteEmail)
      const validation = quickValidateEmail(inviteEmail.trim())
      if (!validation.isValid) {
        return // Don't proceed if validation fails
      }
    }

    onInviteMember()
  }

  return (
    <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
      {/* Header */}
      <div className='px-[14px] py-[10px]'>
        <h4 className='font-medium text-[14px] text-[var(--text-primary)]'>Invite Team Members</h4>
        <p className='text-[12px] text-[var(--text-muted)]'>
          Add new members to your team and optionally give them access to specific workspaces
        </p>
      </div>

      <div className='flex flex-col gap-[12px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[12px]'>
        {/* Main invitation input */}
        <div className='flex items-start gap-[8px]'>
          <div className='flex-1'>
            {/* Hidden decoy fields to prevent browser autofill */}
            <input
              type='text'
              name='fakeusernameremembered'
              autoComplete='username'
              style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
              tabIndex={-1}
              readOnly
            />
            <input
              type='email'
              name='fakeemailremembered'
              autoComplete='email'
              style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
              tabIndex={-1}
              readOnly
            />
            <Input
              placeholder='Enter email address'
              value={inviteEmail}
              onChange={handleEmailChange}
              disabled={isInviting || !hasAvailableSeats}
              className={cn(emailError && 'border-red-500 focus-visible:ring-red-500')}
              name='member_invite_field'
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck={false}
              data-lpignore='true'
              data-form-type='other'
              aria-autocomplete='none'
            />
            {emailError && (
              <p className='mt-1 text-[12px] text-[var(--text-error)] leading-tight'>
                {emailError}
              </p>
            )}
          </div>
          <Popover
            open={showWorkspaceInvite}
            onOpenChange={(open) => {
              setShowWorkspaceInvite(open)
              if (open) {
                onLoadUserWorkspaces()
              }
            }}
          >
            <PopoverTrigger asChild>
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
            </PopoverTrigger>
            <PopoverContent
              side='bottom'
              align='end'
              maxHeight={320}
              sideOffset={4}
              className='w-[240px] border border-[var(--border-muted)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              style={{ minWidth: '240px', maxWidth: '240px' }}
            >
              {isLoadingWorkspaces ? (
                <div className='px-[6px] py-[16px] text-center'>
                  <p className='text-[12px] text-[var(--text-tertiary)]'>Loading...</p>
                </div>
              ) : userWorkspaces.length === 0 ? (
                <div className='px-[6px] py-[16px] text-center'>
                  <p className='text-[12px] text-[var(--text-tertiary)]'>No workspaces available</p>
                </div>
              ) : (
                <div className='flex flex-col gap-[2px]'>
                  {userWorkspaces.map((workspace) => {
                    const isSelected = selectedWorkspaces.some(
                      (w) => w.workspaceId === workspace.id
                    )
                    const selectedWorkspace = selectedWorkspaces.find(
                      (w) => w.workspaceId === workspace.id
                    )

                    return (
                      <div key={workspace.id} className='flex flex-col gap-[4px]'>
                        <PopoverItem
                          onClick={() => {
                            if (isSelected) {
                              onWorkspaceToggle(workspace.id, '')
                            } else {
                              onWorkspaceToggle(workspace.id, 'read')
                            }
                          }}
                          active={isSelected}
                          disabled={isInviting}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={isInviting}
                            className='pointer-events-none'
                          />
                          <span className='flex-1 truncate'>{workspace.name}</span>
                        </PopoverItem>
                        {isSelected && (
                          <div className='ml-[31px] flex items-center gap-[6px] pb-[4px]'>
                            <span className='text-[11px] text-[var(--text-tertiary)]'>Access:</span>
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
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant='tertiary'
            onClick={handleInviteClick}
            disabled={!inviteEmail || isInviting || !hasAvailableSeats}
          >
            {isInviting ? 'Inviting...' : hasAvailableSeats ? 'Invite' : 'No Seats'}
          </Button>
        </div>

        {/* Invitation error - inline */}
        {invitationError && (
          <p className='text-[12px] text-[var(--text-error)] leading-tight'>
            {invitationError instanceof Error && invitationError.message
              ? invitationError.message
              : String(invitationError)}
          </p>
        )}

        {/* Success message */}
        {inviteSuccess && (
          <p className='text-[11px] text-[var(--text-success)] leading-tight'>
            Invitation sent successfully
            {selectedCount > 0 &&
              ` with access to ${selectedCount} workspace${selectedCount !== 1 ? 's' : ''}`}
          </p>
        )}
      </div>
    </div>
  )
}
