import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface OrganizationCreationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgName: string
  onOrgNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  orgSlug: string
  onOrgSlugChange: (slug: string) => void
  onCreateOrganization: () => Promise<void>
  isCreating: boolean
  error: string | null
}

export function OrganizationCreationDialog({
  open,
  onOpenChange,
  orgName,
  onOrgNameChange,
  orgSlug,
  onOrgSlugChange,
  onCreateOrganization,
  isCreating,
  error,
}: OrganizationCreationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team Workspace</DialogTitle>
          <DialogDescription>
            Create a workspace for your team to collaborate on projects.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          <div className='space-y-2'>
            <label htmlFor='orgName' className='font-medium text-xs'>
              Team Name
            </label>
            <Input id='orgName' value={orgName} onChange={onOrgNameChange} placeholder='My Team' />
          </div>

          <div className='space-y-2'>
            <label htmlFor='orgSlug' className='font-medium text-xs'>
              Team URL
            </label>
            <div className='flex items-center space-x-2'>
              <div className='rounded-l-[8px] bg-muted px-3 py-2 text-muted-foreground text-xs'>
                sim.ai/team/
              </div>
              <Input
                value={orgSlug}
                onChange={(e) => onOrgSlugChange(e.target.value)}
                className='rounded-l-none'
              />
            </div>
          </div>
        </div>

        {error && (
          <Alert variant='destructive' className='rounded-[8px]'>
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
            className='h-9 rounded-[8px]'
          >
            Cancel
          </Button>
          <Button
            onClick={onCreateOrganization}
            disabled={!orgName || !orgSlug || isCreating}
            className='h-9 rounded-[8px]'
          >
            {isCreating && <RefreshCw className='mr-2 h-4 w-4 animate-spin' />}
            Create Team Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
