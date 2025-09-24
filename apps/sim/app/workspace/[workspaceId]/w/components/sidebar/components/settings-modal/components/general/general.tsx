import { useEffect } from 'react'
import { Info } from 'lucide-react'
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
import { getEnv, isTruthy } from '@/lib/env'
import { useGeneralStore } from '@/stores/settings/general/store'

const TOOLTIPS = {
  autoConnect: 'Automatically connect nodes.',
  autoPan: 'Automatically pan to active blocks during workflow execution.',
  consoleExpandedByDefault:
    'Show console entries expanded by default. When disabled, entries will be collapsed by default.',
  floatingControls:
    'Show floating controls for zoom, undo, and redo at the bottom of the workflow canvas.',
  trainingControls:
    'Show training controls for recording workflow edits to build copilot training datasets.',
}

export function General() {
  const isLoading = useGeneralStore((state) => state.isLoading)
  const isTrainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))
  const theme = useGeneralStore((state) => state.theme)
  const isAutoConnectEnabled = useGeneralStore((state) => state.isAutoConnectEnabled)

  const isAutoPanEnabled = useGeneralStore((state) => state.isAutoPanEnabled)
  const isConsoleExpandedByDefault = useGeneralStore((state) => state.isConsoleExpandedByDefault)
  const showFloatingControls = useGeneralStore((state) => state.showFloatingControls)
  const showTrainingControls = useGeneralStore((state) => state.showTrainingControls)

  // Loading states
  const isAutoConnectLoading = useGeneralStore((state) => state.isAutoConnectLoading)

  const isAutoPanLoading = useGeneralStore((state) => state.isAutoPanLoading)
  const isConsoleExpandedByDefaultLoading = useGeneralStore(
    (state) => state.isConsoleExpandedByDefaultLoading
  )
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)
  const isFloatingControlsLoading = useGeneralStore((state) => state.isFloatingControlsLoading)
  const isTrainingControlsLoading = useGeneralStore((state) => state.isTrainingControlsLoading)

  const setTheme = useGeneralStore((state) => state.setTheme)
  const toggleAutoConnect = useGeneralStore((state) => state.toggleAutoConnect)

  const toggleAutoPan = useGeneralStore((state) => state.toggleAutoPan)
  const toggleConsoleExpandedByDefault = useGeneralStore(
    (state) => state.toggleConsoleExpandedByDefault
  )
  const toggleFloatingControls = useGeneralStore((state) => state.toggleFloatingControls)
  const toggleTrainingControls = useGeneralStore((state) => state.toggleTrainingControls)

  // Sync theme from store to next-themes when theme changes
  useEffect(() => {
    if (!isLoading && theme) {
      // Ensure next-themes is in sync with our store
      const { syncThemeToNextThemes } = require('@/lib/theme-sync')
      syncThemeToNextThemes(theme)
    }
  }, [theme, isLoading])

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

  const handleFloatingControlsChange = async (checked: boolean) => {
    if (checked !== showFloatingControls && !isFloatingControlsLoading) {
      await toggleFloatingControls()
    }
  }

  const handleTrainingControlsChange = async (checked: boolean) => {
    if (checked !== showTrainingControls && !isTrainingControlsLoading) {
      await toggleTrainingControls()
    }
  }

  return (
    <div className='px-6 pt-4 pb-2'>
      <div className='flex flex-col gap-4'>
        {isLoading ? (
          <>
            {/* Theme setting with skeleton value */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='theme-select' className='font-normal'>
                  Theme
                </Label>
              </div>
              <Skeleton className='h-9 w-[180px]' />
            </div>

            {/* Auto-connect setting with skeleton value */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='auto-connect' className='font-normal'>
                  Auto-connect on drop
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 p-1 text-gray-500'
                      aria-label='Learn more about auto-connect feature'
                      disabled={true}
                    >
                      <Info className='h-5 w-5' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-[300px] p-3'>
                    <p className='text-sm'>{TOOLTIPS.autoConnect}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Skeleton className='h-6 w-11 rounded-full' />
            </div>

            {/* Console expanded setting with skeleton value */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='console-expanded-by-default' className='font-normal'>
                  Console expanded by default
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 p-1 text-gray-500'
                      aria-label='Learn more about console expanded by default'
                      disabled={true}
                    >
                      <Info className='h-5 w-5' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-[300px] p-3'>
                    <p className='text-sm'>{TOOLTIPS.consoleExpandedByDefault}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Skeleton className='h-6 w-11 rounded-full' />
            </div>
          </>
        ) : (
          <>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='theme-select' className='font-normal'>
                  Theme
                </Label>
              </div>
              <Select
                value={theme}
                onValueChange={handleThemeChange}
                disabled={isLoading || isThemeLoading}
              >
                <SelectTrigger id='theme-select' className='h-9 w-[180px]'>
                  <SelectValue placeholder='Select theme' />
                </SelectTrigger>
                <SelectContent className='min-w-32 rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'>
                  <SelectItem
                    value='system'
                    className='rounded-[8px] text-card-foreground text-sm hover:bg-muted focus:bg-muted'
                  >
                    System
                  </SelectItem>
                  <SelectItem
                    value='light'
                    className='rounded-[8px] text-card-foreground text-sm hover:bg-muted focus:bg-muted'
                  >
                    Light
                  </SelectItem>
                  <SelectItem
                    value='dark'
                    className='rounded-[8px] text-card-foreground text-sm hover:bg-muted focus:bg-muted'
                  >
                    Dark
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='auto-connect' className='font-normal'>
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

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='console-expanded-by-default' className='font-normal'>
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

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='floating-controls' className='font-normal'>
                  Floating controls
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 p-1 text-gray-500'
                      aria-label='Learn more about floating controls'
                      disabled={isLoading || isFloatingControlsLoading}
                    >
                      <Info className='h-5 w-5' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='max-w-[300px] p-3'>
                    <p className='text-sm'>{TOOLTIPS.floatingControls}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                id='floating-controls'
                checked={showFloatingControls}
                onCheckedChange={handleFloatingControlsChange}
                disabled={isLoading || isFloatingControlsLoading}
              />
            </div>

            {isTrainingEnabled && (
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='training-controls' className='font-normal'>
                    Training controls
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-5 w-5 p-0'
                        aria-label='Learn more about training controls'
                        disabled={isLoading || isTrainingControlsLoading}
                      >
                        <Info className='h-3.5 w-3.5 text-muted-foreground' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.trainingControls}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='training-controls'
                  checked={showTrainingControls}
                  onCheckedChange={handleTrainingControlsChange}
                  disabled={isLoading || isTrainingControlsLoading}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
