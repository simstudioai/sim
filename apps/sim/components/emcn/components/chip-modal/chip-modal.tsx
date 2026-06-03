/**
 * Compound modal surface for compact "invite / share / connect" style flows.
 *
 * `ChipModal` owns the panel chrome (outer ring, inner surface, header
 * separator, footer separator + tinted footer bar) and the underlying Radix
 * dialog lifecycle. Composition mirrors `Modal` / `ModalHeader` / `ModalBody`
 * / `ModalFooter` — drop your controls in as children.
 *
 * Body items are declared via the polymorphic `ChipModalField`. Each field
 * picks a `type` (`'input'`, `'email'`, `'textarea'`, `'dropdown'`, or
 * `'custom'`) and the field owns all chrome internally — consumers describe
 * intent, never styling. Custom is the escape hatch for arbitrary content
 * (e.g. an `InfoCard`, a `TagInput`).
 *
 * @example
 * ```tsx
 * <ChipModal open={open} onOpenChange={setOpen} srTitle='Invite team members'>
 *   <ChipModalHeader onClose={() => setOpen(false)}>Invite team members</ChipModalHeader>
 *   <ChipModalBody>
 *     <ChipModalField
 *       type='dropdown'
 *       title='Invite as'
 *       value={role}
 *       onChange={setRole}
 *       options={ROLE_OPTIONS}
 *     />
 *     <ChipModalField type='custom' title='Emails'>
 *       <TagInput items={items} onAdd={add} onRemove={remove} variant='block' />
 *     </ChipModalField>
 *   </ChipModalBody>
 *   <ChipModalFooter>
 *     <Chip variant='primary' onClick={send}>Send invites</Chip>
 *   </ChipModalFooter>
 * </ChipModal>
 * ```
 */

'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/emcn/components/button/button'
import { ChipDropdown } from '@/components/emcn/components/chip-dropdown/chip-dropdown'
import { Label } from '@/components/emcn/components/label/label'
import { Modal, ModalContent } from '@/components/emcn/components/modal/modal'
import { TagInput, type TagItem } from '@/components/emcn/components/tag-input/tag-input'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

/** Shared inset separator used by the header and footer edges. */
function ChipModalSeparator({ className }: { className?: string }) {
  return <div className={cn('h-px bg-[var(--border)]', className)} />
}

/**
 * Shared chrome for chip-modal text controls (`'input'`, `'email'`,
 * `'textarea'`). Matches the rounded-lg pill aesthetic of the chip-modal
 * panel and the `ChipDropdown` trigger. Height is set per-control:
 * `h-[30px]` for single-line controls so they align with the dropdown's
 * 30px pill; textarea uses `py-2` since its height is content-driven.
 */
const CHIP_MODAL_TEXT_CHROME =
  'w-full rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-medium font-sans text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--surface-4)]'

/**
 * Canonical class string for field-level inline errors rendered inside a
 * {@link ChipModalField}. Horizontal alignment comes from the field wrapper's
 * `px-2`; vertical spacing from its `gap-[9px]` flex layout — no extra margin
 * or padding needed here. Standalone submit errors ({@link ChipModalError})
 * sit outside any field and therefore manage their own `mt-1 px-2`.
 */
const CHIP_MODAL_FIELD_ERROR_CLASS = 'text-[var(--text-error)] text-caption'

const CHIP_MODAL_WIDTHS = {
  sm: 'w-full max-w-[440px]',
  md: 'w-full max-w-[500px]',
  lg: 'w-full max-w-[600px]',
  xl: 'w-full max-w-[720px]',
} as const

export interface ChipModalProps {
  /** Controlled open state. */
  open: boolean
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void
  /** Screen-reader title for the underlying dialog. */
  srTitle?: string
  /**
   * Panel width preset. Defaults to `'md'` (500px). Use `'lg'` for forms
   * with more fields or wider content (e.g. textareas, code).
   * @default 'md'
   */
  size?: keyof typeof CHIP_MODAL_WIDTHS
  /** Optional className forwarded to the outer panel ring. */
  className?: string
  children?: React.ReactNode
}

/**
 * Root component. Wraps the Radix dialog and renders the panel chrome.
 * Subcomponents (`ChipModalHeader`, `ChipModalBody`, `ChipModalField`,
 * `ChipModalFooter`) are composed as children.
 */
function ChipModal({
  open,
  onOpenChange,
  srTitle = 'Dialog',
  size = 'md',
  className,
  children,
}: ChipModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent bare showClose={false} srTitle={srTitle}>
        <div
          className={cn(
            'rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)] dark:bg-[var(--surface-5)]',
            CHIP_MODAL_WIDTHS[size],
            className
          )}
        >
          <div className='overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)]'>
            {children}
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

ChipModal.displayName = 'ChipModal'

export interface ChipModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional leading icon. Pass `null`/omit for a title-only header. */
  icon?: React.ComponentType<{ className?: string }> | null
  /** When provided, renders a trailing close button. */
  onClose?: () => void
  /** Accessible label for the close button. */
  closeAriaLabel?: string
  /**
   * Whether to render the divider line below the header title.
   * Set to `false` for compact confirmations (destructive / disconnect flows)
   * where the body is plain prose rather than labeled fields.
   * @default true
   */
  showDivider?: boolean
}

/**
 * Header row with optional leading icon, title, and optional trailing close.
 * Renders an inset divider below the title to match the panel's rhythm.
 */
const ChipModalHeader = React.forwardRef<HTMLDivElement, ChipModalHeaderProps>(
  (
    {
      className,
      children,
      icon: Icon = null,
      onClose,
      closeAriaLabel = 'Close',
      showDivider = true,
      ...props
    },
    ref
  ) => (
    <div ref={ref} className={cn('flex flex-col', className)} {...props}>
      <div className='flex min-w-0 items-center justify-between gap-2 px-4 pt-3'>
        <div className='flex min-w-0 items-center gap-2'>
          {Icon ? <Icon className='size-[12px] flex-shrink-0 text-[var(--text-icon)]' /> : null}
          <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>{children}</span>
        </div>
        {onClose ? (
          <Button
            type='button'
            variant='ghost'
            onClick={onClose}
            className='relative size-[14px] flex-shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
          >
            <X className='size-[14px] text-[var(--text-icon)]' />
            <span className='sr-only'>{closeAriaLabel}</span>
          </Button>
        ) : null}
      </div>
      {showDivider && <ChipModalSeparator className='mt-3' />}
    </div>
  )
)

ChipModalHeader.displayName = 'ChipModalHeader'

/**
 * Body container. Applies the panel's standard vertical spacing between
 * fields and matching horizontal gutter.
 */
const ChipModalBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-4 px-2 pt-4.5 pb-4.5', className)} {...props} />
  )
)

ChipModalBody.displayName = 'ChipModalBody'

/** Option entry for the `dropdown` branch of {@link ChipModalField}. */
export interface ChipModalDropdownOption {
  value: string
  label: React.ReactNode
}

/**
 * Props shared by every {@link ChipModalField} branch.
 */
interface ChipModalFieldBaseProps {
  /** Field title rendered above the control. Replaces the legacy `label` slot. */
  title: React.ReactNode
  /**
   * Renders a `*` marker after the title and sets `aria-required` on the
   * underlying control.
   * @default false
   */
  required?: boolean
  /** Inline error message rendered below the control. Takes precedence over `hint`. */
  error?: React.ReactNode
  /**
   * Helper text rendered below the control when there is no active `error`.
   * Use for format hints, constraints, or contextual guidance.
   * @example hint='Lowercase letters, numbers, and hyphens (e.g. my-skill)'
   */
  hint?: React.ReactNode
  /** Disables the underlying control. */
  disabled?: boolean
  /**
   * Drops the field's horizontal gutter so it can sit flush against a
   * container that already owns its padding.
   * @default false
   */
  flush?: boolean
  /** Forwarded to the field wrapper. */
  className?: string
}

interface ChipModalInputFieldProps extends ChipModalFieldBaseProps {
  type: 'input'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  autoComplete?: string
  /** Native input type override. Defaults to `'text'`. */
  inputType?: 'text' | 'password' | 'url' | 'tel' | 'search' | 'number'
}

interface ChipModalEmailFieldProps extends ChipModalFieldBaseProps {
  type: 'email'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
}

interface ChipModalTextareaFieldProps extends ChipModalFieldBaseProps {
  type: 'textarea'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  rows?: number
  /** Min visible height in pixels. */
  minHeight?: number
  /**
   * Whether the textarea is user-resizable. Defaults to `false`.
   * Enable for long-form content (e.g. markdown instructions) where
   * the user benefits from controlling height.
   */
  resizable?: boolean
}

interface ChipModalDropdownFieldProps extends ChipModalFieldBaseProps {
  type: 'dropdown'
  value: string | undefined
  onChange: (value: string) => void
  options: ReadonlyArray<ChipModalDropdownOption>
  placeholder?: string
  align?: 'start' | 'center' | 'end'
}

export interface ChipModalEmailsFieldProps extends ChipModalFieldBaseProps {
  type: 'emails'
  /** Current list of valid email addresses. */
  value: string[]
  /** Called with the next list when valid items are added or removed. */
  onChange: (next: string[]) => void
  /**
   * Optional domain-level validator. Runs AFTER the field's internal format
   * check passes. Return an error message to reject the email (added as an
   * invalid chip and surfaced in the inline banner); return `null` to accept.
   */
  validate?: (email: string) => string | null
  /**
   * External error (e.g. server-side submit failure). Takes precedence over
   * the field's internal validation banner while present.
   */
  error?: React.ReactNode
  /** Auto-focus the input when the field mounts. */
  autoFocus?: boolean
  /** Placeholder shown when no chips exist. Defaults to `'Enter emails'`. */
  placeholder?: string
}

interface ChipModalCustomFieldProps extends ChipModalFieldBaseProps {
  type: 'custom'
  children: React.ReactNode
}

export type ChipModalFieldProps =
  | ChipModalInputFieldProps
  | ChipModalEmailFieldProps
  | ChipModalTextareaFieldProps
  | ChipModalDropdownFieldProps
  | ChipModalEmailsFieldProps
  | ChipModalCustomFieldProps

/**
 * Declarative labeled field row. The `type` discriminator selects which
 * control renders, and the field owns all chrome internally — consumers
 * never pass `variant`, `className`, or `id` to the underlying control.
 *
 * Use `type='custom'` to wrap arbitrary JSX (e.g. an `InfoCard` for a
 * static permission list). For a multi-email chip-list input, prefer
 * `type='emails'` over a `type='custom'` `TagInput` wrapper — it internalizes
 * chip rendering, dedupe, format validation, paste, and Backspace handling.
 */
function ChipModalField(props: ChipModalFieldProps) {
  const id = React.useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const { title, required, error, hint, flush = false, className } = props
  const associatesLabel =
    props.type === 'input' ||
    props.type === 'email' ||
    props.type === 'textarea' ||
    props.type === 'emails'

  return (
    <div className={cn('flex flex-col gap-[9px]', flush ? 'px-0' : 'px-2', className)}>
      <Label
        htmlFor={associatesLabel ? id : undefined}
        className='pl-0.5 font-normal text-[var(--text-muted)]'
      >
        {title}
        {required && (
          <span aria-hidden className='ml-0.5 text-[var(--text-error)]'>
            *
          </span>
        )}
      </Label>
      {renderChipModalControl(props, id, errorId, hintId)}
      {error && props.type !== 'emails' ? (
        <p id={errorId} role='alert' className={CHIP_MODAL_FIELD_ERROR_CLASS}>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className='text-[var(--text-muted)] text-caption'>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

ChipModalField.displayName = 'ChipModalField'

/**
 * Renders the appropriate control for a {@link ChipModalField} based on its
 * `type` discriminator. Each branch reads only the props valid for that type
 * (TypeScript narrows automatically inside the `switch`).
 */
function renderChipModalControl(
  props: ChipModalFieldProps,
  id: string,
  errorId: string,
  hintId: string
): React.ReactNode {
  const aria = {
    'aria-required': props.required || undefined,
    'aria-invalid': Boolean(props.error) || undefined,
    'aria-describedby': props.error ? errorId : props.hint ? hintId : undefined,
  } as const

  switch (props.type) {
    case 'input':
    case 'email':
      return (
        <input
          id={id}
          type={props.type === 'email' ? 'email' : (props.inputType ?? 'text')}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          maxLength={props.type === 'input' ? props.maxLength : undefined}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          className={cn(CHIP_MODAL_TEXT_CHROME, 'h-[30px]')}
          {...aria}
        />
      )
    case 'textarea':
      return (
        <textarea
          id={id}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          rows={props.rows}
          disabled={props.disabled}
          style={props.minHeight ? { minHeight: props.minHeight } : undefined}
          className={cn(
            CHIP_MODAL_TEXT_CHROME,
            'py-2',
            props.resizable ? 'resize-y' : 'resize-none'
          )}
          {...aria}
        />
      )
    case 'dropdown':
      return (
        <ChipDropdown
          value={props.value}
          onChange={props.onChange}
          options={props.options}
          placeholder={props.placeholder}
          align={props.align}
          disabled={props.disabled}
          fullWidth
          {...aria}
        />
      )
    case 'emails':
      return <ChipModalEmailsControl {...props} id={id} errorId={errorId} />
    case 'custom':
      return props.children
  }
}

/**
 * Derives the post-first-chip placeholder from the initial placeholder so
 * consumers don't have to spell both. Tries an `'Enter <noun>s'` →
 * `'Add <noun>'` singularize; falls back to a generic `'Add another'`.
 */
function derivePlaceholderWithTags(placeholder: string): string {
  const match = placeholder.match(/^Enter\s+(.+?)s?$/i)
  if (match) return `Add ${match[1]}`
  return 'Add another'
}

/**
 * Internal renderer for {@link ChipModalField} `type='emails'`. Owns the
 * chip lifecycle (valid + invalid items, dedupe, inline error banner) and
 * lifts only the valid email list up to the consumer via `onChange`.
 */
function ChipModalEmailsControl({
  value,
  onChange,
  validate,
  error,
  autoFocus,
  placeholder = 'Enter emails',
  disabled,
  id,
  errorId,
}: ChipModalEmailsFieldProps & { id: string; errorId: string }) {
  const [items, setItems] = React.useState<TagItem[]>([])
  const [internalError, setInternalError] = React.useState<string | null>(null)

  /**
   * Reconcile internal `items` with the consumer's `value` when the latter
   * changes externally (programmatic clear, partial-failure reseed, etc.).
   * When our own `onChange` is the source of the update, the valid items in
   * `items` already match `value` and this is a no-op.
   */
  React.useEffect(() => {
    setItems((prev) => {
      const prevValid = prev.filter((item) => item.isValid).map((item) => item.value)
      if (prevValid.length === value.length && prevValid.every((v, idx) => v === value[idx])) {
        return prev
      }
      return value.map((v) => ({ value: v, isValid: true }))
    })
  }, [value])

  const handleAdd = React.useCallback(
    (raw: string): boolean => {
      const email = raw.trim().toLowerCase()
      if (!email) return false
      if (items.some((item) => item.value === email)) return false

      if (!quickValidateEmail(email).isValid) {
        setItems((prev) => [...prev, { value: email, isValid: false }])
        setInternalError(null)
        return false
      }

      const reason = validate?.(email)
      if (reason) {
        setItems((prev) => [...prev, { value: email, isValid: false }])
        setInternalError(reason)
        return false
      }

      const next = [...items, { value: email, isValid: true }]
      setItems(next)
      onChange(next.filter((item) => item.isValid).map((item) => item.value))
      setInternalError(null)
      return true
    },
    [items, validate, onChange]
  )

  const handleRemove = React.useCallback(
    (_removed: string, index: number) => {
      const wasValid = items[index]?.isValid ?? false
      const next = items.filter((_, i) => i !== index)
      setItems(next)
      if (wasValid) {
        onChange(next.filter((item) => item.isValid).map((item) => item.value))
      }
      setInternalError(null)
    },
    [items, onChange]
  )

  const handleInputChange = React.useCallback(() => {
    setInternalError(null)
  }, [])

  const banner = error ?? internalError

  return (
    <>
      <TagInput
        variant='block'
        items={items}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onInputChange={handleInputChange}
        placeholder={placeholder}
        placeholderWithTags={derivePlaceholderWithTags(placeholder)}
        disabled={disabled}
        autoFocus={autoFocus}
        id={id}
      />
      {banner && (
        <p id={errorId} role='alert' className={CHIP_MODAL_FIELD_ERROR_CLASS}>
          {banner}
        </p>
      )}
    </>
  )
}

export interface ChipModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Optional leading slot rendered on the left side of the footer — use for
   * a destructive secondary action (e.g. a Delete button in an edit flow).
   * When provided, the footer switches to `justify-between` automatically.
   */
  leading?: React.ReactNode
}

/**
 * Footer row. Renders the leading inset separator and a tinted action bar.
 * Pass `leading` to left-dock a secondary action (e.g. Delete in edit mode);
 * primary actions always go in `children` and are right-aligned.
 */
const ChipModalFooter = React.forwardRef<HTMLDivElement, ChipModalFooterProps>(
  ({ className, leading, children, ...props }, ref) => (
    <div className='flex flex-col'>
      <ChipModalSeparator />
      <div
        ref={ref}
        className={cn(
          'flex items-center gap-2 bg-[var(--surface-3)] px-4 pt-2 pb-2',
          leading ? 'justify-between' : 'justify-end',
          className
        )}
        {...props}
      >
        {leading && <div>{leading}</div>}
        <div className='flex gap-2'>{children}</div>
      </div>
    </div>
  )
)

ChipModalFooter.displayName = 'ChipModalFooter'

export interface ChipModalErrorProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Error message. When falsy the component renders nothing. */
  children?: React.ReactNode
}

/**
 * Standalone error slot for submit-time errors that don't belong to a specific
 * {@link ChipModalField}. Use inside `<ChipModalBody>` after the fields. Returns
 * `null` when `children` is empty so callers can render unconditionally:
 *
 * @example
 * ```tsx
 * <ChipModalBody>
 *   <ChipModalField type='input' title='Name' value={name} onChange={setName} />
 *   <ChipModalError>{submitError}</ChipModalError>
 * </ChipModalBody>
 * ```
 */
const ChipModalError = React.forwardRef<HTMLParagraphElement, ChipModalErrorProps>(
  ({ className, children, ...props }, ref) => {
    if (!children) return null
    return (
      <p
        ref={ref}
        role='alert'
        className={cn('mt-1 px-2 text-[var(--text-error)] text-caption', className)}
        {...props}
      >
        {children}
      </p>
    )
  }
)

ChipModalError.displayName = 'ChipModalError'

export {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
}
