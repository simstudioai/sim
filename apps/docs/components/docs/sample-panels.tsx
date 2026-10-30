'use client'

import { type ReactNode, useId, useState } from 'react'
import { ChevronDown } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'
import { CodeContent } from '@/components/ui/code-block'
import { CopyButton } from '@/components/ui/copy-button'
import { Tab, Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface SamplePanelItem {
  value: string
  label: string
  panel: ReactNode
  copyText: string
  id?: string
}

interface SamplePanelsProps {
  items: SamplePanelItem[]
  label: string
  presentation?: 'tabs' | 'select'
  defaultValue?: string
  className?: string
}

/** API requests and real response examples share one compact, copyable code surface. */
export function SamplePanels({
  items,
  label,
  presentation = 'tabs',
  defaultValue,
  className,
}: SamplePanelsProps) {
  const selectorId = useId()
  const [selected, setSelected] = useState(defaultValue ?? items[0]?.value ?? '')
  const current = items.find((item) => item.value === selected) ?? items[0]
  if (!current) return null

  return (
    <Tabs
      value={current.value}
      onValueChange={setSelected}
      aria-label={label}
      className={cn('my-0 overflow-hidden rounded-lg bg-[var(--docs-surface)]', className)}
    >
      <div className='flex min-h-11 items-center gap-2 px-3'>
        <span className='shrink-0 font-medium text-docs-control'>{label}</span>
        {presentation === 'tabs' ? (
          <TabsList aria-label={`${label} language`}>
            {items.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <div className='relative min-w-0'>
            <select
              id={selectorId}
              value={current.value}
              onChange={(event) => setSelected(event.target.value)}
              aria-label={`${label} status`}
              aria-controls={current.id ?? `${selectorId}-${current.value}`}
              className='h-7 pointer-coarse:min-h-11 w-full cursor-pointer appearance-none rounded-lg bg-transparent py-1 pr-6 pl-2 text-docs-control hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2'
            >
              {items.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDown className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-1 size-4 text-[var(--docs-muted)]' />
          </div>
        )}
        <div className='ml-auto shrink-0'>
          <CopyButton text={current.copyText} label={`Copy ${label.toLowerCase()}`} />
        </div>
      </div>
      {items.map((item) => (
        <Tab
          key={item.value}
          value={item.value}
          id={item.id ?? `${selectorId}-${item.value}`}
          {...(presentation === 'select' ? { role: 'region', 'aria-labelledby': selectorId } : {})}
          className='[&>div]:pt-0'
        >
          <CodeContent label={`${label}: ${item.label}`}>{item.panel}</CodeContent>
        </Tab>
      ))}
    </Tabs>
  )
}
