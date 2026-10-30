'use client'

import { type ReactNode, useId, useState } from 'react'
import { cn } from '@/components/docs/classnames'
import { CodeContent } from '@/components/ui/code-block'
import { CopyButton } from '@/components/ui/copy-button'
import { Tab, Tabs, TabsList, TabsSelect, TabsTrigger } from '@/components/ui/tabs'

interface SamplePanelItem {
  value: string
  label: string
  panel: ReactNode
  copyText: string
  id?: string
  groupValue?: string
}

interface SamplePanelsProps {
  items: SamplePanelItem[]
  label: string
  presentation?: 'tabs' | 'select'
  defaultValue?: string
  className?: string
  groupId?: string
}

/** API requests and real response examples share one compact, copyable code surface. */
export function SamplePanels({
  items,
  label,
  presentation = 'tabs',
  defaultValue,
  className,
  groupId,
}: SamplePanelsProps) {
  const selectorId = useId()
  const [selected, setSelected] = useState(defaultValue ?? items[0]?.value ?? '')
  const current = items.find((item) => item.value === selected) ?? items[0]
  if (!current) return null

  return (
    <Tabs
      value={current.value}
      onValueChange={setSelected}
      groupId={groupId}
      groupValues={Object.fromEntries(
        items.map((item) => [item.value, item.groupValue ?? item.value])
      )}
      aria-label={label}
      className={cn('my-0 overflow-hidden rounded-lg bg-[var(--docs-surface)]', className)}
    >
      <div className='flex min-h-11 items-center gap-2 px-3'>
        <span id={selectorId} className='shrink-0 font-medium text-docs-control'>
          {label}
        </span>
        {presentation === 'tabs' ? (
          <TabsList aria-label={`${label} language`}>
            {items.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <TabsSelect label={`${label} example`} items={items} />
        )}
        <div className='ml-auto shrink-0'>
          <CopyButton text={current.copyText} label={`Copy ${label.toLowerCase()}`} />
        </div>
      </div>
      {items.map((item) => (
        <Tab
          key={item.value}
          value={item.value}
          label={item.label}
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
