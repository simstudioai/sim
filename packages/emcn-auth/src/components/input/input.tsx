'use client'

import {
  type ComponentType,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { Icon } from '@sim/emcn/icon'
import { clsx } from 'clsx'
import { AuthField } from '#auth/components/field/field'
import styles from '#auth/components/input/input.shared.module.css'

interface AuthInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  error?: boolean
  icon?: ComponentType<{ className?: string }>
  startAdornment?: ReactNode
  endAdornment?: ReactNode
  inputClassName?: string
}
/** Forwards native input props and ref inside the Auth control and mobile touch lane.
 * With error and id supplied, associates the `${id}-errors` region from AuthField. */
export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  {
    className,
    inputClassName,
    error,
    icon: Icon,
    startAdornment,
    endAdornment,
    disabled,
    id,
    ...props
  },
  ref
) {
  const describedBy =
    [props['aria-describedby'], error && id ? `${id}-errors` : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div
      className={clsx(styles.inputLane, className)}
      data-disabled={disabled || undefined}
      data-invalid={error || undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault()
          event.currentTarget.querySelector('input')?.focus()
        }
      }}
    >
      <div className={styles.inputSurface}>
        {startAdornment ?? (Icon && <Icon className={styles.icon} />)}
        <input
          {...props}
          id={id}
          ref={ref}
          disabled={disabled}
          className={clsx(styles.input, inputClassName)}
          aria-invalid={error || props['aria-invalid']}
          aria-describedby={describedBy}
        />
        {endAdornment}
      </div>
    </div>
  )
})

/** Adds overridable email entry defaults while leaving input type and validation to the caller. */
export const AuthEmailInput = forwardRef<HTMLInputElement, AuthInputProps>(
  function AuthEmailInput(props, ref) {
    return (
      <AuthInput
        inputMode='email'
        autoCapitalize='none'
        autoComplete='email'
        autoCorrect='off'
        placeholder='Enter your email'
        {...props}
        ref={ref}
      />
    )
  }
)

interface PasswordInputProps extends Omit<AuthInputProps, 'type' | 'icon' | 'endAdornment'> {}
/** Keeps password visibility local; forwards field identity, validation, and autocomplete props. */
export function PasswordInput({
  disabled,
  placeholder = 'Enter your password',
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <AuthInput
      {...props}
      placeholder={placeholder}
      disabled={disabled}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <button
          type='button'
          className={styles.quietAction}
          disabled={disabled}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} />
        </button>
      }
    />
  )
}

interface AuthReadonlyInputProps {
  value: string
  label?: string
}
/** Provides a labeled pairing code with copy feedback and manual selection on clipboard failure. */
export function AuthReadonlyInput({ value, label = 'Pairing code' }: AuthReadonlyInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const clipboard = useClipboard()
  const [copyFailed, setCopyFailed] = useState(false)
  const status = clipboard.copied ? 'copied' : copyFailed ? 'failed' : 'idle'
  const statusId = useId()
  const inputId = useId()
  async function copy() {
    const copied = await clipboard.copy(value)
    setCopyFailed(!copied)
    if (!copied) {
      ref.current?.focus()
      ref.current?.select()
    }
  }
  return (
    <AuthField
      htmlFor={inputId}
      label={label}
      hint={
        status !== 'idle' && (
          <span id={statusId} role='status'>
            {status === 'copied'
              ? 'Copied'
              : 'Could not copy. Select the code and copy it manually.'}
          </span>
        )
      }
    >
      <AuthInput
        id={inputId}
        ref={ref}
        readOnly
        inputClassName={styles.readonlyValue}
        value={value}
        aria-label={label}
        aria-describedby={status !== 'idle' ? statusId : undefined}
        endAdornment={
          <button
            type='button'
            className={styles.quietAction}
            aria-label='Copy code'
            title='Copy code'
            onClick={copy}
          >
            <Icon name={status === 'copied' ? 'I072' : 'I006'} />
          </button>
        }
      />
    </AuthField>
  )
}
