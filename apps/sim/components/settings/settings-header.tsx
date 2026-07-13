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
import { Chip, ChipInput, ChipLink, Search, Tooltip } from '@sim/emcn'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface SettingsAction {
  text: string
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

export function SettingsHeaderShell({ children }: { children: ReactNode }) {
  const read = useContext(ReadContext)
  const configRef = read?.configRef
  const config = configRef?.current ?? EMPTY_CONFIG
  const { title, description, docsLink, back, actions, search, scrollContainerRef } = config

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
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
          {actions?.map((action, index) => {
            const chip = (
              <Chip
                key={action.text}
                variant={action.variant}
                active={action.active}
                leftIcon={action.icon}
                onClick={() => configRef?.current.actions?.[index]?.onSelect()}
                onMouseEnter={
                  action.onPrefetch
                    ? () => configRef?.current.actions?.[index]?.onPrefetch?.()
                    : undefined
                }
                onFocus={
                  action.onPrefetch
                    ? () => configRef?.current.actions?.[index]?.onPrefetch?.()
                    : undefined
                }
                disabled={action.disabled}
              >
                {action.text}
              </Chip>
            )
            return action.tooltip ? (
              <Tooltip.Root key={action.text}>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>{chip}</span>
                </Tooltip.Trigger>
                <Tooltip.Content>{action.tooltip}</Tooltip.Content>
              </Tooltip.Root>
            ) : (
              chip
            )
          })}
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
