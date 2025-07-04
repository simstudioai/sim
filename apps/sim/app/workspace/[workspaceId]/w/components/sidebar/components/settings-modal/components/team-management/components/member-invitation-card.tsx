import { CheckCircle, PlusCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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
  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-base'>Invite Team Members</CardTitle>
        <CardDescription>
          Add new members to your team and optionally give them access to specific workspaces
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center space-x-2'>
          <Input
            placeholder='Email address'
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={isInviting}
            className='flex-1'
          />
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
          >
            {showWorkspaceInvite ? 'Hide' : 'Add'} Workspaces
          </Button>
          <Button onClick={onInviteMember} disabled={!inviteEmail || isInviting}>
            {isInviting ? <ButtonSkeleton /> : <PlusCircle className='mr-2 h-4 w-4' />}
            <span>Invite</span>
          </Button>
        </div>

        {showWorkspaceInvite && (
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <h5 className='font-medium text-sm'>Workspace Access</h5>
              <span className='text-muted-foreground text-xs'>Optional</span>
            </div>
            <p className='text-muted-foreground text-xs'>
              Grant access to specific workspaces. You can modify permissions later.
            </p>

            {userWorkspaces.length === 0 ? (
              <div className='py-4 text-center'>
                <p className='text-muted-foreground text-sm'>No workspaces available</p>
              </div>
            ) : (
              <div className='max-h-32 space-y-1 overflow-y-auto'>
                {userWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className='group flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50'
                  >
                    <div className='flex items-center space-x-3'>
                      <input
                        type='checkbox'
                        id={`workspace-${workspace.id}`}
                        checked={selectedWorkspaces.some((w) => w.workspaceId === workspace.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onWorkspaceToggle(workspace.id, 'read')
                          } else {
                            onWorkspaceToggle(workspace.id, '')
                          }
                        }}
                        className='h-4 w-4 rounded border-gray-300 text-primary focus:ring-2 focus:ring-primary'
                      />
                      <label
                        htmlFor={`workspace-${workspace.id}`}
                        className='cursor-pointer font-medium text-sm'
                      >
                        {workspace.name}
                      </label>
                    </div>
                    {selectedWorkspaces.some((w) => w.workspaceId === workspace.id) && (
                      <select
                        value={
                          selectedWorkspaces.find((w) => w.workspaceId === workspace.id)
                            ?.permission || 'read'
                        }
                        onChange={(e) => onWorkspaceToggle(workspace.id, e.target.value)}
                        className='ml-2 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      >
                        <option value='read'>Read</option>
                        <option value='write'>Write</option>
                        <option value='admin'>Admin</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {inviteSuccess && (
          <Alert>
            <CheckCircle className='h-4 w-4' />
            <AlertDescription>
              Invitation sent successfully
              {selectedWorkspaces.length > 0 &&
                ` with access to ${selectedWorkspaces.length} workspace(s)`}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
