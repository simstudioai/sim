import { CheckIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type BatchResult = {
  email: string
  success: boolean
  message: string
}

interface BatchResultsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  results: Array<BatchResult> | null
  onClose: () => void
}

export function BatchResultsModal({
  open,
  onOpenChange,
  results,
  onClose,
}: BatchResultsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Batch Approval Results</DialogTitle>
          <DialogDescription>Results of the batch approval operation.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto">
          {results && results.length > 0 ? (
            <div className="space-y-2 pt-2">
              <div className="flex justify-between mb-2">
                <span>Total: {results.length}</span>
                <span>
                  Success: {results.filter((r) => r.success).length} / Failed:{' '}
                  {results.filter((r) => !r.success).length}
                </span>
              </div>
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={`p-2 rounded text-sm ${
                    result.success
                      ? 'bg-green-50 border border-green-200 text-green-800'
                      : 'bg-red-50 border border-red-200 text-red-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <XIcon className="h-4 w-4" />
                    )}
                    <span className="font-medium">{result.email}</span>
                  </div>
                  <div className="ml-6 text-xs mt-1">{result.message}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-gray-500">No results to display</div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
