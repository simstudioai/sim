'use client'

import type { ComponentProps } from 'react'
import { ChipSelect } from '@sim/emcn'
import type { APIPageClientOptions } from 'fumadocs-openapi/ui/client'

type FumadocsAPIExampleSelector = NonNullable<
  NonNullable<APIPageClientOptions['operation']>['APIExampleSelector']
>

interface APIExampleSelectorProps extends ComponentProps<FumadocsAPIExampleSelector> {}

export function APIExampleSelector({ items, value, onValueChange }: APIExampleSelectorProps) {
  if (items.length <= 1) return null

  const selectedValue = value ?? items[0].id
  const selectedItem = items.find((item) => item.id === selectedValue)

  return (
    <div className='not-prose mb-2 flex flex-col gap-1.5'>
      <ChipSelect
        modal={false}
        aria-label={`Request example: ${selectedItem?.name ?? selectedValue}`}
        value={selectedValue}
        onChange={onValueChange}
        options={items.map((item) => ({ value: item.id, label: item.name }))}
        fullWidth
        align='start'
        dropdownWidth='trigger'
      />
      {selectedItem?.description && (
        <p className='text-[var(--text-muted)] text-caption'>{selectedItem.description}</p>
      )}
    </div>
  )
}
