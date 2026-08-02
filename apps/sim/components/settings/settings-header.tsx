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
import { PAGE_HEADER_BAR } from '@/components/page-header-bar'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

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

const EMPTY_CONFIG: SettingsHeaderConfig = {}
const RegisterContext = createContext<((config: SettingsHeaderConfig) => void) | null>(null)

interface ReadContextValue {
  configRef: { current: SettingsHeaderConfig }
  signature: string
}

const ReadContext = createContext<ReadContextValue | null>(null)

function computeSignature(config: SettingsHeaderConfig): string {
  return JSON.stringify({
    title: config.title ?? '',
    description: config.description ?? '',
    docsLink: config.docsLink ?? '',
    back: config.back ? [config.back.text, config.back.icon ? 1 : 0] : null,
    actions: config.actions?.map((action) => [
      action.text,
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
  const configRef = useRef<SettingsHeaderConfig>(EMPTY_CONFIG)
  const [signature, setSignature] = useState('')

  const register = useCallback((config: SettingsHeaderConfig) => {
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

  useIsomorphicLayoutEffect(() => {
    register?.(config)
  })

  useIsomorphicLayoutEffect(() => {
    return () => register?.(EMPTY_CONFIG)
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
      {actions.map((action) => (
        <SettingsActionChip key={action.id ?? action.text} action={action} />
      ))}
    </>
  )
}

export function SettingsHeaderShell({ children }: { children: ReactNode }) {
  const read = useContext(ReadContext)
  const configRef = read?.configRef
  const config = configRef?.current ?? EMPTY_CONFIG
  const { title, description, docsLink, back, actions, search, scrollContainerRef } = config

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className={cn(PAGE_HEADER_BAR, 'justify-between')}>
        {back ? (
          <Chip leftIcon={back.icon} onClick={() => configRef?.current.back?.onSelect()}>
            {back.text}
          </Chip>
        ) : (
          <div />
        )}
        <div className='flex h-[30px] items-center gap-1'>
          {docsLink && (
            <ChipLink href={docsLink} target='_blank' rel='noopener noreferrer'>
              Docs
            </ChipLink>
          )}
          {actions?.map((action, index) => (
            <SettingsActionChip
              key={action.id ?? action.text}
              action={action}
              onSelect={() => configRef?.current.actions?.[index]?.onSelect()}
              onPrefetch={
                action.onPrefetch
                  ? () => configRef?.current.actions?.[index]?.onPrefetch?.()
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
              {title && <h1 className='font-medium text-[var(--text-body)] text-lg'>{title}</h1>}
              {description && <p className='text-[var(--text-muted)] text-md'>{description}</p>}
            </div>
          )}
          {search && (
            <ChipInput
              icon={Search}
              placeholder={search.placeholder ?? 'Search...'}
              value={search.value}
              onChange={(event) => configRef?.current.search?.onChange(event.target.value)}
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
