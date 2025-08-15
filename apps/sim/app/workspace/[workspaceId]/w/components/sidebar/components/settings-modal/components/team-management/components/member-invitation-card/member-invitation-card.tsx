import React, { useMemo } from 'react'
import { CheckCircle, ChevronDown, PlusCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
        className={cn(
          'inline-flex overflow-hidden rounded-md border border-input bg-background shadow-sm',
          className
        )}
      >
        {permissionOptions.map((option, index) => (
          <button
            key={option.value}
            type='button'
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            title={option.description}
            className={cn(
              'relative px-3 py-1.5 font-medium text-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              disabled && 'cursor-not-allowed opacity-50',
              value === option.value
                ? 'z-10 bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:z-20 hover:bg-muted/50 hover:text-foreground',
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
}: MemberInvitationCardProps) {
  const selectedCount = selectedWorkspaces.length

  return (
    <Card>
      <CardHeader className='pb-4'>
        <CardTitle className='text-base'>Invite Team Members</CardTitle>
        <CardDescription>
          Add new members to your team and optionally give them access to specific workspaces
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex-1'>
            <Input
              placeholder='Enter email address'
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={isInviting}
              className='w-full'
            />
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
            disabled={isInviting}
            className='shrink-0 gap-1'
          >
            {showWorkspaceInvite ? 'Hide' : 'Add'} Workspaces
            {selectedCount > 0 && (
              <Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
                {selectedCount}
              </Badge>
            )}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', showWorkspaceInvite && 'rotate-180')}
            />
          </Button>
          <Button
            size='sm'
            onClick={onInviteMember}
            disabled={!inviteEmail || isInviting}
            className='shrink-0 gap-2'
          >
            {isInviting ? <ButtonSkeleton /> : <PlusCircle className='h-4 w-4' />}
            Invite
          </Button>
        </div>

        {showWorkspaceInvite && (
          <div className='space-y-3 pt-1'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <h5 className='font-medium text-sm'>Workspace Access</h5>
                <Badge variant='outline' className='text-xs'>
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
              <div className='max-h-48 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3'>
                {userWorkspaces.map((workspace) => {
                  const isSelected = selectedWorkspaces.some((w) => w.workspaceId === workspace.id)
                  const selectedWorkspace = selectedWorkspaces.find(
                    (w) => w.workspaceId === workspace.id
                  )

                  return (
                    <div
                      key={workspace.id}
                      className={cn(
                        'flex items-center justify-between rounded-md border bg-background p-3 transition-all',
                        isSelected
                          ? 'border-primary/20 bg-primary/5'
                          : 'hover:border-border hover:bg-muted/50'
                      )}
                    >
                      <div className='flex items-center gap-3'>
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
                          className='cursor-pointer font-medium text-sm leading-none'
                        >
                          {workspace.name}
                        </Label>
                        {workspace.isOwner && (
                          <Badge variant='outline' className='text-xs'>
                            Owner
                          </Badge>
                        )}
                      </div>

                      {isSelected && (
                        <div className='flex items-center gap-2'>
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
                            className='h-8'
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {inviteSuccess && (
          <Alert className='border-green-200 bg-green-50 text-green-800 dark:border-green-800/50 dark:bg-green-950/20 dark:text-green-300'>
            <CheckCircle className='h-4 w-4 text-green-600 dark:text-green-400' />
            <AlertDescription>
              Invitation sent successfully
              {selectedCount > 0 &&
                ` with access to ${selectedCount} workspace${selectedCount !== 1 ? 's' : ''}`}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
