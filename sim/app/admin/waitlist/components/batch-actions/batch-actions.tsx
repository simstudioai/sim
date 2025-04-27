import { Button } from '@/components/ui/button'
import { CheckSquareIcon, SquareIcon, UserCheckIcon, XIcon } from 'lucide-react'

interface BatchActionsProps {
  hasSelectedEmails: boolean
  selectedCount: number
  loading: boolean
  onToggleSelectAll: () => void
  onClearSelections: () => void
  onBatchApprove: () => void
  entriesExist: boolean
  someSelected: boolean
}

export function BatchActions({
  hasSelectedEmails,
  selectedCount,
  loading,
  onToggleSelectAll,
  onClearSelections,
  onBatchApprove,
  entriesExist,
  someSelected,
}: BatchActionsProps) {
  if (!entriesExist) return null;
  
  return (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <Button
        size="sm"
        variant={hasSelectedEmails ? "default" : "outline"}
        onClick={onToggleSelectAll}
        disabled={loading || !entriesExist}
        className="whitespace-nowrap h-8 px-2.5 text-xs"
      >
        {someSelected ? (
          <CheckSquareIcon className="h-3.5 w-3.5 mr-1.5" />
        ) : (
          <SquareIcon className="h-3.5 w-3.5 mr-1.5" />
        )}
        {someSelected ? "Deselect All" : "Select All"}
      </Button>
      
      {hasSelectedEmails && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={onClearSelections}
            className="whitespace-nowrap h-8 px-2.5 text-xs"
          >
            <XIcon className="h-3.5 w-3.5 mr-1.5" />
            Clear Selection
          </Button>
          
          <Button
            size="sm"
            variant="default"
            onClick={onBatchApprove}
            disabled={!hasSelectedEmails || loading}
            className="whitespace-nowrap h-8 px-2.5 text-xs"
          >
            <UserCheckIcon className="h-3.5 w-3.5 mr-1.5" />
            {loading ? "Processing..." : `Approve Selected (${selectedCount})`}
          </Button>
        </>
      )}
    </div>
  )
} 