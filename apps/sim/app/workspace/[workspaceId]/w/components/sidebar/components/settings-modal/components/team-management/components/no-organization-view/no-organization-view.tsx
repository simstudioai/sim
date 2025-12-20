import {
  Button,
  Input,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'

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
      <div>
        <div className='flex flex-col gap-6'>
          {/* Header - matching settings page style */}
          <div>
            <h4 className='font-medium text-[13px]'>Create Your Team Workspace</h4>
            <p className='mt-1 text-[var(--text-muted)] text-xs'>
              You're subscribed to a {hasEnterprisePlan ? 'enterprise' : 'team'} plan. Create your
              workspace to start collaborating with your team.
            </p>
          </div>

          {/* Form fields - clean layout without card */}
          <div className='space-y-4'>
            {/* Hidden decoy field to prevent browser autofill */}
            <input
              type='text'
              name='fakeusernameremembered'
              autoComplete='username'
              style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
              tabIndex={-1}
              readOnly
            />
            <div>
              <Label htmlFor='team-name-field' className='font-medium text-[13px]'>
                Team Name
              </Label>
              <Input
                id='team-name-field'
                value={orgName}
                onChange={onOrgNameChange}
                placeholder='My Team'
                className='mt-1'
                name='team_name_field'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
            </div>

            <div>
              <Label htmlFor='orgSlug' className='font-medium text-[13px]'>
                Team URL
              </Label>
              <div className='mt-1 flex items-center'>
                <div className='rounded-l-[8px] border border-r-0 bg-[var(--surface-3)] px-3 py-2 text-[var(--text-muted)] text-sm'>
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
                  {isCreatingOrg ? 'Creating...' : 'Create Team Workspace'}
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
              {/* Hidden decoy field to prevent browser autofill */}
              <input
                type='text'
                name='fakeusernameremembered'
                autoComplete='username'
                style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
                tabIndex={-1}
                readOnly
              />
              <div>
                <Label htmlFor='org-name-field' className='font-medium text-[13px]'>
                  Organization Name
                </Label>
                <Input
                  id='org-name-field'
                  placeholder='Enter organization name'
                  value={orgName}
                  onChange={onOrgNameChange}
                  disabled={isCreatingOrg}
                  className='mt-1'
                  name='org_name_field'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              </div>

              <div>
                <Label htmlFor='org-slug-field' className='font-medium text-[13px]'>
                  Organization Slug
                </Label>
                <Input
                  id='org-slug-field'
                  placeholder='organization-slug'
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  disabled={isCreatingOrg}
                  className='mt-1'
                  name='org_slug_field'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
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
                {isCreatingOrg ? 'Creating...' : 'Create Organization'}
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
        <h3 className='font-medium text-[13px]'>No Team Workspace</h3>
        <p className='text-[var(--text-muted)] text-sm'>
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
