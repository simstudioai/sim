import { useEffect, useState } from 'react'
import { Button, Combobox, type ComboboxOption, Tooltip } from '@/components/emcn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { DEFAULT_TEAM_TIER_COST_LIMIT } from '@/lib/billing/constants'
import { env } from '@/lib/env'

interface TeamSeatsProps {
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
  isCancelledAtPeriodEnd?: boolean
}

export function TeamSeats({
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
  isCancelledAtPeriodEnd = false,
}: TeamSeatsProps) {
  const [selectedSeats, setSelectedSeats] = useState(initialSeats)

  useEffect(() => {
    if (open) {
      setSelectedSeats(initialSeats)
    }
  }, [open, initialSeats])

  const costPerSeat = env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT
  const totalMonthlyCost = selectedSeats * costPerSeat
  const costChange = currentSeats ? (selectedSeats - currentSeats) * costPerSeat : 0

  const handleConfirm = async () => {
    await onConfirm(selectedSeats)
  }

  const seatOptions: ComboboxOption[] = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].map((num) => ({
    value: num.toString(),
    label: `${num} ${num === 1 ? 'seat' : 'seats'} ($${num * costPerSeat}/month)`,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='z-[100000000]'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className='py-4'>
          <Label htmlFor='seats'>Number of seats</Label>
          <Combobox
            options={seatOptions}
            value={selectedSeats.toString()}
            onChange={(value) => setSelectedSeats(Number.parseInt(value))}
            placeholder='Select number of seats'
          />

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

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span>
                <Button
                  variant='primary'
                  onClick={handleConfirm}
                  disabled={
                    isLoading ||
                    (showCostBreakdown && selectedSeats === currentSeats) ||
                    isCancelledAtPeriodEnd
                  }
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
              </span>
            </Tooltip.Trigger>
            {isCancelledAtPeriodEnd && (
              <Tooltip.Content>
                <p>
                  To update seats, go to Subscription {'>'} Manage {'>'} Keep Subscription to
                  reactivate
                </p>
              </Tooltip.Content>
            )}
          </Tooltip.Root>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
