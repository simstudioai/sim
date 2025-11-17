import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
// COMMENTED OUT: Theme switching disabled - dark mode is forced for workspace
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useSession } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'

const TOOLTIPS = {
  autoConnect: 'Automatically connect nodes.',
  autoPan: 'Automatically pan to active blocks during workflow execution.',
  consoleExpandedByDefault:
    'Show console entries expanded by default. When disabled, entries will be collapsed by default.',
  floatingControls:
    'Show floating controls for zoom, undo, and redo at the bottom of the workflow canvas.',
  trainingControls:
    'Show training controls for recording workflow edits to build copilot training datasets.',
  superUserMode:
    'Toggle super user mode UI. When enabled, you can see and approve pending templates. Your super user status in the database remains unchanged.',
}

export function General() {
  const { data: session } = useSession()
  const [isSuperUser, setIsSuperUser] = useState(false)
  const [loadingSuperUser, setLoadingSuperUser] = useState(true)

  // React Query hooks - with placeholderData to show cached data immediately
  const { data: settings, isLoading } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()

  const isTrainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))

  // Fetch super user status from database
  useEffect(() => {
    const fetchSuperUserStatus = async () => {
      try {
        const response = await fetch('/api/user/super-user')
        if (response.ok) {
          const data = await response.json()
          setIsSuperUser(data.isSuperUser)
        }
      } catch (error) {
        console.error('Failed to fetch super user status:', error)
      } finally {
        setLoadingSuperUser(false)
      }
    }

    if (session?.user?.id) {
      fetchSuperUserStatus()
    }
  }, [session?.user?.id])

  const handleSuperUserModeToggle = async (checked: boolean) => {
    if (checked !== settings?.superUserModeEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'superUserModeEnabled', value: checked })
    }
  }

  // COMMENTED OUT: Theme switching disabled - dark mode is forced for workspace
  // // Sync theme from store to next-themes when theme changes
  // useEffect(() => {
  //   if (!isLoading && theme) {
  //     // Ensure next-themes is in sync with our store
  //     const { syncThemeToNextThemes } = require('@/lib/theme-sync')
  //     syncThemeToNextThemes(theme)
  //   }
  // }, [theme, isLoading])

  const handleThemeChange = async (value: 'system' | 'light' | 'dark') => {
    await updateSetting.mutateAsync({ key: 'theme', value })
  }

  const handleAutoConnectChange = async (checked: boolean) => {
    if (checked !== settings?.autoConnect && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'autoConnect', value: checked })
    }
  }

  const handleAutoPanChange = async (checked: boolean) => {
    if (checked !== settings?.autoPan && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'autoPan', value: checked })
    }
  }

  const handleConsoleExpandedByDefaultChange = async (checked: boolean) => {
    if (checked !== settings?.consoleExpandedByDefault && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'consoleExpandedByDefault', value: checked })
    }
  }

  const handleFloatingControlsChange = async (checked: boolean) => {
    if (checked !== settings?.showFloatingControls && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'showFloatingControls', value: checked })
    }
  }

  const handleTrainingControlsChange = async (checked: boolean) => {
    if (checked !== settings?.showTrainingControls && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'showTrainingControls', value: checked })
    }
  }

  return (
    <div className='px-6 pt-4 pb-2'>
      <div className='flex flex-col gap-4'>
        {/* COMMENTED OUT: Theme switching disabled - dark mode is forced for workspace */}
        {/* <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Label htmlFor='theme-select' className='font-normal'>
              Theme
            </Label>
          </div>
          <Select
            value={settings?.theme}
            onValueChange={handleThemeChange}
            disabled={updateSetting.isPending}
          >
            <SelectTrigger id='theme-select' className='h-9 w-[180px]'>
              <SelectValue placeholder='Select theme' />
            </SelectTrigger>
            <SelectContent className='min-w-32 rounded-[10px] border-[#E5E5E5] bg-[var(--white)] shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'>
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
        </div> */}

        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Label htmlFor='auto-connect' className='font-normal'>
              Auto-connect on drop
            </Label>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 p-1 text-gray-500'
                  aria-label='Learn more about auto-connect feature'
                  disabled={updateSetting.isPending}
                >
                  <Info className='h-5 w-5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top' className='max-w-[300px] p-3'>
                <p className='text-sm'>{TOOLTIPS.autoConnect}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <Switch
            id='auto-connect'
            checked={settings?.autoConnect ?? true}
            onCheckedChange={handleAutoConnectChange}
            disabled={updateSetting.isPending}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Label htmlFor='console-expanded-by-default' className='font-normal'>
              Console expanded by default
            </Label>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 p-1 text-gray-500'
                  aria-label='Learn more about console expanded by default'
                  disabled={updateSetting.isPending}
                >
                  <Info className='h-5 w-5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top' className='max-w-[300px] p-3'>
                <p className='text-sm'>{TOOLTIPS.consoleExpandedByDefault}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <Switch
            id='console-expanded-by-default'
            checked={settings?.consoleExpandedByDefault ?? true}
            onCheckedChange={handleConsoleExpandedByDefaultChange}
            disabled={updateSetting.isPending}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Label htmlFor='floating-controls' className='font-normal'>
              Floating controls
            </Label>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 p-1 text-gray-500'
                  aria-label='Learn more about floating controls'
                  disabled={updateSetting.isPending}
                >
                  <Info className='h-5 w-5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top' className='max-w-[300px] p-3'>
                <p className='text-sm'>{TOOLTIPS.floatingControls}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <Switch
            id='floating-controls'
            checked={settings?.showFloatingControls ?? true}
            onCheckedChange={handleFloatingControlsChange}
            disabled={updateSetting.isPending}
          />
        </div>

        {isTrainingEnabled && (
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Label htmlFor='training-controls' className='font-normal'>
                Training controls
              </Label>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5 p-0'
                    aria-label='Learn more about training controls'
                    disabled={updateSetting.isPending}
                  >
                    <Info className='h-3.5 w-3.5 text-muted-foreground' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.trainingControls}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
            <Switch
              id='training-controls'
              checked={settings?.showTrainingControls ?? false}
              onCheckedChange={handleTrainingControlsChange}
              disabled={updateSetting.isPending}
            />
          </div>
        )}

        {/* Super User Mode Toggle - Only visible to super users */}
        {!loadingSuperUser && isSuperUser && (
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Label htmlFor='super-user-mode' className='font-normal'>
                Super User Mode
              </Label>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7 p-1 text-gray-500'
                    aria-label='Learn more about super user mode'
                    disabled={updateSetting.isPending}
                  >
                    <Info className='h-5 w-5' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.superUserMode}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
            <Switch
              id='super-user-mode'
              checked={settings?.superUserModeEnabled ?? true}
              onCheckedChange={handleSuperUserModeToggle}
              disabled={updateSetting.isPending}
            />
          </div>
        )}
      </div>
    </div>
  )
}
