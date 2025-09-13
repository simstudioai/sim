import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface TriggerWarningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerName: string
  message?: string
}

export function TriggerWarningDialog({
  open,
  onOpenChange,
  triggerName,
  message,
}: TriggerWarningDialogProps) {
  const defaultMessage = `A workflow can only have one ${triggerName} trigger block. Please remove the existing one before adding a new one.`

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {message && message.includes('legacy')
              ? 'Cannot mix trigger types'
              : `Only one ${triggerName} trigger allowed`}
          </AlertDialogTitle>
          <AlertDialogDescription>{message || defaultMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
