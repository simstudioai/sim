'use client'

import { type HTMLAttributes, type InputHTMLAttributes, type ReactNode, useContext } from 'react'
import { clsx } from 'clsx'
import { OTPInput, OTPInputContext } from 'input-otp'
import styles from '#auth/components/otp/otp.module.css'

interface AuthOTPProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'maxLength' | 'children'
  > {
  value?: string
  onChange?: (value: string) => void
  maxLength: number
  children: ReactNode
  containerClassName?: string
  onComplete?: (value: string) => void
}
/** Adapts a controlled numeric code input; the host supplies its accessible name and feedback IDs. */
export function AuthOTP({ className, containerClassName, ...props }: AuthOTPProps) {
  return (
    <OTPInput
      {...props}
      autoComplete='one-time-code'
      inputMode='numeric'
      pattern='[0-9]*'
      containerClassName={clsx(styles.otpLane, containerClassName)}
      className={className}
    />
  )
}
interface AuthOTPGroupProps extends HTMLAttributes<HTMLDivElement> {}
/** Groups visual code slots inside AuthOTP while the underlying input owns keyboard interaction. */
export function AuthOTPGroup({ className, ...props }: AuthOTPGroupProps) {
  return <div {...props} className={clsx(styles.otpGroup, className)} />
}
interface AuthOTPSlotProps extends HTMLAttributes<HTMLDivElement> {
  index: number
}
/** Displays one indexed slot from the surrounding AuthOTP context. */
export function AuthOTPSlot({ index, className, ...props }: AuthOTPSlotProps) {
  const { slots } = useContext(OTPInputContext)
  const slot = slots[index]
  return (
    <div
      {...props}
      className={clsx(styles.otpSlot, className)}
      data-active={slot?.isActive || undefined}
    >
      {slot?.char}
      {slot?.hasFakeCaret && <span className={styles.caret} />}
    </div>
  )
}
