import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { env } from '@/lib/env'

interface TeamSeatsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  currentSeats?: number
  initialSeats?: number
  isLoading: boolean
  onConfirm: (seats: number) => Promise<void>
  confirmButtonText: string
  showCostBreakdown?: boolean
}

export function TeamSeatsDialog({
  open,
  onOpenChange,
  title,
  description,
  currentSeats,
  initialSeats = 1,
  isLoading,
  onConfirm,
  confirmButtonText,
  showCostBreakdown = false,
}: TeamSeatsDialogProps) {
  const [selectedSeats, setSelectedSeats] = useState(initialSeats)

  useEffect(() => {
    if (open) {
      setSelectedSeats(initialSeats)
    }
  }, [open, initialSeats])

  const costPerSeat = env.TEAM_TIER_COST_LIMIT ?? 40
  const totalMonthlyCost = selectedSeats * costPerSeat
  const costChange = currentSeats ? (selectedSeats - currentSeats) * costPerSeat : 0

  const handleConfirm = async () => {
    await onConfirm(selectedSeats)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className='py-4'>
          <Label htmlFor='seats'>Number of seats</Label>
          <Select
            value={selectedSeats.toString()}
            onValueChange={(value) => setSelectedSeats(Number.parseInt(value))}
          >
            <SelectTrigger id='seats'>
              <SelectValue placeholder='Select number of seats' />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].map((num) => (
                <SelectItem key={num} value={num.toString()}>
                  {num} {num === 1 ? 'seat' : 'seats'} (${num * costPerSeat}/month)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className='mt-2 text-muted-foreground text-sm'>
            Your team will have {selectedSeats} {selectedSeats === 1 ? 'seat' : 'seats'} with a
            total of ${totalMonthlyCost} inference credits per month.
          </p>

          {showCostBreakdown && currentSeats !== undefined && (
            <div className='mt-3 rounded-md bg-muted/50 p-3'>
              <div className='flex justify-between text-sm'>
                <span>Current seats:</span>
                <span>{currentSeats}</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>New seats:</span>
                <span>{selectedSeats}</span>
              </div>
              <div className='mt-2 flex justify-between border-t pt-2 font-medium text-sm'>
                <span>Monthly cost change:</span>
                <span>
                  {costChange > 0 ? '+' : ''}${costChange}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || (showCostBreakdown && selectedSeats === currentSeats)}
          >
            {isLoading ? (
              <div className='flex items-center space-x-2'>
                <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-b-transparent' />
                <span>Loading...</span>
              </div>
            ) : (
              <span>{confirmButtonText}</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
