import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OrganizationCreationDialog } from './'

interface NoOrganizationViewProps {
  hasTeamPlan: boolean
  hasEnterprisePlan: boolean
  orgName: string
  setOrgName: (name: string) => void
  orgSlug: string
  setOrgSlug: (slug: string) => void
  onOrgNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onCreateOrganization: () => Promise<void>
  isCreatingOrg: boolean
  error: string | null
  createOrgDialogOpen: boolean
  setCreateOrgDialogOpen: (open: boolean) => void
}

export function NoOrganizationView({
  hasTeamPlan,
  hasEnterprisePlan,
  orgName,
  setOrgName,
  orgSlug,
  setOrgSlug,
  onOrgNameChange,
  onCreateOrganization,
  isCreatingOrg,
  error,
  createOrgDialogOpen,
  setCreateOrgDialogOpen,
}: NoOrganizationViewProps) {
  if (hasTeamPlan || hasEnterprisePlan) {
    return (
      <div className='space-y-6 p-6'>
        <div className='space-y-6'>
          <h3 className='font-medium text-lg'>Create Your Team Workspace</h3>

          <div className='space-y-6 rounded-lg border p-6'>
            <p className='text-muted-foreground text-sm'>
              You're subscribed to a {hasEnterprisePlan ? 'enterprise' : 'team'} plan. Create your
              workspace to start collaborating with your team.
            </p>

            <div className='space-y-4'>
              <div className='space-y-2'>
                <label htmlFor='orgName' className='font-medium text-sm'>
                  Team Name
                </label>
                <Input
                  id='orgName'
                  value={orgName}
                  onChange={onOrgNameChange}
                  placeholder='My Team'
                />
              </div>

              <div className='space-y-2'>
                <label htmlFor='orgSlug' className='font-medium text-sm'>
                  Team URL
                </label>
                <div className='flex items-center space-x-2'>
                  <div className='rounded-l-md bg-muted px-3 py-2 text-muted-foreground text-sm'>
                    simstudio.ai/team/
                  </div>
                  <Input
                    id='orgSlug'
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value)}
                    className='rounded-l-none'
                  />
                </div>
              </div>
            </div>

            {error && (
              <Alert variant='destructive'>
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className='flex justify-end space-x-2'>
              <Button
                onClick={onCreateOrganization}
                disabled={!orgName || !orgSlug || isCreatingOrg}
              >
                {isCreatingOrg && <RefreshCw className='mr-2 h-4 w-4 animate-spin' />}
                Create Team Workspace
              </Button>
            </div>
          </div>
        </div>

        <OrganizationCreationDialog
          open={createOrgDialogOpen}
          onOpenChange={setCreateOrgDialogOpen}
          orgName={orgName}
          onOrgNameChange={onOrgNameChange}
          orgSlug={orgSlug}
          onOrgSlugChange={setOrgSlug}
          onCreateOrganization={onCreateOrganization}
          isCreating={isCreatingOrg}
          error={error}
        />
      </div>
    )
  }

  return (
    <div className='space-y-6 p-6'>
      <div className='space-y-6'>
        <h3 className='font-medium text-lg'>No Team Workspace</h3>
        <p className='text-muted-foreground text-sm'>
          You don't have a team workspace yet. To collaborate with others, first upgrade to a team
          or enterprise plan.
        </p>

        <Button
          onClick={() => {
            // Open the subscription tab
            const event = new CustomEvent('open-settings', {
              detail: { tab: 'subscription' },
            })
            window.dispatchEvent(event)
          }}
        >
          Upgrade to Team Plan
        </Button>
      </div>
    </div>
  )
}
