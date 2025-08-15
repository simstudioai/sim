'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  Account,
  ApiKeys,
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

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [isLoading, setIsLoading] = useState(true)
  const loadSettings = useGeneralStore((state) => state.loadSettings)
  const { activeOrganization } = useOrganizationStore()
  const hasLoadedInitialData = useRef(false)

  useEffect(() => {
    async function loadAllSettings() {
      if (!open) return

      if (hasLoadedInitialData.current) return

      setIsLoading(true)

      try {
        await loadSettings()
        hasLoadedInitialData.current = true
      } catch (error) {
        logger.error('Error loading settings data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (open) {
      loadAllSettings()
    } else {
      hasLoadedInitialData.current = false
    }
  }, [open, loadSettings])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[70vh] flex-col gap-0 p-0 sm:max-w-[800px]' hideCloseButton>
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Settings</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='flex min-h-0 flex-1'>
          {/* Navigation Sidebar */}
          <div className='w-[200px] border-r'>
            <SettingsNavigation
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              hasOrganization={!!activeOrganization?.id}
            />
          </div>

          {/* Content Area */}
          <div className='flex-1 overflow-y-auto'>
            <div className={cn('h-full', activeSection === 'general' ? 'block' : 'hidden')}>
              <General />
            </div>
            <div className={cn('h-full', activeSection === 'environment' ? 'block' : 'hidden')}>
              <EnvironmentVariables onOpenChange={onOpenChange} />
            </div>
            <div className={cn('h-full', activeSection === 'account' ? 'block' : 'hidden')}>
              <Account onOpenChange={onOpenChange} />
            </div>
            <div className={cn('h-full', activeSection === 'credentials' ? 'block' : 'hidden')}>
              <Credentials onOpenChange={onOpenChange} />
            </div>
            <div className={cn('h-full', activeSection === 'apikeys' ? 'block' : 'hidden')}>
              <ApiKeys onOpenChange={onOpenChange} />
            </div>
            {isSubscriptionEnabled && (
              <div className={cn('h-full', activeSection === 'subscription' ? 'block' : 'hidden')}>
                <Subscription onOpenChange={onOpenChange} />
              </div>
            )}
            {isBillingEnabled && (
              <div className={cn('h-full', activeSection === 'team' ? 'block' : 'hidden')}>
                <TeamManagement />
              </div>
            )}
            <div className={cn('h-full', activeSection === 'privacy' ? 'block' : 'hidden')}>
              <Privacy />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
