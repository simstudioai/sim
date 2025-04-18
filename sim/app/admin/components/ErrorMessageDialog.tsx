'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ErrorMessageDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string
}

export function ErrorMessageDialog({
  isOpen,
  onClose,
  title,
  message,
}: ErrorMessageDialogProps) {
  // Try to parse JSON message if it's a stringified JSON
  let formattedMessage = message
  try {
    const parsedMessage = JSON.parse(message)
    if (typeof parsedMessage === 'object' && parsedMessage !== null) {
      formattedMessage = JSON.stringify(parsedMessage, null, 2)
    }
  } catch (e) {
    // If parsing fails, use the original message
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-destructive">{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 overflow-y-auto max-h-[60vh]">
          <pre className="text-sm text-muted-foreground whitespace-pre-wrap break-words bg-muted/50 rounded-lg p-4">
            {formattedMessage}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  )
} 