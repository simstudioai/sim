import React, { useMemo, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <div className='space-y-4'>
      {/* Header - clean like account page */}
      <div>
        <h4 className='font-medium text-sm'>Invite Team Members</h4>
        <p className='text-muted-foreground text-xs'>
          Add new members to your team and optionally give them access to specific workspaces
        </p>
      </div>

      {/* Main invitation input - clean layout */}
      <div className='flex items-start gap-3'>
        <div className='flex-1'>
          <div>
            <Input
              placeholder='Enter email address'
              value={inviteEmail}
              onChange={handleEmailChange}
              disabled={isInviting || !hasAvailableSeats}
              className={cn('w-full', emailError && 'border-red-500 focus-visible:ring-red-500')}
            />
            <div className='h-4 pt-1'>
              {emailError && (
                <p className='text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
                  {emailError}
                </p>
              )}
            </div>
          </div>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => {
            setShowWorkspaceInvite(!showWorkspaceInvite)
            if (!showWorkspaceInvite) {
              onLoadUserWorkspaces()
            }
          }}
          disabled={isInviting || !hasAvailableSeats}
          className='h-9 shrink-0 rounded-[8px] text-sm'
        >
          {showWorkspaceInvite ? 'Hide' : 'Add'} Workspaces
        </Button>
        <Button
          size='sm'
          onClick={handleInviteClick}
          disabled={!inviteEmail || isInviting || !hasAvailableSeats}
          className='h-9 shrink-0 rounded-[8px]'
        >
          {isInviting ? <ButtonSkeleton /> : null}
          {hasAvailableSeats ? 'Invite' : 'No Seats'}
        </Button>
      </div>

      {showWorkspaceInvite && (
        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <h5 className='font-medium text-xs'>Workspace Access</h5>
              <Badge variant='outline' className='h-[1.125rem] rounded-[6px] px-2 py-0 text-xs'>
                Optional
              </Badge>
            </div>
            {selectedCount > 0 && (
              <span className='text-muted-foreground text-xs'>{selectedCount} selected</span>
            )}
          </div>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            Grant access to specific workspaces. You can modify permissions later.
          </p>

          {userWorkspaces.length === 0 ? (
            <div className='rounded-md border border-dashed py-8 text-center'>
              <p className='text-muted-foreground text-sm'>No workspaces available</p>
              <p className='mt-1 text-muted-foreground text-xs'>
                You need admin access to workspaces to invite members
              </p>
            </div>
          ) : (
            <div className='max-h-48 space-y-2 overflow-y-auto'>
              {userWorkspaces.map((workspace) => {
                const isSelected = selectedWorkspaces.some((w) => w.workspaceId === workspace.id)
                const selectedWorkspace = selectedWorkspaces.find(
                  (w) => w.workspaceId === workspace.id
                )

                return (
                  <div key={workspace.id} className='flex items-center justify-between gap-2 py-1'>
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
                          className='cursor-pointer font-medium text-sm'
                        >
                          {workspace.name}
                        </Label>
                        {workspace.isOwner && (
                          <Badge
                            variant='outline'
                            className='h-[1.125rem] rounded-[6px] px-2 py-0 text-xs'
                          >
                            Owner
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Always reserve space for permission selector to maintain consistent layout */}
                    <div className='flex h-[30px] w-32 flex-shrink-0 items-center justify-end gap-2'>
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
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {inviteSuccess && (
        <Alert className='rounded-[8px] border-green-200 bg-green-50 text-green-800 dark:border-green-800/50 dark:bg-green-950/20 dark:text-green-300'>
          <CheckCircle className='h-4 w-4 text-green-600 dark:text-green-400' />
          <AlertDescription>
            Invitation sent successfully
            {selectedCount > 0 &&
              ` with access to ${selectedCount} workspace${selectedCount !== 1 ? 's' : ''}`}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
