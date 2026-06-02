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
import { cn } from '@/lib/core/utils/cn'

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
  /** Inline error message rendered below the control. */
  error?: React.ReactNode
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
}

interface ChipModalDropdownFieldProps extends ChipModalFieldBaseProps {
  type: 'dropdown'
  value: string | undefined
  onChange: (value: string) => void
  options: ReadonlyArray<ChipModalDropdownOption>
  placeholder?: string
  align?: 'start' | 'center' | 'end'
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
  | ChipModalCustomFieldProps

/**
 * Declarative labeled field row. The `type` discriminator selects which
 * control renders, and the field owns all chrome internally — consumers
 * never pass `variant`, `className`, or `id` to the underlying control.
 *
 * Use `type='custom'` to wrap arbitrary JSX (e.g. an `InfoCard` for a
 * static permission list, or a `TagInput` for email entry).
 */
function ChipModalField(props: ChipModalFieldProps) {
  const id = React.useId()
  const errorId = `${id}-error`
  const { title, required, error, flush = false, className } = props
  const associatesLabel =
    props.type === 'input' || props.type === 'email' || props.type === 'textarea'

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
      {renderChipModalControl(props, id, errorId)}
      {error && (
        <p id={errorId} className='text-[12px] text-[var(--text-error)]'>
          {error}
        </p>
      )}
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
  errorId: string
): React.ReactNode {
  const aria = {
    'aria-required': props.required || undefined,
    'aria-invalid': Boolean(props.error) || undefined,
    'aria-describedby': props.error ? errorId : undefined,
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
          className={cn(CHIP_MODAL_TEXT_CHROME, 'resize-none py-2')}
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
        />
      )
    case 'custom':
      return props.children
  }
}

/**
 * Footer row. Renders the leading inset separator and a right-aligned
 * tinted action bar.
 */
const ChipModalFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className='flex flex-col'>
      <ChipModalSeparator />
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-end gap-2 bg-[var(--surface-3)] px-4 pt-2 pb-2',
          className
        )}
        {...props}
      />
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
