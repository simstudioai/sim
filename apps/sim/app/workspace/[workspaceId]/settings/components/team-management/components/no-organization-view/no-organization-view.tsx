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
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

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
  const { navigateToSettings } = useSettingsNavigation()

  if (hasTeamPlan || hasEnterprisePlan) {
    return (
      <div>
        <div className='flex flex-col gap-5'>
          {/* Header - matching settings page style */}
          <div>
            <h4 className='font-medium text-[var(--text-primary)] text-base'>
              Create Your Team Workspace
            </h4>
            <p className='mt-1 text-[var(--text-muted)] text-small'>
              You're subscribed to a {hasEnterprisePlan ? 'enterprise' : 'team'} plan. Create your
              workspace to start collaborating with your team.
            </p>
          </div>

          {/* Form fields - clean layout without card */}
          <div className='flex flex-col gap-4.5'>
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
              <Label htmlFor='team-name-field' className='font-medium text-small'>
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
              <Label htmlFor='orgSlug' className='font-medium text-small'>
                Team URL
              </Label>
              <div className='mt-1 flex items-center'>
                <div className='rounded-l-[6px] border border-[var(--border-1)] border-r-0 bg-[var(--surface-4)] px-3 py-1.5 text-[var(--text-muted)] text-small'>
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
                <p className='text-[var(--text-error)] text-small leading-tight'>{error}</p>
              )}
              <div className='flex justify-end'>
                <Button
                  variant='primary'
                  onClick={onCreateOrganization}
                  disabled={!orgName || !orgSlug || isCreatingOrg}
                >
                  {isCreatingOrg ? 'Creating...' : 'Create Team Workspace'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Modal open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
          <ModalContent size='md'>
            <ModalHeader>
              <ModalTitle>Create Team Organization</ModalTitle>
              <ModalDescription>
                Create a new team organization to manage members and billing.
              </ModalDescription>
            </ModalHeader>

            <div className='flex flex-col gap-4.5'>
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
                <Label htmlFor='org-name-field' className='font-medium text-small'>
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
                <Label htmlFor='org-slug-field' className='font-medium text-small'>
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

            {error && <p className='text-[var(--text-error)] text-small leading-tight'>{error}</p>}

            <ModalFooter>
              <Button
                variant='active'
                onClick={() => setCreateOrgDialogOpen(false)}
                disabled={isCreatingOrg}
              >
                Cancel
              </Button>
              <Button
                variant='primary'
                onClick={onCreateOrganization}
                disabled={isCreatingOrg || !orgName.trim()}
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
    <div className='flex flex-col gap-5'>
      <div className='flex flex-col gap-2'>
        <h3 className='font-medium text-[var(--text-primary)] text-base'>No Team Workspace</h3>
        <p className='text-[var(--text-secondary)] text-small'>
          You don't have a team workspace yet. To collaborate with others, first upgrade to a team
          or enterprise plan.
        </p>
      </div>

      <div>
        <Button variant='primary' onClick={() => navigateToSettings({ section: 'subscription' })}>
          Upgrade to Team Plan
        </Button>
      </div>
    </div>
  )
}
