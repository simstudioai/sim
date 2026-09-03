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
import { Eye, EyeOff, Loader, X } from '../../icons'
import { cn } from '../../lib/cn'
import { Button } from '../button/button'
import { Chip, type ChipProps } from '../chip/chip'
import { chipContentIconClass, chipContentLabelClass } from '../chip/chip-chrome'
import { ChipCopyInput } from '../chip-copy-input/chip-copy-input'
import { ChipDropdown, type ChipDropdownOption } from '../chip-dropdown/chip-dropdown'
import { ChipEmailsInput, type ChipEmailsInputProps } from '../chip-emails-input/chip-emails-input'
import { ChipInput } from '../chip-input/chip-input'
import { ChipSwitch } from '../chip-switch/chip-switch'
import { ChipTextarea } from '../chip-textarea/chip-textarea'
import { Label } from '../label/label'
import { focusFirstTextInputIn, isElementVisible } from '../modal/auto-focus'
import { Modal, ModalContent, useModalDismissDisabled } from '../modal/modal'
import { OverflowText } from '../overflow-text/overflow-text'
import { Tooltip } from '../tooltip/tooltip'

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

const CHIP_MODAL_DEFAULT_ACTION_SELECTOR =
  '[data-chip-modal-default-action]:not([disabled]):not([aria-disabled="true"])'
const CHIP_MODAL_SUBMIT_ACTION_SELECTOR =
  '[data-chip-modal-submit-action]:not([disabled]):not([aria-disabled="true"])'
const CHIP_MODAL_DISMISS_ACTION_SELECTOR =
  '[data-chip-modal-dismiss-action]:not([disabled]):not([aria-disabled="true"])'
const CHIP_MODAL_INPUT_TYPES_WITH_OWN_ENTER = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
])

function isPlainEnter(event: React.KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.defaultPrevented &&
    !event.repeat &&
    !event.nativeEvent.isComposing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
}

function findFocusableAction(content: HTMLElement, selector: string): HTMLElement | null {
  return (
    Array.from(content.querySelectorAll<HTMLElement>(selector)).find(
      (element) => isElementVisible(element) && !element.closest('[aria-hidden="true"], [inert]')
    ) ?? null
  )
}

function findVisibleDefaultPolicy(content: HTMLElement): string | null {
  const shell = Array.from(
    content.querySelectorAll<HTMLElement>('[data-chip-modal-default-policy]')
  ).find(
    (element) => isElementVisible(element) && !element.closest('[aria-hidden="true"], [inert]')
  )
  return shell?.getAttribute('data-chip-modal-default-policy') ?? null
}

/**
 * Moves initial focus according to the modal's declared default-action policy.
 * Editable text controls remain first because typing is the natural first step
 * in a form. Otherwise the declared action receives focus, so native button
 * keyboard behavior owns Enter while that button is focused. A disabled default
 * falls back to the safe dismiss action; a `none` policy focuses the dialog
 * itself so no button is accidentally armed.
 */
function focusChipModalDefaultAction(event: Event): void {
  const content = event.currentTarget as HTMLElement | null
  if (!content) return
  if (focusFirstTextInputIn(content)) {
    event.preventDefault()
    return
  }

  const policy = findVisibleDefaultPolicy(content)
  const target =
    policy === 'none'
      ? content
      : (findFocusableAction(content, CHIP_MODAL_DEFAULT_ACTION_SELECTOR) ??
        findFocusableAction(content, CHIP_MODAL_DISMISS_ACTION_SELECTOR) ??
        content)

  event.preventDefault()
  target.focus()
  if (document.activeElement !== target) content.focus()
}

/**
 * Supplies implicit submission for single-line custom inputs that are not a
 * {@link ChipModalField}. Canonical fields handle Enter at the control so they
 * can support `onSubmit` and `submitOnEnter`; this content-level fallback is
 * intentionally narrow and yields to native forms and controls that own Enter
 * (tag inputs, comboboxes, buttons, textareas, and rich editors).
 */
function handleChipModalEnter(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!isPlainEnter(event)) return

  const target = event.target
  if (!(target instanceof HTMLInputElement) || !event.currentTarget.contains(target)) return
  if (
    target.form ||
    target.disabled ||
    target.readOnly ||
    CHIP_MODAL_INPUT_TYPES_WITH_OWN_ENTER.has(target.type) ||
    target.hasAttribute('list') ||
    target.hasAttribute('aria-autocomplete') ||
    target.hasAttribute('aria-haspopup') ||
    target.closest(
      '[data-chip-modal-enter-owner], [role="combobox"], [role="listbox"], [role="menu"]'
    )
  ) {
    return
  }

  const action = findFocusableAction(event.currentTarget, CHIP_MODAL_SUBMIT_ACTION_SELECTOR)
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  action.click()
}

export interface ChipModalProps {
  /** Controlled open state. */
  open: boolean
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void
  /** Screen-reader title for the underlying dialog. */
  srTitle?: string
  /** ID of concise body copy that describes the dialog's purpose. */
  'aria-describedby'?: string
  /**
   * Panel width preset. Matches the underlying `Modal` widths exactly:
   * `sm` 440 · `md` 500 · `lg` 600 · `xl` 800 · `full` 1200 (px max, `w-[90vw]`
   * on smaller viewports). Defaults to `'md'`.
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Optional className forwarded to the outer panel ring. */
  className?: string
  /**
   * Refuses every exit while an action is in flight — Escape, outside-click,
   * the header close button, and the footer Cancel. Stating it once here is the
   * point: disabling only the buttons leaves Escape and outside-click open,
   * which reads as handled without being handled.
   * @default false
   */
  dismissDisabled?: boolean
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
  dismissDisabled = false,
  children,
  'aria-describedby': ariaDescribedBy,
}: ChipModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        bare
        showClose={false}
        srTitle={srTitle}
        size={size}
        dismissDisabled={dismissDisabled}
        onOpenAutoFocus={focusChipModalDefaultAction}
        onKeyDown={handleChipModalEnter}
        aria-describedby={ariaDescribedBy}
      >
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
  /**
   * Disables the trailing close button. Combines with
   * {@link ChipModalProps.dismissDisabled}, which also blocks Escape and
   * outside-click — prefer that for an in-flight operation.
   */
  closeDisabled?: boolean
  /** Accessible label for the close button. */
  closeAriaLabel?: string
}

/**
 * Header row with optional leading icon, title, and a trailing close button.
 * Always renders an inset divider below the title to match the panel's rhythm.
 */
const ChipModalHeader = React.forwardRef<HTMLDivElement, ChipModalHeaderProps>(
  (
    {
      className,
      children,
      icon: Icon = null,
      onClose,
      closeDisabled,
      closeAriaLabel = 'Close',
      ...props
    },
    ref
  ) => {
    const dismissDisabled = useModalDismissDisabled()
    return (
      <div ref={ref} className={cn('flex flex-col', className)} {...props}>
        <div className='flex min-w-0 items-center justify-between gap-2 px-4 pt-3'>
          <div className='flex min-w-0 items-center gap-2'>
            {Icon ? <Icon className={chipContentIconClass} /> : null}
            {typeof children === 'string' || typeof children === 'number' ? (
              <OverflowText label={String(children)} className={chipContentLabelClass} />
            ) : (
              <span className={chipContentLabelClass}>{children}</span>
            )}
          </div>
          <Button
            type='button'
            variant='ghost'
            onClick={onClose}
            disabled={closeDisabled || dismissDisabled}
            className='relative size-[14px] shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
          >
            <X className='size-[14px] text-[var(--text-icon)]' />
            <span className='sr-only'>{closeAriaLabel}</span>
          </Button>
        </div>
        <ChipModalSeparator className='mt-3' />
      </div>
    )
  }
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
 * Pinned to `w-fit` so the pill always hugs its tabs: dropped directly into a
 * flex column the `inline-flex` trough is otherwise blockified and stretched
 * full-width by `align-items: stretch`. A caller-supplied width class still wins.
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
      className={cn('w-fit', className)}
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
export interface ChipModalBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Removes the field gutter and scrolling chrome for one edge-to-edge surface. */
  fullBleed?: boolean
}

const ChipModalBody = React.forwardRef<HTMLDivElement, ChipModalBodyProps>(
  ({ className, fullBleed = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        fullBleed ? 'overflow-hidden' : 'gap-4 overflow-y-auto overflow-x-hidden px-2 pt-4 pb-4.5',
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

/**
 * Enter-submit behavior shared by the single-line field types (`input`,
 * `email`). Both fire the modal's {@link ChipModalFooter} primary action on
 * Enter by default; these props override or opt out of that.
 */
interface ChipModalSingleLineEnterProps {
  /**
   * Overrides the default Enter behavior. By default, pressing Enter in a
   * single-line field fires the {@link ChipModalFooter} primary action (unless
   * it's disabled), so a plain modal submits on Enter with no wiring. Pass
   * `onSubmit` only when Enter should do something OTHER than the primary action
   * (e.g. advance a multi-step flow).
   */
  onSubmit?: () => void
  /**
   * Opts this field out of the automatic Enter-submits-the-primary-action
   * behavior. Set `false` for a config knob that lives inside a larger form
   * (e.g. a "number of runs" input in a scheduling modal) where Enter firing
   * the modal's primary action would submit prematurely. Ignored when an
   * explicit `onSubmit` is provided.
   * @default true
   */
  submitOnEnter?: boolean
}

interface ChipModalInputFieldProps extends ChipModalFieldBaseProps, ChipModalSingleLineEnterProps {
  type: 'input'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  autoComplete?: string
  /**
   * Native input type override. Defaults to `'text'`.
   *
   * `'password'` renders the field's canonical secret treatment — masked while
   * unfocused, revealed while focused, plus an eye toggle — rather than a plain
   * native password input. See {@link ChipModalPasswordControl}.
   */
  inputType?: 'text' | 'password' | 'url' | 'tel' | 'search' | 'number'
  /**
   * Virtual-keyboard hint, independent of {@link inputType}.
   *
   * A field holding a number usually wants `inputMode='numeric'` on a `'text'` input
   * rather than `inputType='number'`: the numeric type renders the browser's stepper,
   * which paints its own chrome inside a flat chip surface, and reports `''` for any
   * value it considers invalid — so the caller cannot tell an empty field from a
   * rejected keystroke.
   */
  inputMode?: 'numeric' | 'decimal' | 'tel'
  /**
   * Renders the value in the monospace stack (`font-mono`). Use for
   * code-like values (identifiers, keys, snippets) where the proportional
   * stack hurts legibility.
   * @default false
   */
  mono?: boolean
}

interface ChipModalEmailFieldProps extends ChipModalFieldBaseProps, ChipModalSingleLineEnterProps {
  type: 'email'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
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

/**
 * The emails field is a thin row wrapper over {@link ChipEmailsInput} — the
 * control's own props (`value`, `onChange`, `validate`, `allowDomains`,
 * `placeholder`, …) pass straight through, so they are declared in one place.
 * `variant` is not forwarded: the field always uses the tall `block` chip
 * surface so it stacks as a peer with `textarea` fields.
 */
export interface ChipModalEmailsFieldProps
  extends ChipModalFieldBaseProps,
    Omit<ChipEmailsInputProps, 'variant' | 'id'> {
  type: 'emails'
  /**
   * External error (e.g. server-side submit failure), rendered in the inline
   * banner below the field. Per-email rejection reasons are shown on the
   * invalid chips themselves, not here.
   */
  error?: React.ReactNode
}

/**
 * ARIA the field derives from its own state and renders elsewhere in the row —
 * the `hint`/`error` paragraph ids, plus `required`/`invalid` flags.
 */
export interface ChipModalFieldAria {
  'aria-required'?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

interface ChipModalCustomFieldProps extends ChipModalFieldBaseProps {
  type: 'custom'
  /**
   * Whether Enter in a nested plain single-line input should trigger the
   * footer's default primary action. Set `false` when the custom control owns
   * Enter, such as a search/filter or token editor.
   * @default true
   */
  submitOnEnter?: boolean
  /**
   * Arbitrary JSX, or a function receiving the field's {@link ChipModalFieldAria}.
   *
   * The owned control types wire this ARIA themselves, but a custom field can
   * hold anything — a bare input, or a wrapper several levels above one — so
   * the field cannot know which element should carry it. Use the function form
   * whenever the child renders a focusable control, or its `hint`/`error` text
   * is rendered but never announced.
   */
  children: React.ReactNode | ((aria: ChipModalFieldAria) => React.ReactNode)
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
    <div
      className={cn('flex flex-col gap-[9px]', flush ? 'px-0' : 'px-2', className)}
      data-chip-modal-enter-owner={
        props.type === 'custom' && props.submitOnEnter === false ? '' : undefined
      }
    >
      <Label htmlFor={associatesLabel ? id : undefined} className='pl-0.5 text-[var(--text-muted)]'>
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
    case 'email': {
      const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) =>
        handleSingleLineEnter(event, props)

      if (props.type === 'input' && props.inputType === 'password') {
        return (
          <ChipModalPasswordControl
            id={id}
            value={props.value}
            onChange={props.onChange}
            onKeyDown={onKeyDown}
            placeholder={props.placeholder}
            maxLength={props.maxLength}
            autoComplete={props.autoComplete}
            disabled={props.disabled}
            mono={props.mono}
            aria={aria}
          />
        )
      }

      return (
        <ChipInput
          id={id}
          type={props.type === 'email' ? 'email' : (props.inputType ?? 'text')}
          inputMode={props.type === 'input' ? props.inputMode : undefined}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.placeholder}
          maxLength={props.type === 'input' ? props.maxLength : undefined}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          inputClassName={props.type === 'input' && props.mono ? 'font-mono' : undefined}
          {...aria}
        />
      )
    }
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
      return typeof props.children === 'function' ? props.children(aria) : props.children
  }
}

/**
 * Enter handling shared by every single-line control: an explicit `onSubmit`
 * wins, otherwise Enter fires the {@link ChipModalFooter} primary action unless
 * the field opted out via `submitOnEnter={false}`.
 */
function handleSingleLineEnter(
  event: React.KeyboardEvent<HTMLInputElement>,
  props: ChipModalSingleLineEnterProps
) {
  if (!isPlainEnter(event)) return
  if (props.onSubmit) {
    event.preventDefault()
    event.stopPropagation()
    props.onSubmit()
    return
  }
  if (props.submitOnEnter === false) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.currentTarget.form) return
  const content = event.currentTarget.closest<HTMLElement>('[role="dialog"]')
  const action = content ? findFocusableAction(content, CHIP_MODAL_SUBMIT_ACTION_SELECTOR) : null
  if (action) {
    event.preventDefault()
    // Stop bubbling so a parent Enter handler (e.g. a modal body that also
    // submits) can't fire the same primary action a second time.
    event.stopPropagation()
    action.click()
  }
}

/**
 * Internal renderer for {@link ChipModalField} `type='input'` with
 * `inputType='password'` — the canonical secret treatment, matching the secrets
 * and SSO client-secret fields: the value is masked while the field is
 * unfocused, revealed while it is focused, and an eye toggle pins the reveal so
 * a typed secret can be proof-read without staying on screen.
 *
 * The native input stays `type='text'` and opens `readOnly`, dropping the
 * attribute on focus. Masking therefore comes from `-webkit-text-security`
 * (which is what makes the reveal instant), and the read-only-until-focus dance
 * is what stops a password manager autofilling the operator's own credentials
 * into a field that sets some other account's password.
 */
interface ChipModalPasswordControlProps {
  id: string
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  maxLength?: number
  autoComplete?: string
  disabled?: boolean
  mono?: boolean
  /** ARIA the owning {@link ChipModalField} derives from its own state. */
  aria: ChipModalFieldAria
}

function ChipModalPasswordControl({
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  maxLength,
  autoComplete,
  disabled,
  mono,
  aria,
}: ChipModalPasswordControlProps) {
  const [revealed, setRevealed] = React.useState(false)

  return (
    <ChipInput
      id={id}
      type='text'
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      autoCapitalize='none'
      autoCorrect='off'
      spellCheck={false}
      disabled={disabled}
      readOnly
      onFocus={(event) => {
        event.currentTarget.removeAttribute('readOnly')
        setRevealed(true)
      }}
      onBlurCapture={() => setRevealed(false)}
      inputClassName={cn(!revealed && '[-webkit-text-security:disc]', mono && 'font-mono')}
      endAdornment={
        // Only offer the reveal once there is something to reveal.
        value ? (
          <Button
            type='button'
            variant='ghost'
            disabled={disabled}
            // Keep focus on the input: letting the button take it would fire the
            // blur re-mask first, so the click would toggle back from `false`
            // and "Hide" would leave a focused password on screen.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRevealed((current) => !current)}
            className='size-6 shrink-0 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            aria-label={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? <EyeOff className='size-[14px]' /> : <Eye className='size-[14px]' />}
          </Button>
        ) : undefined
      }
      {...aria}
    />
  )
}

/**
 * Internal renderer for {@link ChipModalField} `type='emails'`. Delegates the
 * chip lifecycle to {@link ChipEmailsInput} and adds only the field-level
 * error banner — per-entry rejection reasons are shown on the chips
 * themselves, so this banner is reserved for the consumer's `error` (e.g. a
 * server-side submit failure).
 */
function ChipModalEmailsControl({
  value,
  onChange,
  validate,
  allowDomains,
  placeholder,
  placeholderWithTags,
  autoFocus,
  disabled,
  error,
  errorId,
  id,
}: ChipModalEmailsFieldProps & { id: string; errorId: string }) {
  return (
    <>
      <ChipEmailsInput
        id={id}
        value={value}
        onChange={onChange}
        validate={validate}
        allowDomains={allowDomains}
        placeholder={placeholder}
        placeholderWithTags={placeholderWithTags}
        autoFocus={autoFocus}
        disabled={disabled}
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
        'flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-1)] border-dashed bg-[var(--surface-5)] px-2 py-2.5 text-center outline-hidden transition-colors hover-hover:border-[var(--surface-7)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--surface-4)]',
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
 * activation, optional variant), never JSX or chrome. Encode pending state in
 * the `label` and `disabled` (e.g. `saving ? 'Saving...' : 'Save'`).
 */
interface ChipModalFooterActionBase {
  /** Button label. */
  label: React.ReactNode
  /** Optional content rendered before the label, such as a pending spinner. */
  leftAdornment?: React.ReactNode
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

/** A footer action activated either directly or through an associated native form. */
export type ChipModalFooterAction = ChipModalFooterActionBase &
  (
    | { type?: 'button'; onClick: () => void; form?: never }
    | { type: 'submit'; form: string; onClick?: never }
  )

/**
 * Escape hatch for the left-docked footer cluster: renders the given node in
 * place of a declarative action Chip. Reserve it for chip-chrome controls
 * (`ChipDatePicker`, `ChipTimePicker`, `ChipDropdown`, ...) so the footer
 * stays visually canonical — the cluster's `gap-2` alone sets the rhythm, as
 * it does for the footer's own Chips, so the control must carry no outer
 * margin. The primary action stays declarative by design; only
 * `secondaryActions` accepts custom controls.
 */
export interface ChipModalFooterCustomAction {
  /** Chip-chrome control rendered verbatim in the slot. */
  custom: React.ReactNode
}

/** One entry of the footer's left-docked `secondaryActions` cluster. */
export type ChipModalFooterSlotAction = ChipModalFooterAction | ChipModalFooterCustomAction

export type ChipModalFooterDefaultAction = 'primary' | 'dismiss' | 'none'

interface ChipModalFooterCommonProps {
  /**
   * Disables the Cancel button. Set this while a primary/secondary action is
   * in flight (e.g. an async delete or save) so the user cannot dismiss the
   * modal and assume the operation was aborted while the mutation keeps running.
   *
   * This covers the Cancel button only. For an in-flight operation reach for
   * {@link ChipModalProps.dismissDisabled} instead, which also blocks Escape,
   * outside-click and the header's X.
   * @default false
   */
  cancelDisabled?: boolean
  /**
   * Declares the modal's keyboard default. A visible text field still receives
   * initial focus; pressing Enter there triggers `primary` only when this value
   * is `'primary'`. Without a text field, the corresponding real button gets
   * focus and therefore owns Enter natively. Use `'dismiss'` or `'none'` when
   * submission should require an explicit click.
   * @default 'primary'
   */
  defaultAction?: ChipModalFooterDefaultAction
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
  /** Non-interactive status or metadata docked to the far-left of the footer. */
  leadingContent?: React.ReactNode
}

type ChipModalFooterCancelProps =
  | {
      /** Dismiss handler for the structural Cancel button. */
      onCancel: () => void
      /** Suppresses Cancel when another dismissal affordance already exists. */
      hideCancel?: boolean
    }
  | {
      /** A hidden Cancel button has no inert callback to configure. */
      onCancel?: never
      hideCancel: true
    }

export type ChipModalFooterProps = ChipModalFooterCommonProps &
  ChipModalFooterCancelProps &
  (
    | {
        /** Primary action, anchored bottom-right (e.g. Save, Create, Delete). */
        primaryAction: ChipModalFooterAction
      }
    | {
        /** A footer without a primary action must explicitly decline primary submission. */
        primaryAction?: undefined
        defaultAction: Exclude<ChipModalFooterDefaultAction, 'primary'>
      }
  )

/**
 * Shared footer chrome — the inset separator plus the tinted `--surface-3` bar
 * with the standard gutter. Single source of truth so {@link ChipModalFooter}
 * and {@link ChipConfirmModal} render an identical footer surface. `leftSlot`
 * docks to the far-left (opposite the right-anchored button cluster); when
 * omitted the cluster is right-justified.
 */
function ChipModalFooterShell({
  defaultAction,
  leftSlot,
  children,
}: {
  defaultAction: ChipModalFooterDefaultAction | ChipConfirmDefaultAction
  leftSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col' data-chip-modal-default-policy={defaultAction}>
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
    <Chip
      type={action.type ?? 'button'}
      form={action.type === 'submit' ? action.form : undefined}
      variant={action.variant}
      leftAdornment={action.leftAdornment}
      onClick={action.type === 'submit' ? undefined : action.onClick}
      disabled={action.disabled}
    >
      {action.label}
    </Chip>
  )
}

/**
 * Footer row with a fixed, declarative shape: an optional far-left
 * status/action cluster, then Cancel and the right-anchored `primaryAction`
 * when those decisions exist. Buttons are described via
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
  defaultAction = 'primary',
  primaryAction,
  primaryAdjacentAction,
  secondaryActions,
  leadingContent,
}: ChipModalFooterProps) {
  const dismissDisabled = useModalDismissDisabled()
  const showsDisabledTooltip = Boolean(primaryAction?.disabled && primaryAction.disabledTooltip)

  const primaryChip = primaryAction ? (
    <Chip
      type={primaryAction.type ?? 'button'}
      form={primaryAction.type === 'submit' ? primaryAction.form : undefined}
      variant={primaryAction.variant ?? 'primary'}
      leftAdornment={primaryAction.leftAdornment}
      onClick={primaryAction.type === 'submit' ? undefined : primaryAction.onClick}
      disabled={primaryAction.disabled}
      className={cn(showsDisabledTooltip && 'pointer-events-none')}
      data-chip-modal-submit-action={defaultAction === 'primary' ? '' : undefined}
      data-chip-modal-default-action={defaultAction === 'primary' ? '' : undefined}
    >
      {primaryAction.label}
    </Chip>
  ) : null

  return (
    <ChipModalFooterShell
      defaultAction={defaultAction}
      leftSlot={
        leadingContent != null || (secondaryActions && secondaryActions.length > 0) ? (
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            {leadingContent}
            {secondaryActions?.map((action, index) => (
              <React.Fragment key={index}>{renderFooterSlotAction(action)}</React.Fragment>
            ))}
          </div>
        ) : undefined
      }
    >
      {hideCancel ? null : (
        <Chip
          onClick={onCancel}
          disabled={cancelDisabled || dismissDisabled}
          data-chip-modal-dismiss-action=''
          data-chip-modal-default-action={defaultAction === 'dismiss' ? '' : undefined}
        >
          Cancel
        </Chip>
      )}
      {primaryAdjacentAction ? renderFooterSlotAction(primaryAdjacentAction) : null}
      {showsDisabledTooltip && primaryAction ? (
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
  /**
   * Explains why the confirm is unavailable — shown in a tooltip on hover/focus
   * while `disabled` is true, so a blocked confirmation states its own remedy
   * instead of looking inert. Ignored while the action is enabled or `pending`.
   */
  disabledTooltip?: string
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

export type ChipConfirmDefaultAction = 'confirm' | 'dismiss' | 'none'

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
   * Declares the confirmation's keyboard default independently from button
   * color. Confirmations fail safe to `'dismiss'`; audited reversible or
   * non-destructive flows may opt into `'confirm'`, while severe guarded flows
   * can use `'none'` to require an explicit final click.
   * @default 'dismiss'
   */
  defaultAction?: ChipConfirmDefaultAction
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
 * The confirm chip, wrapped in a tooltip only when it is disabled and the action
 * explained why. A disabled `<button>` is not a hit-test target, so the wrapping
 * span carries `pointer-events-none` off the chip for the tooltip to fire.
 */
function renderChipConfirmButton(
  confirm: ChipConfirmAction,
  confirmLabel: string,
  defaultAction: ChipConfirmDefaultAction
) {
  const disabled = Boolean(confirm.disabled || confirm.pending)
  const chip = (
    <Chip
      variant={confirm.variant ?? 'destructive'}
      onClick={confirm.onClick}
      disabled={disabled}
      className={cn(confirm.disabledTooltip && disabled && 'pointer-events-none')}
      data-chip-modal-submit-action={defaultAction === 'confirm' ? '' : undefined}
      data-chip-modal-default-action={defaultAction === 'confirm' ? '' : undefined}
    >
      {confirmLabel}
    </Chip>
  )
  if (!confirm.disabledTooltip || !disabled) return chip
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className='inline-flex'>{chip}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>{confirm.disabledTooltip}</Tooltip.Content>
    </Tooltip.Root>
  )
}

interface ChipConfirmModalFooterProps {
  confirm: ChipConfirmAction
  confirmLabel: string
  defaultAction: ChipConfirmDefaultAction
  dismiss: () => void
  dismissLabel: string
}

function ChipConfirmModalFooter({
  confirm,
  confirmLabel,
  defaultAction,
  dismiss,
  dismissLabel,
}: ChipConfirmModalFooterProps) {
  return (
    <ChipModalFooterShell defaultAction={defaultAction}>
      <Chip
        onClick={dismiss}
        disabled={confirm.pending}
        data-chip-modal-dismiss-action=''
        data-chip-modal-default-action={defaultAction === 'dismiss' ? '' : undefined}
      >
        {dismissLabel}
      </Chip>
      {renderChipConfirmButton(confirm, confirmLabel, defaultAction)}
    </ChipModalFooterShell>
  )
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
  defaultAction = 'dismiss',
  dismissLabel = 'Cancel',
  size = 'sm',
  srTitle,
}: ChipConfirmModalProps) {
  const dismiss = () => onOpenChange(false)
  const confirmLabel = confirm.pending ? (confirm.pendingLabel ?? confirm.label) : confirm.label
  const descriptionId = React.useId()
  const hasText = hasChipConfirmText(text)

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      size={size}
      srTitle={srTitle ?? (typeof title === 'string' ? title : 'Confirm')}
      dismissDisabled={confirm.pending}
      aria-describedby={hasText ? descriptionId : undefined}
    >
      <ChipModalHeader icon={icon} onClose={dismiss}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {hasText ? (
          <p id={descriptionId} className='break-words px-2 text-[var(--text-primary)] text-sm'>
            {renderChipConfirmText(text)}
          </p>
        ) : null}
        {children}
      </ChipModalBody>
      <ChipConfirmModalFooter
        confirm={confirm}
        confirmLabel={confirmLabel}
        defaultAction={defaultAction}
        dismiss={dismiss}
        dismissLabel={dismissLabel}
      />
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
