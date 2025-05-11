import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WebhookDialogFooterProps {
  webhookId?: string
  webhookProvider: string
  isSaving: boolean
  isDeleting: boolean
  isLoadingToken: boolean
  isTesting: boolean
  isCurrentConfigValid: boolean
  onSave: () => void
  onDelete: () => void
  onTest: () => void
  onClose: () => void
}

export function WebhookDialogFooter({
  webhookId,
  webhookProvider,
  isSaving,
  isDeleting,
  isLoadingToken,
  isTesting,
  isCurrentConfigValid,
  onSave,
  onDelete,
  onTest,
  onClose,
}: WebhookDialogFooterProps) {
  return (
    <div className="flex w-full justify-between">
      <div>
        {webhookId && (
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={isDeleting || isSaving || isLoadingToken}
            size="default"
            className="h-10"
          >
            {isDeleting ? (
              <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent mr-2" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        {webhookId && webhookProvider !== 'gmail' && (
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={isTesting || isSaving || isDeleting || isLoadingToken || !webhookId}
            className="h-10"
          >
            {isTesting && (
              <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent mr-2" />
            )}
            {isTesting ? 'Testing...' : 'Test Webhook'}
          </Button>
        )}
        <Button variant="outline" onClick={onClose} size="default" className="h-10">
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={isLoadingToken || isSaving || !isCurrentConfigValid}
          className={cn(
            'h-10',
            !isLoadingToken && isCurrentConfigValid ? 'bg-primary hover:bg-primary/90' : '',
            isSaving &&
              'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20'
          )}
          size="default"
        >
          {isSaving && (
            <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent mr-2" />
          )}
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
