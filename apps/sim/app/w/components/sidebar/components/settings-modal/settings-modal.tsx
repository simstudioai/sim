'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { client, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useGeneralStore } from '@/stores/settings/general/store'
import { Account } from './components/account/account'
import { ApiKeys } from './components/api-keys/api-keys'
import { Credentials } from './components/credentials/credentials'
import { EnvironmentVariables } from './components/environment/environment'
import { General } from './components/general/general'
import { Privacy } from './components/privacy/privacy'
import { SettingsNavigation } from './components/settings-navigation/settings-navigation'
import { Subscription } from './components/subscription/subscription'
import { TeamManagement } from './components/team-management/team-management'

const logger = createLogger('SettingsModal')

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
  const [isPro, setIsPro] = useState(false)
  const [isTeam, setIsTeam] = useState(false)
  const [subscriptionData, setSubscriptionData] = useState<any>(null)
  const [usageData, setUsageData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const loadSettings = useGeneralStore((state) => state.loadSettings)
  const subscription = useMemo(() => useSubscription(), [])
  const hasLoadedInitialData = useRef(false)

  useEffect(() => {
    async function loadAllSettings() {
      if (!open) return

      if (hasLoadedInitialData.current) return

      setIsLoading(true)

      try {
        await loadSettings()

        const proStatusResponse = await fetch('/api/user/subscription')

        if (proStatusResponse.ok) {
          const subData = await proStatusResponse.json()
          setIsPro(subData.isPro)
          setIsTeam(subData.isTeam)

          if (!subData.isTeam && activeSection === 'team') {
            setActiveSection('general')
          }
        }

        const usageResponse = await fetch('/api/user/usage')
        if (usageResponse.ok) {
          const usageData = await usageResponse.json()
          setUsageData(usageData)
        }

        try {
          const result = await subscription.list()

          if (result.data && result.data.length > 0) {
            const activeSubscription = result.data.find(
              (sub) => sub.status === 'active' && (sub.plan === 'team' || sub.plan === 'pro')
            )

            if (activeSubscription) {
              setSubscriptionData(activeSubscription)
            }
          }
        } catch (error) {
          logger.error('Error fetching subscription information', error)
        }

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
  }, [open, loadSettings, subscription, activeSection])

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

  const isSubscriptionEnabled = !!client.subscription

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] h-[70vh] flex flex-col p-0 gap-0" hideCloseButton>
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">Settings</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Navigation Sidebar */}
          <div className="w-[200px] border-r">
            <SettingsNavigation
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              isTeam={isTeam}
            />
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
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
                <Subscription
                  onOpenChange={onOpenChange}
                  cachedIsPro={isPro}
                  cachedIsTeam={isTeam}
                  cachedUsageData={usageData}
                  cachedSubscriptionData={subscriptionData}
                  isLoading={isLoading}
                />
              </div>
            )}
            {isTeam && (
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
