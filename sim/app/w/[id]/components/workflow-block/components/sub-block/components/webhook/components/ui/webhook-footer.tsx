import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'

interface WebhookDialogFooterProps {
  webhookId: string | undefined
  webhookProvider: string
  isSaving: boolean
  isDeleting: boolean
  isLoadingToken: boolean
  isTesting: boolean
  isCurrentConfigValid: boolean
  onSave: () => void
  onDelete: () => void
  onTest?: () => void
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
  const showTestButton =
    webhookId &&
    (webhookProvider === 'whatsapp' ||
      webhookProvider === 'generic' ||
      webhookProvider === 'slack' ||
      webhookProvider === 'airtable') &&
    onTest

  return (
    <DialogFooter className="flex justify-between sticky bottom-0 py-3 bg-background border-t z-10 mt-auto w-full">
      <div>
        {webhookId && (
          <div className="flex space-x-3">
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={isDeleting || isLoadingToken}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
            {showTestButton && (
              <Button variant="outline" onClick={onTest} disabled={isTesting || isLoadingToken}>
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test'
                )}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex space-x-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          onClick={onSave}
          disabled={isSaving || isLoadingToken || !isCurrentConfigValid}
          className="bg-primary"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </DialogFooter>
  )
}
