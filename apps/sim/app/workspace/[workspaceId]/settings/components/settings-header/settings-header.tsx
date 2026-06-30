'use client'

import {
  type ComponentType,
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chip, ChipInput, ChipLink, Search } from '@sim/emcn'

/** The strict contract for a settings header action — rendered as a {@link Chip}, data only. */
export interface SettingsAction {
  text: string
  icon?: ComponentType<{ className?: string }>
  variant?: 'primary' | 'destructive'
  active?: boolean
  onSelect: () => void
  disabled?: boolean
}

export interface SettingsHeaderSearch {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

/** Left-aligned back chip for a detail sub-view, returning to the section's list. */
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
  /** Forwarded to the scroll region (e.g. for programmatic scroll-to-bottom). */
  scrollContainerRef?: Ref<HTMLDivElement>
  /** Escape hatch for a right-aligned widget that genuinely cannot be a chip. */
  aside?: ReactNode
}

const EMPTY_CONFIG: SettingsHeaderConfig = {}

const RegisterContext = createContext<((config: SettingsHeaderConfig) => void) | null>(null)

interface ReadContextValue {
  configRef: { current: SettingsHeaderConfig }
  signature: string
}

const ReadContext = createContext<ReadContextValue | null>(null)

/** Visible/structural fields only — callbacks stay in the ref, so registering never loops or serves a stale handler. */
function computeSignature(c: SettingsHeaderConfig): string {
  return JSON.stringify({
    t: c.title ?? '',
    d: c.description ?? '',
    k: c.docsLink ?? '',
    b: c.back ? [c.back.text, c.back.icon ? 1 : 0] : null,
    a: c.actions?.map((x) => [
      x.text,
      x.variant ?? '',
      x.active ?? false,
      x.disabled ?? false,
      x.icon ? 1 : 0,
    ]),
    s: c.search ? [c.search.value, c.search.placeholder ?? '', c.search.disabled ?? false] : null,
    aside: c.aside ? 1 : 0,
  })
}

export function SettingsHeaderProvider({ children }: { children: ReactNode }) {
  const configRef = useRef<SettingsHeaderConfig>(EMPTY_CONFIG)
  const [signature, setSignature] = useState('')

  const register = useCallback((config: SettingsHeaderConfig) => {
    configRef.current = config
    const next = computeSignature(config)
    setSignature((prev) => (prev === next ? prev : next))
  }, [])

  const readValue = useMemo<ReadContextValue>(() => ({ configRef, signature }), [signature])

  return (
    <RegisterContext.Provider value={register}>
      <ReadContext.Provider value={readValue}>{children}</ReadContext.Provider>
    </RegisterContext.Provider>
  )
}

/** Registers a section's header content into the persistent settings chrome. */
export function useSettingsHeader(config: SettingsHeaderConfig) {
  const register = useContext(RegisterContext)

  useEffect(() => {
    register?.(config)
  })

  useEffect(() => {
    return () => register?.(EMPTY_CONFIG)
  }, [register])
}

/**
 * The single owner of settings page chrome: the header bar (back chip, Docs link,
 * action chips, `aside`), the scroll region, and the centered column led by the
 * title + description, then search and `{children}`.
 */
export function SettingsHeaderShell({ children }: { children: ReactNode }) {
  const read = useContext(ReadContext)
  const config = read?.configRef.current ?? EMPTY_CONFIG
  const { title, description, docsLink, back, actions, search, aside, scrollContainerRef } = config

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        {back ? (
          <Chip leftIcon={back.icon} onClick={back.onSelect}>
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
          {aside}
          {actions?.map((action) => (
            <Chip
              key={action.text}
              variant={action.variant}
              active={action.active}
              leftIcon={action.icon}
              onClick={action.onSelect}
              disabled={action.disabled}
            >
              {action.text}
            </Chip>
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
              onChange={(event) => search.onChange(event.target.value)}
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
