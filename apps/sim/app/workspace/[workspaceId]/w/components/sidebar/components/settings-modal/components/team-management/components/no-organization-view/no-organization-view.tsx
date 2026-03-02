'use client'

import { useTranslations } from 'next-intl'
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
  const t = useTranslations()

  if (hasTeamPlan || hasEnterprisePlan) {
    return (
      <div>
        <div className='flex flex-col gap-[20px]'>
          {/* Header - matching settings page style */}
          <div>
            <h4 className='font-medium text-[14px] text-[var(--text-primary)]'>
              {t('settings.no_organization.title')}
            </h4>
            <p className='mt-[4px] text-[12px] text-[var(--text-muted)]'>
              {t('settings.no_organization.description', {
                plan: hasEnterprisePlan
                  ? t('settings.no_organization.plans.enterprise')
                  : t('settings.no_organization.plans.team'),
              })}
            </p>
          </div>

          {/* Form fields - clean layout without card */}
          <div className='flex flex-col gap-[16px]'>
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
              <Label htmlFor='team-name-field' className='font-medium text-[12px]'>
                {t('settings.no_organization.labels.team_name')}
              </Label>
              <Input
                id='team-name-field'
                value={orgName}
                onChange={onOrgNameChange}
                placeholder={t('settings.no_organization.placeholders.team_name')}
                className='mt-[4px]'
                name='team_name_field'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
            </div>

            <div>
              <Label htmlFor='orgSlug' className='font-medium text-[12px]'>
                {t('settings.no_organization.labels.team_url')}
              </Label>
              <div className='mt-[4px] flex items-center'>
                <div className='rounded-l-[6px] border border-[var(--border-1)] border-r-0 bg-[var(--surface-4)] px-[12px] py-[6px] text-[12px] text-[var(--text-muted)]'>
                  sim.ai/team/
                </div>
                <Input
                  id='orgSlug'
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  placeholder={t('settings.no_organization.placeholders.team_url')}
                  className='rounded-l-none'
                />
              </div>
            </div>

            <div className='flex flex-col gap-[8px]'>
              {error && (
                <p className='text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>
              )}
              <div className='flex justify-end'>
                <Button
                  variant='tertiary'
                  onClick={onCreateOrganization}
                  disabled={!orgName || !orgSlug || isCreatingOrg}
                >
                  {isCreatingOrg
                    ? t('settings.no_organization.buttons.creating')
                    : t('settings.no_organization.buttons.create_team_workspace')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Modal open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
          <ModalContent className='sm:max-w-md'>
            <ModalHeader>
              <ModalTitle>{t('settings.no_organization.modal.title')}</ModalTitle>
              <ModalDescription>{t('settings.no_organization.modal.description')}</ModalDescription>
            </ModalHeader>

            <div className='flex flex-col gap-[16px]'>
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
                <Label htmlFor='org-name-field' className='font-medium text-[12px]'>
                  {t('settings.no_organization.labels.organization_name')}
                </Label>
                <Input
                  id='org-name-field'
                  placeholder={t('settings.no_organization.placeholders.organization_name')}
                  value={orgName}
                  onChange={onOrgNameChange}
                  disabled={isCreatingOrg}
                  className='mt-[4px]'
                  name='org_name_field'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              </div>

              <div>
                <Label htmlFor='org-slug-field' className='font-medium text-[12px]'>
                  {t('settings.no_organization.labels.organization_slug')}
                </Label>
                <Input
                  id='org-slug-field'
                  placeholder={t('settings.no_organization.placeholders.organization_slug')}
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  disabled={isCreatingOrg}
                  className='mt-[4px]'
                  name='org_slug_field'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              </div>
            </div>

            {error && <p className='text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>}

            <ModalFooter>
              <Button
                variant='active'
                onClick={() => setCreateOrgDialogOpen(false)}
                disabled={isCreatingOrg}
              >
                {t('settings.no_organization.buttons.cancel')}
              </Button>
              <Button
                variant='tertiary'
                onClick={onCreateOrganization}
                disabled={isCreatingOrg || !orgName.trim()}
              >
                {isCreatingOrg
                  ? t('settings.no_organization.buttons.creating')
                  : t('settings.no_organization.buttons.create_organization')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-[20px]'>
      <div className='flex flex-col gap-[8px]'>
        <h3 className='font-medium text-[14px] text-[var(--text-primary)]'>
          {t('settings.no_organization.no_workspace_title')}
        </h3>
        <p className='text-[12px] text-[var(--text-secondary)]'>
          {t('settings.no_organization.no_workspace_description')}
        </p>
      </div>

      <div>
        <Button
          variant='tertiary'
          onClick={() => {
            const event = new CustomEvent('open-settings', {
              detail: { tab: 'subscription' },
            })
            window.dispatchEvent(event)
          }}
        >
          {t('settings.no_organization.buttons.upgrade_to_team')}
        </Button>
      </div>
    </div>
  )
}
