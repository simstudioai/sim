'use client'

import type { ComponentProps } from 'react'
import { useId } from 'react'
import { ChevronDown } from '@sim/emcn/icons'
import type { APIPageClientOptions } from 'fumadocs-openapi/ui/client'

type FumadocsAPIExampleSelector = NonNullable<
  NonNullable<APIPageClientOptions['operation']>['APIExampleSelector']
>

interface APIExampleSelectorProps extends ComponentProps<FumadocsAPIExampleSelector> {}

export function APIExampleSelector({ items, value, onValueChange }: APIExampleSelectorProps) {
  const id = useId()

  if (items.length <= 1) return null

  const selectedValue = value ?? items[0].id
  const selectedItem = items.find((item) => item.id === selectedValue)

  return (
    <div className='not-prose mb-2 flex flex-col gap-1.5'>
      <label htmlFor={id} className='sr-only'>
        Request example
      </label>
      <div className='relative'>
        <select
          id={id}
          value={selectedValue}
          onChange={(event) => onValueChange(event.target.value)}
          className='w-full appearance-none rounded-md border bg-fd-secondary py-2 ps-3 pe-9 text-start font-medium text-fd-secondary-foreground text-sm outline-none transition-colors hover:bg-fd-accent focus-visible:ring-2 focus-visible:ring-fd-ring'
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <ChevronDown className='-translate-y-1/2 pointer-events-none absolute end-3 top-1/2 size-[14px] text-fd-muted-foreground' />
      </div>
      {selectedItem?.description && (
        <p className='text-fd-muted-foreground text-xs'>{selectedItem.description}</p>
      )}
    </div>
  )
}
