'use client'

import {
  type ComponentType,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import { OTPInput, OTPInputContext } from 'input-otp'
import { createPortal } from 'react-dom'
import { AuthFormMessage } from './compositions'
import { AuthIcon } from './icons'
import styles from './styles.module.css'
import './utilities.css'

const PortalContext = createContext<HTMLDivElement | null>(null)

interface AuthRootProps {
  children: ReactNode
  className?: string
}
/** Provides the Auth styling and portal boundary without owning authentication state. */
export function AuthRoot({ children, className }: AuthRootProps) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return (
    <div data-auth-root='' className={clsx(styles.root, className)}>
      <PortalContext.Provider value={portal}>
        {children}
        <div ref={setPortal} data-auth-portals='' className={styles.portal} />
      </PortalContext.Provider>
    </div>
  )
}

interface AuthNotificationProps {
  children: ReactNode
  type: 'success' | 'error'
}
/** Feedback stays inside the Auth portal and does not inherit the app toast theme. */
export function AuthNotification({ children, type }: AuthNotificationProps) {
  const portal = useContext(PortalContext)
  const [visible, setVisible] = useState(true)
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    if (hovered) return
    const timer = setTimeout(() => setVisible(false), 5000)
    return () => clearTimeout(timer)
  }, [hovered])
  if (!portal || !visible) return null
  return createPortal(
    <div
      className={styles.notification}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <AuthFormMessage type={type}>{children}</AuthFormMessage>
    </div>,
    portal
  )
}

interface AuthInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  error?: boolean
  icon?: ComponentType<{ className?: string }>
  startAdornment?: ReactNode
  endAdornment?: ReactNode
  inputClassName?: string
}
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

interface PasswordInputProps extends Omit<AuthInputProps, 'type' | 'icon' | 'endAdornment'> {}
export function PasswordInput({ disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <AuthInput
      {...props}
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
          <AuthIcon name={visible ? 'eye-off' : 'eye'} />
        </button>
      }
    />
  )
}

interface AuthReadonlyInputProps {
  value: string
  label?: string
}
export function AuthReadonlyInput({ value, label = 'Pairing code' }: AuthReadonlyInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const statusId = useId()
  const inputId = useId()
  useEffect(() => {
    if (status !== 'copied') return
    const timer = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [status])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('failed')
      ref.current?.focus()
      ref.current?.select()
    }
  }
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <AuthInput
        id={inputId}
        ref={ref}
        readOnly
        inputClassName={styles.readonlyValue}
        value={value}
        aria-label={label}
        aria-describedby={statusId}
        endAdornment={
          <button
            type='button'
            className={styles.quietAction}
            aria-label='Copy code'
            title='Copy code'
            onClick={copy}
          >
            <AuthIcon name={status === 'copied' ? 'check' : 'copy'} />
          </button>
        }
      />
      <p id={statusId} role='status' className={styles.caption}>
        {status === 'copied'
          ? 'Copied'
          : status === 'failed'
            ? 'Could not copy. Select the code and copy it manually.'
            : null}
      </p>
    </div>
  )
}

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
export function AuthOTPGroup({ className, ...props }: AuthOTPGroupProps) {
  return <div {...props} className={clsx(styles.otpGroup, className)} />
}
interface AuthOTPSlotProps extends HTMLAttributes<HTMLDivElement> {
  index: number
}
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

export interface AuthSelectOption {
  label: string
  value: string
  disabled?: boolean
}
interface AuthSelectProps {
  options: AuthSelectOption[]
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
  displayLabel?: string
  searchable?: boolean
  searchPlaceholder?: string
  fullWidth?: boolean
  dropdownWidth?: string
  className?: string
  id?: string
  'aria-label'?: string
}
/** Shared accessible option list for terminal workspaces and provider installation choices. */
export function AuthSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = 'Select an option',
  displayLabel,
  searchable,
  searchPlaceholder = 'Search',
  className,
  id,
  'aria-label': ariaLabel,
}: AuthSelectProps) {
  const portal = useContext(PortalContext)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  )
  const selected = options.find((option) => option.value === value)
  const available = filtered.filter((option) => !option.disabled)
  const activeValue = available[active]?.value
  function choose(next: string) {
    onChange?.(next)
    setOpen(false)
    setSearch('')
  }
  function move(next: number) {
    const index = Math.max(0, Math.min(available.length - 1, next))
    setActive(index)
    content.current
      ?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])')
      [index]?.scrollIntoView({ block: 'nearest' })
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch('')
        setActive(
          Math.max(
            0,
            options
              .filter((option) => !option.disabled)
              .findIndex((option) => option.value === value)
          )
        )
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          id={id}
          type='button'
          role='combobox'
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup='listbox'
          disabled={disabled}
          className={clsx(styles.select, className)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setSearch('')
              setActive(
                Math.max(
                  0,
                  options
                    .filter((option) => !option.disabled)
                    .findIndex((option) => option.value === value)
                )
              )
              setOpen(true)
            }
          }}
        >
          <span className={styles.inputSurface}>
            <span>{displayLabel ?? selected?.label ?? placeholder}</span>
            <AuthIcon name='chevron' />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portal ?? undefined}>
        <Popover.Content
          ref={content}
          className={clsx(styles.root, styles.menu)}
          sideOffset={4}
          collisionPadding={16}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              move(active + (event.key === 'ArrowDown' ? 1 : -1))
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              move(event.key === 'Home' ? 0 : available.length - 1)
            } else if (event.key === 'Enter' && activeValue) {
              event.preventDefault()
              choose(activeValue)
            }
          }}
          onOpenAutoFocus={(event) => {
            if (!searchable) {
              event.preventDefault()
              content.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus()
            }
          }}
          tabIndex={-1}
        >
          {searchable && (
            <input
              className={styles.menuSearch}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={activeValue ? `${listId}-${activeValue}` : undefined}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setActive(0)
              }}
            />
          )}
          <div
            id={listId}
            role='listbox'
            aria-label={ariaLabel ?? placeholder}
            aria-activedescendant={activeValue ? `${listId}-${activeValue}` : undefined}
            className={styles.options}
            tabIndex={0}
          >
            {filtered.map((option) => (
              <div
                key={option.value}
                id={`${listId}-${option.value}`}
                role='option'
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-focused={option.value === activeValue || undefined}
                className={styles.menuRow}
                onPointerMove={() => {
                  if (!option.disabled) setActive(available.indexOf(option))
                }}
                onClick={() => {
                  if (!option.disabled) choose(option.value)
                }}
              >
                <span>{option.label}</span>
                <span className={styles.icon}>
                  {option.value === value && <AuthIcon name='check' />}
                </span>
              </div>
            ))}
            {filtered.length === 0 && <p className={styles.empty}>No matching options</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface AuthAccountMenuProps {
  email: string
  disabled?: boolean
  pending?: boolean
  onSwitch: () => void
}
export function AuthAccountMenu({ email, disabled, pending, onSwitch }: AuthAccountMenuProps) {
  const portal = useContext(PortalContext)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type='button' className={styles.accountTrigger} disabled={disabled}>
          <span className={styles.avatar} aria-hidden='true'>
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.identityText}>
            <span>{pending ? 'Signing out…' : 'Signed in as'}</span>
            <span className={styles.accountEmail}>{email}</span>
          </span>
          <AuthIcon name='chevron' />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal ?? undefined}>
        <DropdownMenu.Content
          className={clsx(styles.root, styles.menu)}
          sideOffset={4}
          collisionPadding={16}
        >
          <DropdownMenu.Label className={styles.menuLabel}>{email}</DropdownMenu.Label>
          <DropdownMenu.Item className={styles.menuRow} disabled={disabled} onSelect={onSwitch}>
            {pending ? 'Signing out…' : 'Use another account'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
