'use client'

import { useEffect } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGeneralStore } from '@/stores/settings/general/store'

const TOOLTIPS = {
  telemetry:
    'We collect anonymous data about feature usage, performance, and errors to improve the application.',
}

export function Privacy() {
  const isLoading = useGeneralStore((state) => state.isLoading)
  const telemetryEnabled = useGeneralStore((state) => state.telemetryEnabled)
  const setTelemetryEnabled = useGeneralStore((state) => state.setTelemetryEnabled)
  const loadSettings = useGeneralStore((state) => state.loadSettings)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleTelemetryToggle = (checked: boolean) => {
    setTelemetryEnabled(checked)

    if (checked) {
      if (typeof window !== 'undefined') {
        fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'consent',
            action: 'enable_from_settings',
            timestamp: new Date().toISOString(),
          }),
        }).catch(() => {
          // Silently fail - this is just telemetry
        })
      }
    }
  }

  return (
    <div className='space-y-6 p-6'>
      <div>
        <h2 className='mb-[22px] font-medium text-lg'>Privacy Settings</h2>
        <div className='space-y-4'>
          {isLoading ? (
            <SettingRowSkeleton />
          ) : (
            <div className='flex items-center justify-between py-1'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='telemetry' className='font-medium'>
                  Allow anonymous telemetry
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 p-1 text-gray-500'
                      aria-label='Learn more about telemetry data collection'
                    >
                      <Info className='h-5 w-5' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-[300px] p-3'>
                    <p className='text-sm'>{TOOLTIPS.telemetry}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                id='telemetry'
                checked={telemetryEnabled}
                onCheckedChange={handleTelemetryToggle}
                disabled={isLoading}
              />
            </div>
          )}
        </div>
      </div>

      <div className='border-t pt-4'>
        <p className='text-muted-foreground text-xs'>
          We use OpenTelemetry to collect anonymous usage data to improve Sim. All data is collected
          in accordance with our privacy policy, and you can opt-out at any time. This setting
          applies to your account on all devices.
        </p>
      </div>
    </div>
  )
}

const SettingRowSkeleton = () => (
  <div className='flex items-center justify-between py-1'>
    <div className='flex items-center gap-2'>
      <Skeleton className='h-5 w-48' />
    </div>
    <Skeleton className='h-6 w-12' />
  </div>
)
