'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { Modal, ModalContent, ModalDescription, ModalTitle } from '@/components/emcn'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  Account,
  ApiKeys,
  Copilot,
  Credentials,
  CustomTools,
  EnvironmentVariables,
  FileUploads,
  General,
  MCP,
  Privacy,
  SettingsNavigation,
  SSO,
  Subscription,
  TeamManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components'
import { CreatorProfile } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components/creator-profile/creator-profile'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { useOrganizations } from '@/hooks/queries/organization'

const logger = createLogger('SettingsModal')

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection =
  | 'general'
  | 'environment'
  | 'account'
  | 'creator-profile'
  | 'credentials'
  | 'apikeys'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'privacy'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const environmentCloseHandler = useRef<((open: boolean) => void) | null>(null)
  const credentialsCloseHandler = useRef<((open: boolean) => void) | null>(null)

  // Memoized callbacks to prevent infinite loops in child components
  const registerEnvironmentCloseHandler = useCallback((handler: (open: boolean) => void) => {
    environmentCloseHandler.current = handler
  }, [])

  const registerCredentialsCloseHandler = useCallback((handler: (open: boolean) => void) => {
    credentialsCloseHandler.current = handler
  }, [])

  // React Query hook automatically loads and syncs settings
  // No need for manual loading logic - placeholderData provides instant UI
  useGeneralSettings()

  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<{ tab: SettingsSection }>) => {
      setActiveSection(event.detail.tab)
      onOpenChange(true)
    }

    const handleCloseSettings = () => {
      onOpenChange(false)
    }

    window.addEventListener('open-settings', handleOpenSettings as EventListener)
    window.addEventListener('close-settings', handleCloseSettings as EventListener)

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener)
      window.removeEventListener('close-settings', handleCloseSettings as EventListener)
    }
  }, [onOpenChange])

  // Redirect away from billing tabs if billing is disabled
  useEffect(() => {
    if (!isBillingEnabled && (activeSection === 'subscription' || activeSection === 'team')) {
      setActiveSection('general')
    }
  }, [activeSection])

  // Handle dialog close - delegate to environment component if it's active
  const handleDialogOpenChange = (newOpen: boolean) => {
    if (!newOpen && activeSection === 'environment' && environmentCloseHandler.current) {
      environmentCloseHandler.current(newOpen)
    } else if (!newOpen && activeSection === 'credentials' && credentialsCloseHandler.current) {
      credentialsCloseHandler.current(newOpen)
    } else {
      onOpenChange(newOpen)
    }
  }

  return (
    <Modal open={open} onOpenChange={handleDialogOpenChange}>
      <ModalContent className='flex h-[70vh] w-full max-w-[840px] flex-col gap-0 p-0'>
        <VisuallyHidden.Root>
          <ModalTitle>Settings</ModalTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root>
          <ModalDescription>
            Configure your workspace settings, environment variables, credentials, and preferences
          </ModalDescription>
        </VisuallyHidden.Root>
        <div className='flex flex-col border-[var(--surface-11)] border-b px-[16px] py-[12px]'>
          <h2 className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
            Settings
          </h2>
        </div>

        <div className='flex min-h-0 flex-1'>
          {/* Navigation Sidebar */}
          <div className='w-[180px] border-[var(--surface-11)] border-r'>
            <SettingsNavigation
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              hasOrganization={!!activeOrganization?.id}
            />
          </div>

          {/* Content Area */}
          <div className='flex-1 overflow-y-auto'>
            {activeSection === 'general' && (
              <div className='h-full'>
                <General />
              </div>
            )}
            {activeSection === 'environment' && (
              <div className='h-full'>
                <EnvironmentVariables
                  onOpenChange={onOpenChange}
                  registerCloseHandler={registerEnvironmentCloseHandler}
                />
              </div>
            )}
            {activeSection === 'account' && (
              <div className='h-full'>
                <Account onOpenChange={onOpenChange} />
              </div>
            )}
            {activeSection === 'creator-profile' && (
              <div className='h-full'>
                <CreatorProfile />
              </div>
            )}
            {activeSection === 'credentials' && (
              <div className='h-full'>
                <Credentials
                  onOpenChange={onOpenChange}
                  registerCloseHandler={registerCredentialsCloseHandler}
                />
              </div>
            )}
            {activeSection === 'apikeys' && (
              <div className='h-full'>
                <ApiKeys onOpenChange={onOpenChange} />
              </div>
            )}
            {activeSection === 'files' && (
              <div className='h-full'>
                <FileUploads />
              </div>
            )}
            {isBillingEnabled && activeSection === 'subscription' && (
              <div className='h-full'>
                <Subscription onOpenChange={onOpenChange} />
              </div>
            )}
            {isBillingEnabled && activeSection === 'team' && (
              <div className='h-full'>
                <TeamManagement />
              </div>
            )}
            {activeSection === 'sso' && (
              <div className='h-full'>
                <SSO />
              </div>
            )}
            {activeSection === 'copilot' && (
              <div className='h-full'>
                <Copilot />
              </div>
            )}
            {activeSection === 'privacy' && (
              <div className='h-full'>
                <Privacy />
              </div>
            )}
            {activeSection === 'mcp' && (
              <div className='h-full'>
                <MCP />
              </div>
            )}
            {activeSection === 'custom-tools' && (
              <div className='h-full'>
                <CustomTools />
              </div>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
