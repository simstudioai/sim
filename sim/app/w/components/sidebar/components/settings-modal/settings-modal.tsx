'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { client } from '@/lib/auth-client'
import { Account } from './components/account/account'
import { ApiKeys } from './components/api-keys/api-keys'
import { Credentials } from './components/credentials/credentials'
import { EnvironmentVariables } from './components/environment/environment'
import { General } from './components/general/general'
import { Subscription } from './components/subscription/subscription'
import { SettingsNavigation } from './components/settings-navigation/settings-navigation'
import { TeamManagement } from './components/team-management/team-management'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SettingsModal')

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection = 'general' | 'environment' | 'account' | 'credentials' | 'apikeys' | 'subscription' | 'team'

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [isTeam, setIsTeam] = useState(false)

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

  // Check if user is on team plan
  useEffect(() => {
    async function checkTeamPlan() {
      try {
        const response = await fetch('/api/user/subscription')
        if (response.ok) {
          const data = await response.json()
          setIsTeam(data.isTeam)
          
          if (!data.isTeam && activeSection === 'team') {
            setActiveSection('general')
          }
        }
      } catch (error) {
        logger.error('Error checking team plan:', error)
      }
    }
    
    if (open) {
      checkTeamPlan()
    }
  }, [open, activeSection])

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
            {isSubscriptionEnabled && (
              <div className={cn('h-full', activeSection === 'subscription' ? 'block' : 'hidden')}>
                <Subscription onOpenChange={onOpenChange} />
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
