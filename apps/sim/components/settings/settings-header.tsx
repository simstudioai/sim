'use client'

import {
  type ComponentType,
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chip, ChipInput, ChipLink, cn, Search, Tooltip } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * A collapsed desktop sidebar removes the content shell's 8px top gutter and the
 * pane's 1px border. Top-level settings headers have no left-side control to keep
 * clear of the traffic lights, so they reserve only those missing 9px instead of
 * the full title-bar lane. Their actions and body therefore stay at the same
 * window-relative height as the expanded layout. Detail headers with a Back
 * control retain the full lane inset.
 */
const COLLAPSED_DESKTOP_TOP_LEVEL_INSET =
  '[[data-sim-desktop-title-bar=inset]_[data-sidebar-collapsed]_&]:[--workspace-content-title-bar-inset:9px]'

export interface SettingsAction {
  /** Stable render identity. Falls back to `text`, which remounts the chip whenever the label flips (Save → Saving...). */
  id?: string
  text: string
  textTone?: 'error'
  icon?: ComponentType<{ className?: string }>
  variant?: 'primary' | 'destructive'
  active?: boolean
  onSelect: () => void
  disabled?: boolean
  tooltip?: string
  onPrefetch?: () => void
}

export interface SettingsHeaderSearch {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export interface SettingsBackAction {
  text: string
  icon?: ComponentType<{ className?: string }>
  onSelect: () => void
}

export interface SettingsHeaderConfig {
  title?: string
  description?: string
  docsLink?: string
  back?: SettingsBackAction
  actions?: SettingsAction[]
  search?: SettingsHeaderSearch
  scrollContainerRef?: Ref<HTMLDivElement>
}

/**
 * A section's static header identity, derivable from its navigation entry alone.
 *
 * The shell renders this until the section body mounts and registers a live config, so the
 * heading paints in the route's first frame instead of arriving a chunk fetch later.
 */
export interface SettingsHeaderMeta {
  title: string
  description?: string
  docsLink?: string
}

const EMPTY_CONFIG: SettingsHeaderConfig = {}
const RegisterContext = createContext<((config: SettingsHeaderConfig | null) => void) | null>(null)

interface ReadContextValue {
  /** `null` means no body currently owns the header. */
  configRef: { current: SettingsHeaderConfig | null }
  signature: string
}

const ReadContext = createContext<ReadContextValue | null>(null)

function computeSignature(config: SettingsHeaderConfig | null): string {
  if (config === null) return 'released'
  return JSON.stringify({
    title: config.title ?? '',
    description: config.description ?? '',
    docsLink: config.docsLink ?? '',
    back: config.back ? [config.back.text, config.back.icon ? 1 : 0] : null,
    actions: config.actions?.map((action) => [
      action.text,
      // `id` participates in ordering, so a config that changes only the id
      // must still re-render — the sort key cannot be wider than the signature.
      action.id ?? '',
      action.textTone ?? '',
      action.variant ?? '',
      action.active ?? false,
      action.disabled ?? false,
      action.icon ? 1 : 0,
      action.tooltip ?? '',
      action.onPrefetch ? 1 : 0,
    ]),
    search: config.search
      ? [config.search.value, config.search.placeholder ?? '', config.search.disabled ?? false]
      : null,
  })
}

export function SettingsHeaderProvider({ children }: { children: ReactNode }) {
  const configRef = useRef<SettingsHeaderConfig | null>(null)
  const [signature, setSignature] = useState('')

  const register = useCallback((config: SettingsHeaderConfig | null) => {
    configRef.current = config
    const next = computeSignature(config)
    setSignature((previous) => (previous === next ? previous : next))
  }, [])

  const readValue = useMemo<ReadContextValue>(() => ({ configRef, signature }), [signature])

  return (
    <RegisterContext.Provider value={register}>
      <ReadContext.Provider value={readValue}>{children}</ReadContext.Provider>
    </RegisterContext.Provider>
  )
}

export function useSettingsHeader(config: SettingsHeaderConfig) {
  const register = useContext(RegisterContext)

  /**
   * A layout effect, not a passive one, and load-bearing for that reason: on a section swap
   * the shell renders before the outgoing body's cleanup runs, so `configRef` still holds the
   * previous section's config during that render. Flushing the release synchronously before
   * paint is what stops the previous section's title showing for a frame. Downgrading this to
   * `useEffect` reintroduces that flicker.
   */
  useIsomorphicLayoutEffect(() => {
    register?.(config)
  })

  useIsomorphicLayoutEffect(() => {
    return () => register?.(null)
  }, [register])
}

interface SettingsActionChipProps {
  /** Presentation fields plus the default `onSelect` / `onPrefetch` handlers. */
  action: SettingsAction
  /** Overrides `action.onSelect` — the header shell passes a ref-reading indirection to avoid stale closures. */
  onSelect?: () => void
  /** Overrides `action.onPrefetch`, same reason. */
  onPrefetch?: () => void
}

/**
 * The one chip rendering of a {@link SettingsAction}. Both header stacks render
 * through this, so an action's chrome — tone, icon, variant, disabled, tooltip —
 * is identical wherever it is mounted. Container spacing still belongs to the
 * enclosing shell.
 */
export function SettingsActionChip({
  action,
  onSelect = action.onSelect,
  onPrefetch = action.onPrefetch,
}: SettingsActionChipProps) {
  const chip = (
    <Chip
      variant={action.variant}
      active={action.active}
      leftIcon={action.icon}
      onClick={onSelect}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      disabled={action.disabled}
      // A disabled <button> is not a hit-test target, so the tooltip's wrapping
      // span would never see pointerenter and the explanation would never show.
      className={cn(action.tooltip && action.disabled && 'pointer-events-none')}
    >
      {action.textTone === 'error' ? (
        <span className='text-[var(--text-error)]'>{action.text}</span>
      ) : (
        action.text
      )}
    </Chip>
  )
  if (!action.tooltip) return chip
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className='inline-flex'>{chip}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>{action.tooltip}</Tooltip.Content>
    </Tooltip.Root>
  )
}

/**
 * Renders a {@link SettingsAction} list as chips using each action's own
 * handlers. This is the data path for headers that take a `ReactNode`
 * (`CredentialDetailLayout`) — reach for it instead of hand-rolling `Chip`s, so
 * those surfaces keep the same chrome as the settings shell. The shell itself
 * maps through {@link SettingsActionChip} directly, since it must route every
 * handler through a ref to avoid stale closures.
 */
export function SettingsActionChips({ actions }: { actions: SettingsAction[] }) {
  return (
    <>
      {orderHeaderActions(actions).map(({ action }) => (
        <SettingsActionChip key={action.id ?? action.text} action={action} />
      ))}
    </>
  )
}

/**
 * Every header reads left→right as
 * `[secondary actions] → [Delete] → [Discard] → [Save]`.
 *
 * Delete is placed by its `id`, not by where the caller happened to put it, so a
 * page with no primary action still can't leave a destructive chip in the slot a
 * primary would occupy.
 *
 * The shell enforces it rather than trusting callsites, because the natural way
 * to write the array — spreading {@link saveDiscardActions} first, then adding a
 * Delete — produces the opposite order and puts a destructive chip to the right
 * of the primary one. Ranking is stable, so an action's position within its own
 * band is still the caller's to choose.
 *
 * Pairs each action with its ORIGINAL index: the shell dereferences
 * `actions[index]` on a live ref to dodge stale closures, so a reordered render
 * must not renumber them.
 */
export function orderHeaderActions(
  actions: SettingsAction[] | undefined
): { action: SettingsAction; index: number }[] {
  const rank = (action: SettingsAction) => {
    if (action.variant === 'primary') return 3
    if (action.id === 'discard') return 2
    if (action.id === 'delete') return 1
    return 0
  }
  return (actions ?? [])
    .map((action, index) => ({ action, index }))
    .sort((a, b) => rank(a.action) - rank(b.action))
}

interface SettingsHeaderShellProps {
  /**
   * The routed section's static header identity. Owns the heading whenever no section body
   * has registered one — on the route's first frame, while a lazily-loaded section chunk is
   * still in flight, and across the gap where an outgoing body has already reset the config.
   * Without it the heading blanks and re-fills on every section switch.
   */
  meta?: SettingsHeaderMeta | null
  children: ReactNode
}

export function SettingsHeaderShell({ meta, children }: SettingsHeaderShellProps) {
  const read = useContext(ReadContext)
  const configRef = read?.configRef
  const registered = configRef?.current ?? null
  /**
   * Meta fills in only while no body owns the header. Substituted wholesale rather than
   * field-by-field: a body that registers an explicit `title` and no `description` is
   * deliberately suppressing the meta description, so the two must never be merged — and a
   * body that registers an empty config is deliberately asking for no heading at all, which
   * is how a surface that renders its own heading opts out.
   */
  const config: SettingsHeaderConfig = registered ?? meta ?? EMPTY_CONFIG
  const { title, description, docsLink, back, actions, search, scrollContainerRef } = config

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div
        className={cn(
          PAGE_HEADER_BAR,
          'justify-between',
          !back && COLLAPSED_DESKTOP_TOP_LEVEL_INSET
        )}
      >
        {back ? (
          <Chip leftIcon={back.icon} onClick={() => configRef?.current?.back?.onSelect()}>
            {back.text}
          </Chip>
        ) : (
          <div />
        )}
        <div className={HEADER_ACTION_CLUSTER}>
          {docsLink && (
            <ChipLink href={docsLink} target='_blank' rel='noopener noreferrer'>
              Docs
            </ChipLink>
          )}
          {orderHeaderActions(actions).map(({ action, index }) => (
            <SettingsActionChip
              key={action.id ?? action.text}
              action={action}
              onSelect={() => configRef?.current?.actions?.[index]?.onSelect()}
              onPrefetch={
                action.onPrefetch
                  ? () => configRef?.current?.actions?.[index]?.onPrefetch?.()
                  : undefined
              }
            />
          ))}
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div className='mx-auto flex w-full max-w-[48rem] flex-col gap-7 pb-6'>
          {(title || description) && (
            <div className='flex flex-col gap-1'>
              {title && <h1 className='text-[var(--text-body)] text-lg'>{title}</h1>}
              {description && <p className='text-[var(--text-muted)] text-md'>{description}</p>}
            </div>
          )}
          {search && (
            <ChipInput
              icon={Search}
              placeholder={search.placeholder ?? 'Search...'}
              value={search.value}
              onChange={(event) => configRef?.current?.search?.onChange(event.target.value)}
              disabled={search.disabled}
              autoComplete='off'
              className='w-full'
            />
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
