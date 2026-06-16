/**
 * An OTP input component matching the emcn design system.
 *
 * Wraps the `input-otp` library with emcn design tokens for consistent styling.
 *
 * @example
 * ```tsx
 * import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/emcn'
 *
 * <InputOTP maxLength={6} value={otp} onChange={setOtp}>
 *   <InputOTPGroup>
 *     <InputOTPSlot index={0} />
 *     <InputOTPSlot index={1} />
 *     <InputOTPSlot index={2} />
 *     <InputOTPSlot index={3} />
 *     <InputOTPSlot index={4} />
 *     <InputOTPSlot index={5} />
 *   </InputOTPGroup>
 * </InputOTP>
 * ```
 *
 * @see InputOTP - Root component wrapping OTPInput
 * @see InputOTPGroup - Groups slots together
 * @see InputOTPSlot - Individual digit slot
 * @see InputOTPSeparator - Visual separator between groups
 */
'use client'

import * as React from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'
import { Minus } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

/**
 * Root OTP input component. Manages the overall input state and layout.
 */
const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      'flex items-center gap-2 has-[:disabled]:opacity-50',
      containerClassName
    )}
    className={cn('disabled:cursor-not-allowed', className)}
    {...props}
  />
))
InputOTP.displayName = 'InputOTP'

/**
 * Groups OTP slots together with consistent spacing.
 */
const InputOTPGroup = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-2', className)} {...props} />
))
InputOTPGroup.displayName = 'InputOTPGroup'

/**
 * Individual OTP digit slot. Displays the entered character and a fake caret when active.
 *
 * Uses emcn design tokens for consistent styling with the Input component.
 */
const InputOTPSlot = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index]

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex h-12 w-12 items-center justify-center rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] font-medium text-[var(--text-primary)] text-lg transition-colors',
        isActive && 'z-10 border-[var(--text-muted)] ring-1 ring-[var(--text-muted)]',
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='h-6 w-px animate-caret-blink bg-[var(--text-primary)] duration-1000 motion-reduce:animate-none' />
        </div>
      )}
    </div>
  )
})
InputOTPSlot.displayName = 'InputOTPSlot'

/**
 * Visual separator between OTP slot groups.
 */
const InputOTPSeparator = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(({ ...props }, ref) => (
  <div ref={ref} role='separator' className='text-[var(--text-muted)]' {...props}>
    <Minus />
  </div>
))
InputOTPSeparator.displayName = 'InputOTPSeparator'

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
