import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function General() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-medium mb-4">General Settings</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-1">
            <Label htmlFor="debug-mode" className="font-medium">
              Debug Mode
            </Label>
            <Switch id="debug-mode" />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label htmlFor="auto-save" className="font-medium">
              Auto-save Workflows
            </Label>
            <Switch id="auto-save" />
          </div>
        </div>
      </div>
    </div>
  )
}
