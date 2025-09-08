'use client'

import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui'
import { getEnv, isTruthy } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  Account,
  ApiKeys,
  Copilot,
  Credentials,
  EnvironmentVariables,
  General,
  Privacy,
  SettingsNavigation,
  Subscription,
  TeamManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components'
import { useOrganizationStore } from '@/stores/organization'
import { useGeneralStore } from '@/stores/settings/general/store'

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
  | 'credentials'
  | 'apikeys'
  | 'subscription'
  | 'team'
  | 'privacy'
  | 'copilot'

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [isLoading, setIsLoading] = useState(true)
  const loadSettings = useGeneralStore((state) => state.loadSettings)
  const { activeOrganization } = useOrganizationStore()
  const hasLoadedInitialData = useRef(false)
  const hasLoadedGeneral = useRef(false)
  const environmentCloseHandler = useRef<((open: boolean) => void) | null>(null)
  const credentialsCloseHandler = useRef<((open: boolean) => void) | null>(null)

  useEffect(() => {
    async function loadGeneralIfNeeded() {
      if (!open) return
      if (activeSection !== 'general') return
      if (hasLoadedGeneral.current) return
      setIsLoading(true)
      try {
        await loadSettings()
        hasLoadedGeneral.current = true
        hasLoadedInitialData.current = true
      } catch (error) {
        logger.error('Error loading general settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (open) {
      void loadGeneralIfNeeded()
    } else {
      hasLoadedInitialData.current = false
      hasLoadedGeneral.current = false
    }
  }, [open, activeSection, loadSettings])

  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<{ tab: SettingsSection }>) => {
      setActiveSection(event.detail.tab)
      onOpenChange(true)
    }

    window.addEventListener('open-settings', handleOpenSettings as EventListener)

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener)
    }
  }, [onOpenChange])

  // Redirect away from billing tabs if billing is disabled
  useEffect(() => {
    if (!isBillingEnabled && (activeSection === 'subscription' || activeSection === 'team')) {
      setActiveSection('general')
    }
  }, [activeSection])

  const isSubscriptionEnabled = isBillingEnabled

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
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className='flex h-[70vh] flex-col gap-0 p-0 sm:max-w-[840px]'>
        <DialogHeader className='border-b px-6 py-4'>
          <DialogTitle className='font-medium text-lg'>Settings</DialogTitle>
        </DialogHeader>

        <div className='flex min-h-0 flex-1'>
          {/* Navigation Sidebar */}
          <div className='w-[180px]'>
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
                  registerCloseHandler={(handler) => {
                    environmentCloseHandler.current = handler
                  }}
                />
              </div>
            )}
            {activeSection === 'account' && (
              <div className='h-full'>
                <Account onOpenChange={onOpenChange} />
              </div>
            )}
            {activeSection === 'credentials' && (
              <div className='h-full'>
                <Credentials
                  onOpenChange={onOpenChange}
                  registerCloseHandler={(handler) => {
                    credentialsCloseHandler.current = handler
                  }}
                />
              </div>
            )}
            {activeSection === 'apikeys' && (
              <div className='h-full'>
                <ApiKeys onOpenChange={onOpenChange} />
              </div>
            )}
            {isSubscriptionEnabled && activeSection === 'subscription' && (
              <div className='h-full'>
                <Subscription onOpenChange={onOpenChange} />
              </div>
            )}
            {isBillingEnabled && activeSection === 'team' && (
              <div className='h-full'>
                <TeamManagement />
              </div>
            )}
            {isHosted && activeSection === 'copilot' && (
              <div className='h-full'>
                <Copilot />
              </div>
            )}
            {activeSection === 'privacy' && (
              <div className='h-full'>
                <Privacy />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
