import { useEffect, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGeneralStore } from '@/stores/settings/general/store'

const TOOLTIPS = {
  autoConnect: 'Automatically connect nodes.',
  autoPan: 'Automatically pan to active blocks during workflow execution.',
  consoleExpandedByDefault:
    'Show console entries expanded by default. When disabled, entries will be collapsed by default.',
}

export function General() {
  const [retryCount, setRetryCount] = useState(0)

  const isLoading = useGeneralStore((state) => state.isLoading)
  const error = useGeneralStore((state) => state.error)
  const theme = useGeneralStore((state) => state.theme)
  const isAutoConnectEnabled = useGeneralStore((state) => state.isAutoConnectEnabled)

  const isAutoPanEnabled = useGeneralStore((state) => state.isAutoPanEnabled)
  const isConsoleExpandedByDefault = useGeneralStore((state) => state.isConsoleExpandedByDefault)

  // Loading states
  const isAutoConnectLoading = useGeneralStore((state) => state.isAutoConnectLoading)

  const isAutoPanLoading = useGeneralStore((state) => state.isAutoPanLoading)
  const isConsoleExpandedByDefaultLoading = useGeneralStore(
    (state) => state.isConsoleExpandedByDefaultLoading
  )
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)

  const setTheme = useGeneralStore((state) => state.setTheme)
  const toggleAutoConnect = useGeneralStore((state) => state.toggleAutoConnect)

  const toggleAutoPan = useGeneralStore((state) => state.toggleAutoPan)
  const toggleConsoleExpandedByDefault = useGeneralStore(
    (state) => state.toggleConsoleExpandedByDefault
  )
  const loadSettings = useGeneralStore((state) => state.loadSettings)

  useEffect(() => {
    const loadData = async () => {
      await loadSettings(retryCount > 0)
    }
    loadData()
  }, [loadSettings, retryCount])

  const handleThemeChange = async (value: 'system' | 'light' | 'dark') => {
    await setTheme(value)
  }

  const handleAutoConnectChange = async (checked: boolean) => {
    if (checked !== isAutoConnectEnabled && !isAutoConnectLoading) {
      await toggleAutoConnect()
    }
  }

  const handleAutoPanChange = async (checked: boolean) => {
    if (checked !== isAutoPanEnabled && !isAutoPanLoading) {
      await toggleAutoPan()
    }
  }

  const handleConsoleExpandedByDefaultChange = async (checked: boolean) => {
    if (checked !== isConsoleExpandedByDefault && !isConsoleExpandedByDefaultLoading) {
      await toggleConsoleExpandedByDefault()
    }
  }

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1)
  }

  return (
    <div className='space-y-6 p-6'>
      {error && (
        <Alert variant='destructive' className='mb-4'>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription className='flex items-center justify-between'>
            <span>Failed to load settings: {error}</span>
            <Button variant='outline' size='sm' onClick={handleRetry} disabled={isLoading}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className='mb-[22px] font-medium text-lg'>General Settings</h2>
        <div className='space-y-4'>
          {isLoading ? (
            <>
              <SettingRowSkeleton />
              <SettingRowSkeleton />
              <SettingRowSkeleton />
              <SettingRowSkeleton />
            </>
          ) : (
            <>
              <div className='flex items-center justify-between py-1'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='theme-select' className='font-medium'>
                    Theme
                  </Label>
                </div>
                <Select
                  value={theme}
                  onValueChange={handleThemeChange}
                  disabled={isLoading || isThemeLoading}
                >
                  <SelectTrigger id='theme-select' className='w-[180px]'>
                    <SelectValue placeholder='Select theme' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='system'>System</SelectItem>
                    <SelectItem value='light'>Light</SelectItem>
                    <SelectItem value='dark'>Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex items-center justify-between py-1'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='auto-connect' className='font-medium'>
                    Auto-connect on drop
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about auto-connect feature'
                        disabled={isLoading || isAutoConnectLoading}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.autoConnect}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='auto-connect'
                  checked={isAutoConnectEnabled}
                  onCheckedChange={handleAutoConnectChange}
                  disabled={isLoading || isAutoConnectLoading}
                />
              </div>

              <div className='flex items-center justify-between py-1'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='console-expanded-by-default' className='font-medium'>
                    Console expanded by default
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about console expanded by default'
                        disabled={isLoading || isConsoleExpandedByDefaultLoading}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.consoleExpandedByDefault}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='console-expanded-by-default'
                  checked={isConsoleExpandedByDefault}
                  onCheckedChange={handleConsoleExpandedByDefaultChange}
                  disabled={isLoading || isConsoleExpandedByDefaultLoading}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const SettingRowSkeleton = () => (
  <div className='flex items-center justify-between py-1'>
    <div className='flex items-center gap-2'>
      <Skeleton className='h-5 w-32' />
    </div>
    <Skeleton className='h-6 w-12' />
  </div>
)
