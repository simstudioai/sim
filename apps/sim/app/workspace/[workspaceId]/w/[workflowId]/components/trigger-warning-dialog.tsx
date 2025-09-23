import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export enum TriggerWarningType {
  DUPLICATE_TRIGGER = 'duplicate_trigger',
  LEGACY_INCOMPATIBILITY = 'legacy_incompatibility',
}

interface TriggerWarningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerName: string
  type: TriggerWarningType
}

export function TriggerWarningDialog({
  open,
  onOpenChange,
  triggerName,
  type,
}: TriggerWarningDialogProps) {
  const getTitle = () => {
    switch (type) {
      case TriggerWarningType.LEGACY_INCOMPATIBILITY:
        return 'Cannot mix trigger types'
      case TriggerWarningType.DUPLICATE_TRIGGER:
        return `Only one ${triggerName} trigger allowed`
    }
  }

  const getDescription = () => {
    switch (type) {
      case TriggerWarningType.LEGACY_INCOMPATIBILITY:
        return 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
      case TriggerWarningType.DUPLICATE_TRIGGER:
        return `A workflow can only have one ${triggerName} trigger block. Please remove the existing one before adding a new one.`
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{getTitle()}</AlertDialogTitle>
          <AlertDialogDescription>{getDescription()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
