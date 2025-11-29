import { RefreshCw } from 'lucide-react'
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
      <div className='px-6 pt-4 pb-4'>
        <div className='flex flex-col gap-6'>
          {/* Header - matching settings page style */}
          <div>
            <h4 className='font-medium text-sm'>Create Your Team Workspace</h4>
            <p className='mt-1 text-muted-foreground text-xs'>
              You're subscribed to a {hasEnterprisePlan ? 'enterprise' : 'team'} plan. Create your
              workspace to start collaborating with your team.
            </p>
          </div>

          {/* Form fields - clean layout without card */}
          <div className='space-y-4'>
            <div>
              <Label htmlFor='orgName' className='font-medium text-sm'>
                Team Name
              </Label>
              <Input
                id='orgName'
                value={orgName}
                onChange={onOrgNameChange}
                placeholder='My Team'
                className='mt-1'
              />
            </div>

            <div>
              <Label htmlFor='orgSlug' className='font-medium text-sm'>
                Team URL
              </Label>
              <div className='mt-1 flex items-center'>
                <div className='rounded-l-[8px] border border-r-0 bg-muted px-3 py-2 text-muted-foreground text-sm'>
                  sim.ai/team/
                </div>
                <Input
                  id='orgSlug'
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  placeholder='my-team'
                  className='rounded-l-none'
                />
              </div>
            </div>

            <div className='flex flex-col gap-2'>
              {error && (
                <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                  {error}
                </p>
              )}
              <div className='flex justify-end'>
                <Button
                  onClick={onCreateOrganization}
                  disabled={!orgName || !orgSlug || isCreatingOrg}
                  className='h-[32px] px-[12px]'
                >
                  {isCreatingOrg && <RefreshCw className='mr-2 h-4 w-4 animate-spin' />}
                  Create Team Workspace
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Modal open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
          <ModalContent className='sm:max-w-md'>
            <ModalHeader>
              <ModalTitle>Create Team Organization</ModalTitle>
              <ModalDescription>
                Create a new team organization to manage members and billing.
              </ModalDescription>
            </ModalHeader>

            <div className='space-y-4'>
              <div>
                <Label htmlFor='org-name' className='font-medium text-sm'>
                  Organization Name
                </Label>
                <Input
                  id='org-name'
                  placeholder='Enter organization name'
                  value={orgName}
                  onChange={onOrgNameChange}
                  disabled={isCreatingOrg}
                  className='mt-1'
                />
              </div>

              <div>
                <Label htmlFor='org-slug' className='font-medium text-sm'>
                  Organization Slug
                </Label>
                <Input
                  id='org-slug'
                  placeholder='organization-slug'
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  disabled={isCreatingOrg}
                  className='mt-1'
                />
              </div>
            </div>

            {error && (
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {error}
              </p>
            )}

            <ModalFooter>
              <Button
                variant='outline'
                onClick={() => setCreateOrgDialogOpen(false)}
                disabled={isCreatingOrg}
                className='h-[32px] px-[12px]'
              >
                Cancel
              </Button>
              <Button
                onClick={onCreateOrganization}
                disabled={isCreatingOrg || !orgName.trim()}
                className='h-[32px] px-[12px]'
              >
                {isCreatingOrg && <RefreshCw className='mr-2 h-4 w-4 animate-spin' />}
                Create Organization
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    )
  }

  return (
    <div className='space-y-4 p-6'>
      <div className='space-y-6'>
        <h3 className='font-medium text-sm'>No Team Workspace</h3>
        <p className='text-muted-foreground text-sm'>
          You don't have a team workspace yet. To collaborate with others, first upgrade to a team
          or enterprise plan.
        </p>

        <Button
          onClick={() => {
            const event = new CustomEvent('open-settings', {
              detail: { tab: 'subscription' },
            })
            window.dispatchEvent(event)
          }}
          className='h-[32px] px-[12px]'
        >
          Upgrade to Team Plan
        </Button>
      </div>
    </div>
  )
}
