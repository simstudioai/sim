import { useEffect, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Combobox,
  type ComboboxOption,
  Tooltip,
} from '@/components/emcn'

interface TeamSeatsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  currentSeats?: number
  initialSeats?: number
  isLoading: boolean
  error?: Error | null
  onConfirm: (seats: number) => Promise<void>
  confirmButtonText: string
  showCostBreakdown?: boolean
  isCancelledAtPeriodEnd?: boolean
  costPerSeatDollars: number
  creditsPerSeat: number
}

export function TeamSeats({
  open,
  onOpenChange,
  title,
  description,
  currentSeats,
  initialSeats = 1,
  isLoading,
  error,
  onConfirm,
  confirmButtonText,
  showCostBreakdown = false,
  isCancelledAtPeriodEnd = false,
  costPerSeatDollars,
  creditsPerSeat: creditsPerSeatProp,
}: TeamSeatsProps) {
  const [selectedSeats, setSelectedSeats] = useState(initialSeats)

  useEffect(() => {
    if (open) {
      setSelectedSeats(initialSeats)
    }
  }, [open, initialSeats])

  const costPerSeat = costPerSeatDollars
  const seatCredits = creditsPerSeatProp
  const totalMonthlyCost = selectedSeats * costPerSeat
  const costChange = currentSeats ? (selectedSeats - currentSeats) * costPerSeat : 0

  const seatOptions: ComboboxOption[] = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].map((num) => ({
    value: num.toString(),
    label: `${num} ${num === 1 ? 'seat' : 'seats'}`,
  }))

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{title}</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>{description}</p>

        <ChipModalField type='custom' title='Number of seats'>
          <Combobox
            options={seatOptions}
            value={selectedSeats > 0 ? selectedSeats.toString() : ''}
            onChange={(value) => {
              const num = Number.parseInt(value, 10)
              if (!Number.isNaN(num) && num > 0) {
                setSelectedSeats(num)
              }
            }}
            placeholder='Select or enter number of seats'
            editable
            disabled={isLoading}
          />
        </ChipModalField>

        <ChipModalField type='custom' title=''>
          <p className='px-2 text-[var(--text-muted)] text-small'>
            Your team will have {selectedSeats} {selectedSeats === 1 ? 'seat' : 'seats'} with a
            total of {(selectedSeats * seatCredits).toLocaleString()} inference credits per month.
          </p>
        </ChipModalField>

        {showCostBreakdown && currentSeats !== undefined && (
          <ChipModalField type='custom' title=''>
            <div className='rounded-md border border-[var(--border-1)] bg-[var(--surface-4)] px-3 py-2.5'>
              <div className='flex justify-between text-small'>
                <span className='text-[var(--text-muted)]'>Current seats:</span>
                <span className='text-[var(--text-primary)]'>{currentSeats}</span>
              </div>
              <div className='mt-2 flex justify-between text-small'>
                <span className='text-[var(--text-muted)]'>New seats:</span>
                <span className='text-[var(--text-primary)]'>{selectedSeats}</span>
              </div>
              <div className='mt-3 flex justify-between border-[var(--border-1)] border-t pt-3 text-small'>
                <span className='font-medium text-[var(--text-primary)]'>
                  Monthly credit change:
                </span>
                <span className='font-medium text-[var(--text-primary)]'>
                  {costChange > 0 ? '+' : ''}
                  {(
                    (currentSeats ? selectedSeats - currentSeats : 0) * seatCredits
                  ).toLocaleString()}{' '}
                  credits
                </span>
              </div>
            </div>
          </ChipModalField>
        )}

        <ChipModalError>{error ? getErrorMessage(error) : undefined}</ChipModalError>
      </ChipModalBody>

      <ChipModalFooter>
        <Chip variant='filled' flush onClick={() => onOpenChange(false)}>
          Cancel
        </Chip>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span>
              <Chip
                variant='primary'
                flush
                onClick={() => onConfirm(selectedSeats)}
                disabled={
                  isLoading ||
                  selectedSeats < 1 ||
                  (showCostBreakdown && selectedSeats === currentSeats) ||
                  isCancelledAtPeriodEnd
                }
              >
                {isLoading ? 'Updating...' : confirmButtonText}
              </Chip>
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
      </ChipModalFooter>
    </ChipModal>
  )
}
