'use client'

import type { ComponentProps } from 'react'
import { useId } from 'react'
import {
  ChipChevronDown,
  chipFieldSurfaceClass,
  chipFieldTextClass,
  chipGeometryClass,
  chipHoverSurfaceClass,
  cn,
} from '@sim/emcn'
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
          /**
           * Dressed as an emcn chip trigger, but kept a native `select` for the keyboard and
           * screen-reader behavior a custom listbox would have to rebuild.
           */
          className={cn(
            chipGeometryClass,
            chipFieldSurfaceClass,
            chipFieldTextClass,
            chipHoverSurfaceClass,
            'w-full appearance-none pe-8'
          )}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <ChipChevronDown className='-translate-y-1/2 pointer-events-none absolute end-2 top-1/2' />
      </div>
      {selectedItem?.description && (
        <p className='text-[var(--text-muted)] text-caption'>{selectedItem.description}</p>
      )}
    </div>
  )
}
