import { useEffect, useState } from 'react'
import {
  Button,
  Combobox,
  type ComboboxOption,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { DEFAULT_TEAM_TIER_COST_LIMIT } from '@/lib/billing/constants'

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
}: TeamSeatsProps) {
  const [selectedSeats, setSelectedSeats] = useState(initialSeats)

  useEffect(() => {
    if (open) {
      setSelectedSeats(initialSeats)
    }
  }, [open, initialSeats])

  const costPerSeat = DEFAULT_TEAM_TIER_COST_LIMIT
  const totalMonthlyCost = selectedSeats * costPerSeat
  const costChange = currentSeats ? (selectedSeats - currentSeats) * costPerSeat : 0

  const seatOptions: ComboboxOption[] = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].map((num) => ({
    value: num.toString(),
    label: `${num} ${num === 1 ? 'seat' : 'seats'}`,
  }))

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>{description}</p>

          <div className='mt-[16px] flex flex-col gap-[4px]'>
            <Label htmlFor='seats' className='text-[12px]'>
              Number of seats
            </Label>
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
          </div>

          <p className='mt-[12px] text-[12px] text-[var(--text-muted)]'>
            Your team will have {selectedSeats} {selectedSeats === 1 ? 'seat' : 'seats'} with a
            total of ${totalMonthlyCost} inference credits per month.
          </p>

          {showCostBreakdown && currentSeats !== undefined && (
            <div className='mt-[16px] rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-4)] px-[12px] py-[10px]'>
              <div className='flex justify-between text-[12px]'>
                <span className='text-[var(--text-muted)]'>Current seats:</span>
                <span className='text-[var(--text-primary)]'>{currentSeats}</span>
              </div>
              <div className='mt-[8px] flex justify-between text-[12px]'>
                <span className='text-[var(--text-muted)]'>New seats:</span>
                <span className='text-[var(--text-primary)]'>{selectedSeats}</span>
              </div>
              <div className='mt-[12px] flex justify-between border-[var(--border-1)] border-t pt-[12px] text-[12px]'>
                <span className='font-medium text-[var(--text-primary)]'>Monthly cost change:</span>
                <span className='font-medium text-[var(--text-primary)]'>
                  {costChange > 0 ? '+' : ''}${costChange}
                </span>
              </div>
            </div>
          )}

          {error && (
            <p className='mt-[12px] text-[12px] text-[var(--text-error)]'>
              {error instanceof Error && error.message ? error.message : String(error)}
            </p>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span>
                <Button
                  variant='tertiary'
                  onClick={() => onConfirm(selectedSeats)}
                  disabled={
                    isLoading ||
                    selectedSeats < 1 ||
                    (showCostBreakdown && selectedSeats === currentSeats) ||
                    isCancelledAtPeriodEnd
                  }
                >
                  {isLoading ? 'Updating...' : confirmButtonText}
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
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
