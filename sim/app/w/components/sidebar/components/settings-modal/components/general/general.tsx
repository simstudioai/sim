import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'
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
  const isAutoConnectEnabled = useGeneralStore((state) => state.isAutoConnectEnabled)
  const toggleAutoConnect = useGeneralStore((state) => state.toggleAutoConnect)
  const isDebugModeEnabled = useGeneralStore((state) => state.isDebugModeEnabled)
  const toggleDebugMode = useGeneralStore((state) => state.toggleDebugMode)
  const isAutoFillEnvVarsEnabled = useGeneralStore((state) => state.isAutoFillEnvVarsEnabled)
  const toggleAutoFillEnvVars = useGeneralStore((state) => state.toggleAutoFillEnvVars)
  const theme = useGeneralStore((state) => state.theme)
  const setTheme = useGeneralStore((state) => state.setTheme)

  const handleResetData = () => {
    resetAllStores()
    router.push('/w/1') // Redirect to home page after reset
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-medium mb-[22px]">General Settings</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="theme-select" className="font-medium">
                Theme
              </Label>
            </div>
            <Select value={theme} onValueChange={setTheme}>
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
              onCheckedChange={toggleDebugMode}
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
              onCheckedChange={toggleAutoConnect}
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
              onCheckedChange={toggleAutoFillEnvVars}
            />
          </div>
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
              <Button variant="destructive" size="sm">
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
