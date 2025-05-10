import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
import { resetAllStores } from '@/stores'

const TOOLTIPS = {
  debugMode: 'Enable visual debugging information during execution.',
  autoConnect: 'Automatically connect nodes.',
  autoFillEnvVars: 'Automatically fill API keys.',
  resetData: 'Permanently delete all workflows, settings, and stored data.',
}

export function General() {
  const router = useRouter()
  const [retryCount, setRetryCount] = useState(0)

  const isLoading = useGeneralStore((state) => state.isLoading)
  const error = useGeneralStore((state) => state.error)
  const theme = useGeneralStore((state) => state.theme)
  const isAutoConnectEnabled = useGeneralStore((state) => state.isAutoConnectEnabled)
  const isDebugModeEnabled = useGeneralStore((state) => state.isDebugModeEnabled)
  const isAutoFillEnvVarsEnabled = useGeneralStore((state) => state.isAutoFillEnvVarsEnabled)

  const setTheme = useGeneralStore((state) => state.setTheme)
  const toggleAutoConnect = useGeneralStore((state) => state.toggleAutoConnect)
  const toggleDebugMode = useGeneralStore((state) => state.toggleDebugMode)
  const toggleAutoFillEnvVars = useGeneralStore((state) => state.toggleAutoFillEnvVars)
  const loadSettings = useGeneralStore((state) => state.loadSettings)

  useEffect(() => {
    const loadData = async () => {
      await loadSettings(retryCount > 0)
    }
    loadData()
  }, [loadSettings, retryCount])

  const handleThemeChange = (value: 'system' | 'light' | 'dark') => {
    setTheme(value)
  }

  const handleDebugModeChange = (checked: boolean) => {
    if (checked !== isDebugModeEnabled) {
      toggleDebugMode()
    }
  }

  const handleAutoConnectChange = (checked: boolean) => {
    if (checked !== isAutoConnectEnabled) {
      toggleAutoConnect()
    }
  }

  const handleAutoFillEnvVarsChange = (checked: boolean) => {
    if (checked !== isAutoFillEnvVarsEnabled) {
      toggleAutoFillEnvVars()
    }
  }

  const handleResetData = () => {
    resetAllStores()
    router.push('/w/1') // Redirect to home page after reset
  }

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1)
  }

  return (
    <div className="p-6 space-y-6">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex justify-between items-center">
            <span>Failed to load settings: {error}</span>
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={isLoading}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className="text-lg font-medium mb-[22px]">General Settings</h2>
        <div className="space-y-4">
          {isLoading ? (
            <>
              <SettingRowSkeleton />
              <SettingRowSkeleton />
              <SettingRowSkeleton />
              <SettingRowSkeleton />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="theme-select" className="font-medium">
                    Theme
                  </Label>
                </div>
                <Select value={theme} onValueChange={handleThemeChange} disabled={isLoading}>
                  <SelectTrigger id="theme-select" className="w-[180px]">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="debug-mode" className="font-medium">
                    Debug mode
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500 p-1 h-7"
                        aria-label="Learn more about debug mode"
                        disabled={isLoading}
                      >
                        <Info className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px] p-3">
                      <p className="text-sm">{TOOLTIPS.debugMode}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id="debug-mode"
                  checked={isDebugModeEnabled}
                  onCheckedChange={handleDebugModeChange}
                  disabled={isLoading}
                />
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="auto-connect" className="font-medium">
                    Auto-connect on drop
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500 p-1 h-7"
                        aria-label="Learn more about auto-connect feature"
                        disabled={isLoading}
                      >
                        <Info className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px] p-3">
                      <p className="text-sm">{TOOLTIPS.autoConnect}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id="auto-connect"
                  checked={isAutoConnectEnabled}
                  onCheckedChange={handleAutoConnectChange}
                  disabled={isLoading}
                />
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="auto-fill-env-vars" className="font-medium">
                    Auto-fill environment variables
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500 p-1 h-7"
                        aria-label="Learn more about auto-fill environment variables"
                        disabled={isLoading}
                      >
                        <Info className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px] p-3">
                      <p className="text-sm">{TOOLTIPS.autoFillEnvVars}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id="auto-fill-env-vars"
                  checked={isAutoFillEnvVarsEnabled}
                  onCheckedChange={handleAutoFillEnvVarsChange}
                  disabled={isLoading}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Danger Zone Section */}
      <div>
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <Label className="font-medium">Reset all data</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 p-1 h-7"
                  aria-label="Learn more about resetting all data"
                  disabled={isLoading}
                >
                  <Info className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[300px] p-3">
                <p className="text-sm">{TOOLTIPS.resetData}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isLoading}>
                Reset Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete all your workflows,
                  settings, and stored data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleResetData}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Reset Data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}

const SettingRowSkeleton = () => (
  <div className="flex items-center justify-between py-1">
    <div className="flex items-center gap-2">
      <Skeleton className="h-5 w-32" />
    </div>
    <Skeleton className="h-6 w-12" />
  </div>
)
