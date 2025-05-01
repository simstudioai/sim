'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { client, useSubscription } from '@/lib/auth-client'
import { useGeneralStore } from '@/stores/settings/general/store'
import { Account } from './components/account/account'
import { ApiKeys } from './components/api-keys/api-keys'
import { Credentials } from './components/credentials/credentials'
import { EnvironmentVariables } from './components/environment/environment'
import { General } from './components/general/general'
import { Privacy } from './components/privacy/privacy'
import { Subscription } from './components/subscription/subscription'
import { SettingsNavigation } from './components/settings-navigation/settings-navigation'
import { TeamManagement } from './components/team-management/team-management'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SettingsModal')

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection = 'general' | 'environment' | 'account' | 'credentials' | 'apikeys' | 'subscription' | 'team' | 'privacy'

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [isPro, setIsPro] = useState(false)
  const [isTeam, setIsTeam] = useState(false)
  const [subscriptionData, setSubscriptionData] = useState<any>(null)
  const [usageData, setUsageData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const loadSettings = useGeneralStore(state => state.loadSettings)
  const subscription = useMemo(() => useSubscription(), [])
  const hasLoadedInitialData = useRef(false)

  // Load all settings data when the modal is opened
  useEffect(() => {
    async function loadAllSettings() {
      if (!open) return
      
      // Skip if we already loaded data in this session
      if (hasLoadedInitialData.current) return
      
      setIsLoading(true)
      
      try {
        // Load general settings
        await loadSettings()
        
        // Fetch subscription status
        const proStatusResponse = await fetch('/api/user/subscription')
        
        if (proStatusResponse.ok) {
          const subData = await proStatusResponse.json()
          setIsPro(subData.isPro)
          setIsTeam(subData.isTeam)
          
          // Reset active section if user doesn't have team access
          if (!subData.isTeam && activeSection === 'team') {
            setActiveSection('general')
          }
        }
        
        // Fetch usage data
        const usageResponse = await fetch('/api/user/usage')
        if (usageResponse.ok) {
          const usageData = await usageResponse.json()
          setUsageData(usageData)
        }
        
        // Load subscription details
        try {
          const result = await subscription.list()
          
          if (result.data && result.data.length > 0) {
            const activeSubscription = result.data.find(
              sub => sub.status === 'active' && (sub.plan === 'team' || sub.plan === 'pro')
            )
            
            if (activeSubscription) {
              setSubscriptionData(activeSubscription)
            }
          }
        } catch (error) {
          logger.error('Error fetching subscription information', error)
        }
        
        // Mark data as loaded
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
      // Reset the flag when modal is closed so data refreshes on next open
      hasLoadedInitialData.current = false
    }
  }, [open, loadSettings, subscription, activeSection])

  // Listen for the custom event to open the settings modal with a specific tab
  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<{ tab: SettingsSection }>) => {
      setActiveSection(event.detail.tab)
      onOpenChange(true)
    }

    // Add event listener
    window.addEventListener('open-settings', handleOpenSettings as EventListener)

    // Clean up
    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener)
    }
  }, [onOpenChange])

  // Check if subscriptions are enabled
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
            <div className={cn('h-full', activeSection === 'privacy' ? 'block' : 'hidden')}>
              <Privacy />
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
