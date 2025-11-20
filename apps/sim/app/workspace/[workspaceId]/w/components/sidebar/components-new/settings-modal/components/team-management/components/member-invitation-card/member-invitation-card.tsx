import React, { useMemo, useState } from 'react'
import { CheckCircle, ChevronDown } from 'lucide-react'
import { Button, Input, Label } from '@/components/emcn'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { quickValidateEmail } from '@/lib/email/validation'
import { cn } from '@/lib/utils'

type PermissionType = 'read' | 'write' | 'admin'

interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}

const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className = '' }) => {
    const permissionOptions = useMemo(
      () => [
        { value: 'read' as PermissionType, label: 'Read', description: 'View only' },
        { value: 'write' as PermissionType, label: 'Write', description: 'Edit content' },
        { value: 'admin' as PermissionType, label: 'Admin', description: 'Full access' },
      ],
      []
    )

    return (
      <div
        className={cn('inline-flex rounded-[12px] border border-input bg-background', className)}
      >
        {permissionOptions.map((option, index) => (
          <button
            key={option.value}
            type='button'
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            title={option.description}
            className={cn(
              'px-2.5 py-1.5 font-medium text-xs transition-colors focus:outline-none',
              'first:rounded-l-[11px] last:rounded-r-[11px]',
              disabled && 'cursor-not-allowed opacity-50',
              value === option.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              index > 0 && 'border-input border-l'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
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
  userWorkspaces: any[]
  onInviteMember: () => Promise<void>
  onLoadUserWorkspaces: () => Promise<void>
  onWorkspaceToggle: (workspaceId: string, permission: string) => void
  inviteSuccess: boolean
  availableSeats?: number
  maxSeats?: number
}

function ButtonSkeleton() {
  return (
    <div className='h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary' />
  )
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
}: MemberInvitationCardProps) {
  const selectedCount = selectedWorkspaces.length
  const hasAvailableSeats = availableSeats > 0
  const [emailError, setEmailError] = useState<string>('')

  // Email validation function using existing lib
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
    // Clear error when user starts typing again
    if (emailError) {
      setEmailError('')
    }
  }

  const handleInviteClick = () => {
    // Validate email before proceeding
    if (inviteEmail.trim()) {
      validateEmailInput(inviteEmail)
      const validation = quickValidateEmail(inviteEmail.trim())
      if (!validation.isValid) {
        return // Don't proceed if validation fails
      }
    }

    // If validation passes or email is empty, proceed with original invite
    onInviteMember()
  }

  return (
    <div className='rounded-lg border border-[var(--border-muted)] bg-[var(--surface-3)] p-4'>
      <div className='space-y-3'>
        {/* Header */}
        <div>
          <h4 className='font-medium text-sm'>Invite Team Members</h4>
          <p className='text-muted-foreground text-xs'>
            Add new members to your team and optionally give them access to specific workspaces
          </p>
        </div>

        {/* Main invitation input */}
        <div className='flex items-start gap-2'>
          <div className='flex-1'>
            <Input
              placeholder='Enter email address'
              value={inviteEmail}
              onChange={handleEmailChange}
              disabled={isInviting || !hasAvailableSeats}
              className={cn(emailError && 'border-red-500 focus-visible:ring-red-500')}
            />
            {emailError && (
              <p className='mt-1 text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {emailError}
              </p>
            )}
          </div>
          <Button
            variant='ghost'
            onClick={() => {
              setShowWorkspaceInvite(!showWorkspaceInvite)
              if (!showWorkspaceInvite) {
                onLoadUserWorkspaces()
              }
            }}
            disabled={isInviting || !hasAvailableSeats}
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                showWorkspaceInvite && 'rotate-180'
              )}
            />
            Workspaces
          </Button>
          <Button
            variant='secondary'
            onClick={handleInviteClick}
            disabled={!inviteEmail || isInviting || !hasAvailableSeats}
          >
            {isInviting ? <ButtonSkeleton /> : hasAvailableSeats ? 'Invite' : 'No Seats'}
          </Button>
        </div>

        {/* Workspace selection - collapsible */}
        {showWorkspaceInvite && (
          <div className='space-y-3 rounded-md border border-[var(--border-muted)] bg-[var(--surface-2)] p-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <h5 className='font-medium text-xs'>Workspace Access</h5>
                <span className='text-[11px] text-muted-foreground'>(Optional)</span>
              </div>
              {selectedCount > 0 && (
                <span className='text-muted-foreground text-xs'>{selectedCount} selected</span>
              )}
            </div>

            {userWorkspaces.length === 0 ? (
              <div className='py-4 text-center'>
                <p className='text-muted-foreground text-xs'>No workspaces available</p>
              </div>
            ) : (
              <div className='max-h-48 space-y-1.5 overflow-y-auto'>
                {userWorkspaces.map((workspace) => {
                  const isSelected = selectedWorkspaces.some((w) => w.workspaceId === workspace.id)
                  const selectedWorkspace = selectedWorkspaces.find(
                    (w) => w.workspaceId === workspace.id
                  )

                  return (
                    <div
                      key={workspace.id}
                      className='flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-3)]'
                    >
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <Checkbox
                            id={`workspace-${workspace.id}`}
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                onWorkspaceToggle(workspace.id, 'read')
                              } else {
                                onWorkspaceToggle(workspace.id, '')
                              }
                            }}
                            disabled={isInviting}
                          />
                          <Label
                            htmlFor={`workspace-${workspace.id}`}
                            className='cursor-pointer text-xs'
                          >
                            {workspace.name}
                          </Label>
                          {workspace.isOwner && (
                            <Badge
                              variant='outline'
                              className='h-[1.125rem] rounded-[6px] px-2 py-0 text-[10px]'
                            >
                              Owner
                            </Badge>
                          )}
                        </div>
                      </div>

                      {isSelected && (
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
                          className='w-auto'
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Success message */}
        {inviteSuccess && (
          <div className='flex items-start gap-2 rounded-md bg-green-500/10 p-2.5 text-green-600 dark:text-green-400'>
            <CheckCircle className='h-4 w-4 flex-shrink-0' />
            <p className='text-xs'>
              Invitation sent successfully
              {selectedCount > 0 &&
                ` with access to ${selectedCount} workspace${selectedCount !== 1 ? 's' : ''}`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
