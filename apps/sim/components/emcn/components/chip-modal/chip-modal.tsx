/**
 * Compound modal surface for compact "invite / share / connect" style flows.
 *
 * `ChipModal` owns the panel chrome (outer ring, inner surface, header
 * separator, footer separator + tinted footer bar) and the underlying Radix
 * dialog lifecycle. Composition mirrors `Modal` / `ModalHeader` / `ModalBody`
 * / `ModalFooter` — drop your controls in as children.
 *
 * Body items are declared via the polymorphic `ChipModalField`. Each field
 * picks a `type` (`'input'`, `'email'`, `'textarea'`, `'dropdown'`, `'copy'`,
 * `'file'`, `'emails'`, or `'custom'`) and the field owns all chrome
 * internally — consumers describe intent, never styling. Custom is the escape
 * hatch for arbitrary content (e.g. an `InfoCard`, a `TagInput`).
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
 *   <ChipModalFooter
 *     onCancel={() => setOpen(false)}
 *     primaryAction={{ label: 'Send invites', onClick: send }}
 *   />
 * </ChipModal>
 * ```
 */

'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/emcn/components/button/button'
import { Chip, type ChipProps } from '@/components/emcn/components/chip/chip'
import {
  chipContentIconClass,
  chipContentLabelClass,
} from '@/components/emcn/components/chip/chip-chrome'
import { ChipCopyInput } from '@/components/emcn/components/chip-copy-input/chip-copy-input'
import {
  ChipDropdown,
  type ChipDropdownOption,
} from '@/components/emcn/components/chip-dropdown/chip-dropdown'
import { ChipInput } from '@/components/emcn/components/chip-input/chip-input'
import { ChipSwitch } from '@/components/emcn/components/chip-switch/chip-switch'
import { ChipTextarea } from '@/components/emcn/components/chip-textarea/chip-textarea'
import { Label } from '@/components/emcn/components/label/label'
import { Modal, ModalContent } from '@/components/emcn/components/modal/modal'
import { TagInput, type TagItem } from '@/components/emcn/components/tag-input/tag-input'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { Loader } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

/**
 * The modal's hairline divider — used by the header and footer edges, and
 * exported so body sections (e.g. a settings band below a prompt) can draw the
 * same line instead of re-deriving the `h-px bg-[var(--border)]` string.
 */
export function ChipModalSeparator({ className }: { className?: string }) {
  return <div className={cn('h-px bg-[var(--border)]', className)} />
}

/**
 * Canonical class string for field-level inline errors rendered inside a
 * {@link ChipModalField}. Horizontal alignment comes from the field wrapper's
 * `px-2`; vertical spacing from its `gap-[9px]` flex layout — no extra margin
 * or padding needed here. Standalone submit errors ({@link ChipModalError})
 * sit outside any field and therefore manage their own `mt-1 px-2`.
 */
const CHIP_MODAL_FIELD_ERROR_CLASS = 'text-[var(--text-error)] text-caption'

export interface ChipModalProps {
  /** Controlled open state. */
  open: boolean
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void
  /** Screen-reader title for the underlying dialog. */
  srTitle?: string
  /**
   * Panel width preset. Matches the underlying `Modal` widths exactly:
   * `sm` 440 · `md` 500 · `lg` 600 · `xl` 800 · `full` 1200 (px max, `w-[90vw]`
   * on smaller viewports). Defaults to `'md'`.
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Optional className forwarded to the outer panel ring. */
  className?: string
  children?: React.ReactNode
}

/**
 * Root component. Wraps the Radix dialog and renders the panel chrome.
 * Subcomponents (`ChipModalHeader`, `ChipModalBody`, `ChipModalField`,
 * `ChipModalFooter`) are composed as children. The `size` is forwarded to the
 * underlying `ModalContent` so the panel width matches a plain `Modal` of the
 * same size — the inner ring just fills it.
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
      <ModalContent bare showClose={false} srTitle={srTitle} size={size}>
        <div
          className={cn(
            'flex min-h-0 w-full flex-col rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)] dark:bg-[var(--surface-5)]',
            className
          )}
        >
          <div className='flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)]'>
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
  /** Invoked when the trailing close button is activated. Always rendered. */
  onClose: () => void
  /** Accessible label for the close button. */
  closeAriaLabel?: string
}

/**
 * Header row with optional leading icon, title, and a trailing close button.
 * Always renders an inset divider below the title to match the panel's rhythm.
 */
const ChipModalHeader = React.forwardRef<HTMLDivElement, ChipModalHeaderProps>(
  (
    { className, children, icon: Icon = null, onClose, closeAriaLabel = 'Close', ...props },
    ref
  ) => (
    <div ref={ref} className={cn('flex flex-col', className)} {...props}>
      <div className='flex min-w-0 items-center justify-between gap-2 px-4 pt-3'>
        <div className='flex min-w-0 items-center gap-2'>
          {Icon ? <Icon className={chipContentIconClass} /> : null}
          <span className={chipContentLabelClass}>{children}</span>
        </div>
        <Button
          type='button'
          variant='ghost'
          onClick={onClose}
          className='relative size-[14px] flex-shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
        >
          <X className='size-[14px] text-[var(--text-icon)]' />
          <span className='sr-only'>{closeAriaLabel}</span>
        </Button>
      </div>
      <ChipModalSeparator className='mt-3' />
    </div>
  )
)

ChipModalHeader.displayName = 'ChipModalHeader'

/** Tab entry for {@link ChipModalTabs}. */
export interface ChipModalTab {
  /** Stable value used to track the active tab. */
  value: string
  /** Visible tab label. */
  label: React.ReactNode
  /** Optional leading icon rendered before the label. */
  icon?: React.ComponentType<{ className?: string }>
}

export interface ChipModalTabsProps {
  /** Tab definitions in display order. */
  tabs: ReadonlyArray<ChipModalTab>
  /** Currently-active tab value. */
  value: string
  /** Called with the next tab value when a tab is selected. */
  onChange: (value: string) => void
  /** Optional accessible label for the underlying radio group. */
  'aria-label'?: string
  /** Forwarded to the switch container. */
  className?: string
}

/**
 * Tab switcher for tabbed modals, rendered as a {@link ChipSwitch} segmented
 * control so the chrome reads as a single pill — `--surface` trough with the
 * active tab a clean lifted surface — instead of loose floating chips. Render
 * it at the top of a `ChipModalBody`; the consumer renders the active tab's
 * content conditionally below.
 *
 * Reusing `ChipSwitch` keeps every tabbed modal visually identical to the
 * segmented toggles elsewhere in the app (e.g. the billing-period switch).
 *
 * @example
 * ```tsx
 * <ChipModalBody>
 *   <ChipModalTabs
 *     tabs={[{ value: 'settings', label: 'Settings' }, { value: 'documents', label: 'Documents' }]}
 *     value={tab}
 *     onChange={setTab}
 *   />
 *   {tab === 'settings' ? <SettingsFields /> : <DocumentsList />}
 * </ChipModalBody>
 * ```
 */
function ChipModalTabs({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: ChipModalTabsProps) {
  return (
    <ChipSwitch
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      options={tabs.map((tab) => ({ value: tab.value, label: tab.label, icon: tab.icon }))}
      className={className}
    />
  )
}

ChipModalTabs.displayName = 'ChipModalTabs'

/**
 * Body container. Applies the panel's standard vertical spacing between
 * fields and matching horizontal gutter. Scrolls internally when the modal
 * content exceeds the viewport cap (`max-h-[84vh]` on `ModalContent`), so
 * header and footer stay pinned.
 */
const ChipModalBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-4 pb-4.5',
        className
      )}
      {...props}
    />
  )
)

ChipModalBody.displayName = 'ChipModalBody'

export interface ChipModalPromptBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Minimum body height in pixels, so the prompt surface presents as an open
   * canvas rather than collapsing to a single line.
   * @default 140
   */
  minHeight?: number
}

/**
 * Body variant whose ENTIRE content is a single borderless multi-line text
 * surface — an Attio-style prompt modal. Compose it exactly like
 * {@link ChipModalBody} (same header above, same footer below); only the body
 * differs: instead of labeled `ChipModalField` rows, the one child is a
 * full-bleed prompt editor (canonically the home `PromptEditor`, which brings
 * `@`-mention and `/`-skill chips, caret-anchored menus, and the overlay chip
 * rendering of the chat input).
 *
 * Gutter math: the editor's mirror field carries its own `px-1 py-1` text
 * padding, so this container pads `px-3 pt-3 pb-3.5` — text lands at the same
 * effective `px-4 pt-4 pb-4.5` as `ChipModalBody` + `ChipModalField`, aligned
 * with the `px-4` header/footer. The first child (the editor) is stretched so
 * the whole body acts as one clickable text surface; any trailing sibling
 * (e.g. a `ChipModalError`) keeps its natural height.
 *
 * @example
 * ```tsx
 * const editor = usePromptEditor({ workspaceId })
 * <ChipModal open={open} onOpenChange={setOpen} srTitle='New task'>
 *   <ChipModalHeader icon={Calendar} onClose={close}>New task</ChipModalHeader>
 *   <ChipModalPromptBody>
 *     <PromptEditor editor={editor} placeholder='Describe the task...' autoFocus />
 *   </ChipModalPromptBody>
 *   <ChipModalFooter
 *     onCancel={close}
 *     primaryAction={{ label: 'Create', onClick: create, disabled: !editor.value.trim() }}
 *   />
 * </ChipModal>
 * ```
 */
const ChipModalPromptBody = React.forwardRef<HTMLDivElement, ChipModalPromptBodyProps>(
  ({ className, style, minHeight = 140, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-1 flex-col overflow-y-auto px-3 pt-3 pb-3.5 [&>:first-child]:flex-1',
        className
      )}
      style={{ ...style, minHeight }}
      {...props}
    >
      {children}
    </div>
  )
)

ChipModalPromptBody.displayName = 'ChipModalPromptBody'

/**
 * Option entry for the `dropdown` branch of {@link ChipModalField}. Aliases the
 * canonical {@link ChipDropdownOption} so the modal dropdown stays in lockstep
 * with `ChipDropdown` (gains the optional leading `icon`).
 */
export type ChipModalDropdownOption = ChipDropdownOption

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
  /**
   * Renders the value in the monospace stack (`font-mono`). Use for
   * code-like values (identifiers, keys, snippets) where the proportional
   * stack hurts legibility.
   * @default false
   */
  mono?: boolean
  /**
   * Called when the user presses Enter in the field. Wire this to the
   * modal's primary action so the field behaves like a form submit.
   */
  onSubmit?: () => void
}

interface ChipModalEmailFieldProps extends ChipModalFieldBaseProps {
  type: 'email'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  /**
   * Called when the user presses Enter in the field. Wire this to the
   * modal's primary action so the field behaves like a form submit.
   */
  onSubmit?: () => void
}

interface ChipModalTextareaFieldBaseProps extends ChipModalFieldBaseProps {
  type: 'textarea'
  value: string
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
  /**
   * Renders the value in the monospace stack (`font-mono`). Use for
   * code-like content (JSON payloads, env blobs) where alignment and
   * character distinction matter.
   * @default false
   */
  mono?: boolean
}

/**
 * `viewOnly` renders the textarea as a view-only record: read-only at full
 * opacity with the default cursor — the user can still read and select,
 * unlike a greyed-out disabled control. The multi-line sibling of
 * `type='copy'`. View-only fields take no `onChange`; editable fields
 * require it.
 */
type ChipModalTextareaFieldProps = ChipModalTextareaFieldBaseProps &
  ({ viewOnly?: false; onChange: (value: string) => void } | { viewOnly: true; onChange?: never })

interface ChipModalCopyFieldProps extends ChipModalFieldBaseProps {
  type: 'copy'
  /** The read-only value displayed and copied. */
  value: string
  /**
   * Accessible label and tooltip for the trailing copy button.
   * @default 'Copy'
   */
  copyLabel?: string
}

interface ChipModalDropdownFieldProps extends ChipModalFieldBaseProps {
  type: 'dropdown'
  value: string | undefined
  onChange: (value: string) => void
  options: ReadonlyArray<ChipModalDropdownOption>
  placeholder?: string
  align?: 'start' | 'center' | 'end'
}

interface ChipModalFileFieldProps extends ChipModalFieldBaseProps {
  type: 'file'
  /** Called with the selected or dropped files. */
  onChange: (files: File[]) => void
  /** `accept` attribute forwarded to the native file input (e.g. `'image/*'`, `'.csv'`). */
  accept?: string
  /** Allow selecting multiple files. Defaults to `false`. */
  multiple?: boolean
  /**
   * Primary call-to-action rendered inside the drop zone. Defaults to
   * `'Drop files here or click to browse'`. Pass a dynamic value to reflect a
   * current selection (e.g. `'Uploaded data.json — click or drop to replace'`).
   */
  label?: string
  /**
   * Secondary line inside the drop zone — accepted formats / size limits. Omit
   * for a single-line zone.
   */
  description?: React.ReactNode
  /**
   * Renders a spinner inside the drop zone and blocks further picks while an
   * async import/upload is in flight. Use for slow selections (zip extraction,
   * remote fetches) where the zone would otherwise look idle. Pair with a
   * `label` such as `'Importing…'` for an explicit status line.
   * @default false
   */
  loading?: boolean
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
   * invalid chip whose reason shows in a tooltip on hover); return `null`
   * to accept.
   */
  validate?: (email: string) => string | null
  /**
   * External error (e.g. server-side submit failure), rendered in the inline
   * banner below the field. Per-email rejection reasons are shown on the
   * invalid chips themselves, not here.
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
  | ChipModalCopyFieldProps
  | ChipModalDropdownFieldProps
  | ChipModalFileFieldProps
  | ChipModalEmailsFieldProps
  | ChipModalCustomFieldProps

/**
 * Declarative labeled field row. The `type` discriminator selects which
 * control renders, and the field owns all chrome internally — consumers
 * never pass `variant`, `className`, or `id` to the underlying control.
 *
 * Use `type='copy'` for view-only values — a read-only field at full opacity
 * with a trailing copy button, never a `disabled` (greyed) input. Use
 * `type='custom'` to wrap arbitrary JSX (e.g. an `InfoCard` for a
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
    props.type === 'copy' ||
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
        <ChipInput
          id={id}
          type={props.type === 'email' ? 'email' : (props.inputType ?? 'text')}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={
            props.onSubmit
              ? (event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    props.onSubmit?.()
                  }
                }
              : undefined
          }
          placeholder={props.placeholder}
          maxLength={props.type === 'input' ? props.maxLength : undefined}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          inputClassName={props.type === 'input' && props.mono ? 'font-mono' : undefined}
          {...aria}
        />
      )
    case 'textarea':
      return (
        <ChipTextarea
          id={id}
          value={props.value}
          onChange={(event) => props.onChange?.(event.target.value)}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          rows={props.rows}
          disabled={props.disabled}
          viewOnly={props.viewOnly}
          resizable={props.resizable}
          className={props.mono ? 'font-mono' : undefined}
          style={props.minHeight ? { minHeight: props.minHeight } : undefined}
          {...aria}
        />
      )
    case 'copy':
      return (
        <ChipCopyInput
          id={id}
          value={props.value}
          copyLabel={props.copyLabel}
          disabled={props.disabled}
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
    case 'file':
      return <ChipModalFileControl {...props} id={id} {...aria} />
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
 * chip lifecycle (valid + invalid items, dedupe, per-chip error tooltips)
 * and lifts only the valid email list up to the consumer via `onChange`.
 * Each rejected entry carries its rejection reason on the chip itself,
 * surfaced as a tooltip; the inline banner is reserved for the consumer's
 * `error` (e.g. server-side submit failures).
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

  /**
   * Synchronous mirror of `items`. Pasting multiple values calls `handleAdd`
   * once per value within a single event, before React re-renders — reading
   * the `items` state there would make every call see the same stale array
   * and each add overwrite the previous one (only the last pasted email
   * survives). All reads and writes go through the ref so consecutive adds
   * compose; `commitItems` keeps state and ref in lockstep.
   */
  const itemsRef = React.useRef<TagItem[]>(items)

  const commitItems = React.useCallback((next: TagItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  /**
   * Reconcile internal `items` with the consumer's `value` when the latter
   * changes externally (programmatic clear, partial-failure reseed, etc.).
   * When our own `onChange` is the source of the update, the valid items in
   * `items` already match `value` and this is a no-op.
   */
  React.useEffect(() => {
    const prevValid = itemsRef.current.filter((item) => item.isValid).map((item) => item.value)
    if (prevValid.length === value.length && prevValid.every((v, idx) => v === value[idx])) {
      return
    }
    itemsRef.current = value.map((v) => ({ value: v, isValid: true }))
    setItems(itemsRef.current)
  }, [value])

  const handleAdd = React.useCallback(
    (raw: string): boolean => {
      const email = raw.trim().toLowerCase()
      if (!email) return false
      const current = itemsRef.current
      if (current.some((item) => item.value === email)) return false

      const formatCheck = quickValidateEmail(email)
      if (!formatCheck.isValid) {
        commitItems([
          ...current,
          { value: email, isValid: false, error: formatCheck.reason ?? 'Invalid email format' },
        ])
        return false
      }

      const reason = validate?.(email)
      if (reason) {
        commitItems([...current, { value: email, isValid: false, error: reason }])
        return false
      }

      const next = [...current, { value: email, isValid: true }]
      commitItems(next)
      onChange(next.filter((item) => item.isValid).map((item) => item.value))
      return true
    },
    [validate, onChange, commitItems]
  )

  const handleRemove = React.useCallback(
    (_removed: string, index: number) => {
      const current = itemsRef.current
      const wasValid = current[index]?.isValid ?? false
      const next = current.filter((_, i) => i !== index)
      commitItems(next)
      if (wasValid) {
        onChange(next.filter((item) => item.isValid).map((item) => item.value))
      }
    },
    [onChange, commitItems]
  )

  return (
    <>
      <TagInput
        variant='block'
        items={items}
        onAdd={handleAdd}
        onRemove={handleRemove}
        placeholder={placeholder}
        placeholderWithTags={derivePlaceholderWithTags(placeholder)}
        disabled={disabled}
        autoFocus={autoFocus}
        id={id}
      />
      {error && (
        <p id={errorId} role='alert' className={CHIP_MODAL_FIELD_ERROR_CLASS}>
          {error}
        </p>
      )}
    </>
  )
}

/**
 * Internal renderer for {@link ChipModalField} `type='file'`. A dashed-border
 * drop zone that mirrors the chip text-field chrome (same `--surface-5`/`4`
 * fill, `--border-1` border, `rounded-lg`) so it stacks as a visual peer with
 * `input` / `textarea` fields — the dashed border is the only thing marking it
 * as an upload target. Owns the click-to-browse proxy, drag-and-drop, and the
 * drag-active highlight; lifts the chosen files up via `onChange`. The native
 * input is reset after each pick so selecting the same file again still fires.
 */
function ChipModalFileControl({
  onChange,
  accept,
  multiple = false,
  label = 'Drop files here or click to browse',
  description,
  loading = false,
  disabled,
  id,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
}: ChipModalFileFieldProps & { id: string } & React.AriaAttributes) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const isInteractive = !disabled && !loading

  const emitFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      onChange(Array.from(files))
    },
    [onChange]
  )

  return (
    <button
      type='button'
      id={id}
      disabled={!isInteractive}
      aria-busy={loading || undefined}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedby}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (isInteractive) setIsDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setIsDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setIsDragging(false)
        if (isInteractive) emitFiles(event.dataTransfer.files)
      }}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-1)] border-dashed bg-[var(--surface-5)] px-2 py-2.5 text-center outline-none transition-colors hover-hover:border-[var(--surface-7)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--surface-4)]',
        isDragging && 'border-[var(--surface-7)]'
      )}
    >
      <input
        ref={inputRef}
        type='file'
        accept={accept}
        multiple={multiple}
        disabled={!isInteractive}
        className='hidden'
        onChange={(event) => {
          emitFiles(event.target.files)
          event.target.value = ''
        }}
      />
      {loading ? <Loader animate className='size-[14px] text-[var(--text-tertiary)]' /> : null}
      <span className='text-[var(--text-primary)] text-caption'>
        {isDragging ? 'Drop files here' : label}
      </span>
      {description ? (
        <span className='text-[var(--text-tertiary)] text-xs'>{description}</span>
      ) : null}
    </button>
  )
}

/**
 * A single footer action button. Rendered internally as a {@link Chip} so every
 * modal footer stays visually identical — callers describe intent (label,
 * handler, optional variant), never JSX or chrome. Encode pending state in the
 * `label` and `disabled` (e.g. `saving ? 'Saving...' : 'Save'`).
 */
export interface ChipModalFooterAction {
  /** Button label. */
  label: React.ReactNode
  /** Click handler. */
  onClick: () => void
  /** Disables the button. */
  disabled?: boolean
  /**
   * Explains why the action is unavailable — shown in a tooltip on hover/focus
   * while `disabled` is true. Ignored when the action is enabled. Honored on
   * `primaryAction` only.
   */
  disabledTooltip?: string
  /**
   * Chip variant, restricted to the footer-appropriate options so a
   * footer can never drift from the design system.
   * @default 'primary' for `primaryAction`, the bare default chip for `secondaryActions`
   */
  variant?: Extract<ChipProps['variant'], 'primary' | 'destructive'>
}

/**
 * Escape hatch for the left-docked footer cluster: renders the given node in
 * place of a declarative action Chip. Reserve it for chip-chrome controls
 * (`ChipDatePicker`, `ChipTimePicker`, `ChipDropdown`, ...) so the footer
 * stays visually canonical — pass `flush` to the control so it sits on the
 * cluster's `gap-2` rhythm like the footer's own Chips. The primary action
 * stays declarative by design; only `secondaryActions` accepts custom
 * controls.
 */
export interface ChipModalFooterCustomAction {
  /** Chip-chrome control rendered verbatim in the slot. */
  custom: React.ReactNode
}

/** One entry of the footer's left-docked `secondaryActions` cluster. */
export type ChipModalFooterSlotAction = ChipModalFooterAction | ChipModalFooterCustomAction

export interface ChipModalFooterProps {
  /**
   * Dismiss handler for the Cancel button. For standard form footers Cancel is
   * structural — it always reads "Cancel" and cannot be relabeled. Its enabled
   * state is controlled via {@link ChipModalFooterProps.cancelDisabled}. A
   * multi-step/wizard footer whose own Back navigation plus the header close (X)
   * already cover dismissal may suppress it via
   * {@link ChipModalFooterProps.hideCancel}.
   */
  onCancel: () => void
  /**
   * Disables the Cancel button. Set this while a primary/secondary action is
   * in flight (e.g. an async delete or save) so the user cannot dismiss the
   * modal and assume the operation was aborted while the mutation keeps running.
   * @default false
   */
  cancelDisabled?: boolean
  /**
   * Suppresses the Cancel button entirely. Reserve for multi-step/wizard footers
   * where the in-footer Back navigation plus the header close (X) already provide
   * dismissal, so a third dismiss affordance is redundant. Standard one-shot form
   * footers keep Cancel — do not hide it merely to declutter.
   * @default false
   */
  hideCancel?: boolean
  /** Primary action, anchored bottom-right (e.g. Save, Create, Delete). */
  primaryAction: ChipModalFooterAction
  /**
   * An action rendered immediately to the LEFT of the {@link primaryAction},
   * inside the right-anchored cluster (after the structural Cancel). Use for the
   * trailing half of a paired control that reads as ONE unit with the primary —
   * canonically a wizard's `Back` sitting beside `Next`, or a "skip ahead"
   * shortcut beside the primary — where docking it to the far-left
   * {@link secondaryActions} slot would visually divorce it from the primary it
   * pairs with. Rendered as a bare {@link Chip} (same chrome as Cancel) so the
   * filled primary stays the sole emphasized control; accepts a
   * {@link ChipModalFooterCustomAction} for chip-chrome controls.
   */
  primaryAdjacentAction?: ChipModalFooterSlotAction
  /**
   * Auxiliary actions docked to the far-left, opposite the Cancel/primary
   * cluster, rendered in order on the cluster's `gap-2` rhythm — e.g. Delete
   * in an edit flow, a wizard's "skip ahead" shortcut, or chip-chrome controls
   * (a date + time picker pair in a scheduling footer) via
   * {@link ChipModalFooterCustomAction}. Like a `Resource` header's actions,
   * each entry is a constrained {@link ChipModalFooterSlotAction} — consumers
   * describe intent, never chrome.
   */
  secondaryActions?: ChipModalFooterSlotAction[]
}

/**
 * Shared footer chrome — the inset separator plus the tinted `--surface-3` bar
 * with the standard gutter. Single source of truth so {@link ChipModalFooter}
 * and {@link ChipConfirmModal} render an identical footer surface. `leftSlot`
 * docks to the far-left (opposite the right-anchored button cluster); when
 * omitted the cluster is right-justified.
 */
function ChipModalFooterShell({
  leftSlot,
  children,
}: {
  leftSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col'>
      <ChipModalSeparator />
      <div
        className={cn(
          'flex items-center gap-x-2 gap-y-1.5 bg-[var(--surface-3)] px-4 pt-2 pb-2',
          leftSlot ? 'justify-between' : 'justify-end'
        )}
      >
        {leftSlot ?? null}
        <div className='flex shrink-0 gap-2'>{children}</div>
      </div>
    </div>
  )
}

/**
 * Renders a left-cluster footer slot: a declarative
 * {@link ChipModalFooterAction} as the canonical {@link Chip}, or a
 * {@link ChipModalFooterCustomAction}'s control verbatim.
 */
function renderFooterSlotAction(action: ChipModalFooterSlotAction): React.ReactNode {
  if ('custom' in action) return action.custom
  return (
    <Chip variant={action.variant} flush onClick={action.onClick} disabled={action.disabled}>
      {action.label}
    </Chip>
  )
}

/**
 * Footer row with a fixed, declarative shape: an optional far-left
 * `secondaryActions` cluster, then the always-present Cancel and the
 * right-anchored `primaryAction`. Buttons are described via
 * {@link ChipModalFooterAction} and rendered as {@link Chip}s, so no footer
 * can drift from the canonical layout; the secondary entries additionally
 * accept a chip-chrome control via {@link ChipModalFooterCustomAction}.
 *
 * For "are you sure?" confirmations, reach for {@link ChipConfirmModal} instead
 * — a confirmation's dismiss button is a named decision ("Keep editing"), not
 * the structural Cancel this footer guarantees.
 */
function ChipModalFooter({
  onCancel,
  cancelDisabled,
  hideCancel = false,
  primaryAction,
  primaryAdjacentAction,
  secondaryActions,
}: ChipModalFooterProps) {
  const showsDisabledTooltip = Boolean(primaryAction.disabled && primaryAction.disabledTooltip)
  const primaryChip = (
    <Chip
      variant={primaryAction.variant ?? 'primary'}
      flush
      onClick={primaryAction.onClick}
      disabled={primaryAction.disabled}
      className={cn(showsDisabledTooltip && 'pointer-events-none')}
    >
      {primaryAction.label}
    </Chip>
  )

  return (
    <ChipModalFooterShell
      leftSlot={
        secondaryActions && secondaryActions.length > 0 ? (
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            {secondaryActions.map((action, index) => (
              <React.Fragment key={index}>{renderFooterSlotAction(action)}</React.Fragment>
            ))}
          </div>
        ) : undefined
      }
    >
      {hideCancel ? null : (
        <Chip flush onClick={onCancel} disabled={cancelDisabled}>
          Cancel
        </Chip>
      )}
      {primaryAdjacentAction ? renderFooterSlotAction(primaryAdjacentAction) : null}
      {showsDisabledTooltip ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className='inline-flex cursor-not-allowed'>{primaryChip}</span>
          </Tooltip.Trigger>
          <Tooltip.Content>{primaryAction.disabledTooltip}</Tooltip.Content>
        </Tooltip.Root>
      ) : (
        primaryChip
      )}
    </ChipModalFooterShell>
  )
}

ChipModalFooter.displayName = 'ChipModalFooter'

/**
 * The confirming action of a {@link ChipConfirmModal}. Unlike a
 * {@link ChipModalFooterAction}, pending state is first-class: set `pending`
 * while the async action runs and the primitive disables BOTH buttons (so the
 * dismiss can't be clicked mid-mutation) and swaps in `pendingLabel`.
 */
export interface ChipConfirmAction {
  /** Resting button label (e.g. `'Delete'`). */
  label: string
  /** Invoked when the user confirms. */
  onClick: () => void
  /**
   * Chip variant. Confirmations are usually destructive, so this defaults to
   * `'destructive'`; use `'primary'` for a non-destructive confirm (e.g.
   * "Promote to live").
   * @default 'destructive'
   */
  variant?: Extract<ChipProps['variant'], 'primary' | 'destructive'>
  /**
   * Marks the action in-flight: disables both the confirm and dismiss buttons
   * and, when {@link ChipConfirmAction.pendingLabel} is set, shows it in place
   * of `label`.
   */
  pending?: boolean
  /** Label shown while `pending` (e.g. `'Deleting...'`). Falls back to `label`. */
  pendingLabel?: string
  /** Additional disable condition independent of `pending` (e.g. an unmet "type to confirm"). */
  disabled?: boolean
}

/**
 * One run of confirmation copy in a {@link ChipConfirmModalProps.text} array.
 *
 * - A plain string renders in the base style.
 * - `bold` emphasizes the run — use for the name of the thing being acted on.
 * - `error` colors the run `--text-error` — use for the irreversible
 *   consequence sentence.
 * - Falsy entries (`false` / `null` / `undefined`) are skipped, so runs can be
 *   included conditionally, mirroring `cn()`.
 *
 * Segments concatenate VERBATIM — nothing is inserted between them — so spaces
 * live inside the strings (`'Deleting '`) and punctuation can sit flush
 * against an emphasized name (`{ text: name, bold: true }, '?'`).
 */
export type ChipConfirmTextSegment =
  | string
  | {
      /**
       * Run copy. Must be a string — give interpolations a fallback
       * (`target?.name ?? 'this key'`) rather than rendering a hole.
       */
      text: string
      /** Emphasizes the run (a `font-medium` `<strong>`). */
      bold?: boolean
      /** Renders the run in `--text-error`. */
      error?: boolean
    }
  | false
  | null
  | undefined

/**
 * Confirmation copy for {@link ChipConfirmModal}: a plain string for
 * single-style sentences, or an ordered run of {@link ChipConfirmTextSegment}s
 * when parts need emphasis or error coloring.
 */
export type ChipConfirmText = string | readonly ChipConfirmTextSegment[]

/** True when `text` resolves to at least one non-empty run. */
function hasChipConfirmText(text: ChipConfirmText | undefined): text is ChipConfirmText {
  if (text === undefined) return false
  if (typeof text === 'string') return text.length > 0
  return text.some((segment) => {
    if (!segment) return false
    return typeof segment === 'string' ? segment.length > 0 : segment.text.length > 0
  })
}

/** Renders confirmation copy runs; per-run chrome is fixed by the segment flags. */
function renderChipConfirmText(text: ChipConfirmText): React.ReactNode {
  if (typeof text === 'string') return text
  return text.map((segment, index) => {
    if (!segment) return null
    if (typeof segment === 'string') {
      return <React.Fragment key={index}>{segment}</React.Fragment>
    }
    if (segment.bold) {
      return (
        <strong
          key={index}
          className={cn('font-medium', segment.error && 'text-[var(--text-error)]')}
        >
          {segment.text}
        </strong>
      )
    }
    if (segment.error) {
      return (
        <span key={index} className='text-[var(--text-error)]'>
          {segment.text}
        </span>
      )
    }
    return <React.Fragment key={index}>{segment.text}</React.Fragment>
  })
}

export interface ChipConfirmModalProps {
  /** Controlled open state. */
  open: boolean
  /**
   * Open-state change handler and the SINGLE dismiss path — the header close
   * (X), the dismiss button, Escape, and overlay click all route through
   * `onOpenChange(false)`. Put any teardown (clearing the targeted row, etc.)
   * here so no dismiss path can skip it.
   */
  onOpenChange: (open: boolean) => void
  /** Title rendered in the header. */
  title: React.ReactNode
  /** Optional leading header icon. */
  icon?: React.ComponentType<{ className?: string }> | null
  /**
   * Confirmation copy. A plain string, or a segment array when parts of the
   * sentence need emphasis (`bold`) or consequence coloring (`error`).
   * Rendered in `--text-primary` at `text-sm`; the modal owns all chrome —
   * there is no className passthrough.
   *
   * Segments concatenate verbatim (no separators): keep spaces inside the
   * strings, and use a bare `' '` segment only between two adjacent styled
   * runs. Falsy segments are skipped for conditional copy.
   */
  text?: ChipConfirmText
  /**
   * Extra body content below `text` — e.g. a "type the name to confirm"
   * {@link ChipModalField}. Most confirmations omit this.
   */
  children?: React.ReactNode
  /** The confirming action (Delete / Discard / Remove …). */
  confirm: ChipConfirmAction
  /**
   * Label for the dismiss button. In a confirmation the dismiss button is a
   * named decision, so this is honest API (unlike a form footer's structural
   * Cancel). Defaults to `'Cancel'`; pass `'Keep editing'` for unsaved-changes.
   * @default 'Cancel'
   */
  dismissLabel?: string
  /**
   * Panel width. Confirmations are compact, so defaults to `'sm'`.
   * @default 'sm'
   */
  size?: ChipModalProps['size']
  /** Screen-reader title; defaults to the string form of `title` when omitted. */
  srTitle?: string
}

/**
 * Compact "are you sure?" confirmation dialog. Models the confirmation button
 * grammar directly — a named dismiss decision plus a (usually destructive)
 * confirm — instead of bending the form footer's structural Cancel to fit.
 *
 * The primitive owns the safety rails that every hand-rolled confirm modal had
 * to remember: a single dismiss path shared by the header X / dismiss button /
 * Escape (so teardown can't desync), and disabling dismiss while the confirm is
 * in flight. Drop richer body content (a "type to confirm" field) in as
 * `children`.
 *
 * @example
 * ```tsx
 * <ChipConfirmModal
 *   open={open}
 *   onOpenChange={(next) => { if (!next) setTarget(null); setOpen(next) }}
 *   title='Delete API key'
 *   text={[
 *     'Deleting ',
 *     { text: target?.name ?? 'this key', bold: true },
 *     { text: ' will immediately revoke access.', error: true },
 *     ' This action cannot be undone.',
 *   ]}
 *   confirm={{ label: 'Delete', onClick: handleDelete, pending: isDeleting, pendingLabel: 'Deleting...' }}
 * />
 * ```
 */
function ChipConfirmModal({
  open,
  onOpenChange,
  title,
  icon,
  text,
  children,
  confirm,
  dismissLabel = 'Cancel',
  size = 'sm',
  srTitle,
}: ChipConfirmModalProps) {
  const dismiss = React.useCallback(() => onOpenChange(false), [onOpenChange])
  const confirmLabel = confirm.pending ? (confirm.pendingLabel ?? confirm.label) : confirm.label

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      size={size}
      srTitle={srTitle ?? (typeof title === 'string' ? title : 'Confirm')}
    >
      <ChipModalHeader icon={icon} onClose={dismiss}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {hasChipConfirmText(text) ? (
          <p className='break-words px-2 text-[var(--text-primary)] text-sm'>
            {renderChipConfirmText(text)}
          </p>
        ) : null}
        {children}
      </ChipModalBody>
      <ChipModalFooterShell>
        <Chip flush onClick={dismiss} disabled={confirm.pending}>
          {dismissLabel}
        </Chip>
        <Chip
          variant={confirm.variant ?? 'destructive'}
          flush
          onClick={confirm.onClick}
          disabled={confirm.disabled || confirm.pending}
        >
          {confirmLabel}
        </Chip>
      </ChipModalFooterShell>
    </ChipModal>
  )
}

ChipConfirmModal.displayName = 'ChipConfirmModal'

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
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalPromptBody,
  ChipModalTabs,
}
