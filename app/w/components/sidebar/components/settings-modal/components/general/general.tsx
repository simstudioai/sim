import { useRouter } from 'next/navigation'
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
import { useGeneralStore } from '@/stores/settings/general/store'
import { resetAllStores } from '@/stores'

export function General() {
  const router = useRouter()
  const isAutoConnectEnabled = useGeneralStore((state) => state.isAutoConnectEnabled)
  const toggleAutoConnect = useGeneralStore((state) => state.toggleAutoConnect)
  const isDebugModeEnabled = useGeneralStore((state) => state.isDebugModeEnabled)
  const toggleDebugMode = useGeneralStore((state) => state.toggleDebugMode)
  const theme = useGeneralStore((state) => state.theme)
  const setTheme = useGeneralStore((state) => state.setTheme)

  const handleResetData = () => {
    resetAllStores()
    router.push('/w/1') // Redirect to home page after reset
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-medium mb-4">General Settings</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-1">
            <Label htmlFor="theme-select" className="font-medium">
              Theme
            </Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between py-1">
            <Label htmlFor="debug-mode" className="font-medium">
              Debug mode
            </Label>
            <Switch
              id="debug-mode"
              checked={isDebugModeEnabled}
              onCheckedChange={toggleDebugMode}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label htmlFor="auto-connect" className="font-medium">
              Auto-connect on drop
            </Label>
            <Switch
              id="auto-connect"
              checked={isAutoConnectEnabled}
              onCheckedChange={toggleAutoConnect}
            />
          </div>
        </div>
      </div>

      {/* Danger Zone Section */}
      <div>
        <div className="flex items-center justify-between py-1">
          <Label className="font-medium">Reset all data</Label>
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
