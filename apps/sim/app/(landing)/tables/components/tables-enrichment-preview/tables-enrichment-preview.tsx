'use client'

import {
  Badge,
  Button,
  ChipCombobox,
  ChipInput,
  CollapsibleCard,
  FieldDivider,
  Label,
  OverflowText,
  Switch,
} from '@sim/emcn'
import { ArrowLeft, X } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'

const OUTPUTS = ['employee count', 'description'] as const
const DOMAIN_COLUMN = [{ label: 'Domain', value: 'domain' }]

/** The shipped Company Info enrichment's native input and output configuration. */
export function TablesEnrichmentPreview() {
  return (
    <div className='-translate-x-1/2 absolute top-12 left-1/2 w-[360px] max-w-[calc(100%_-_48px)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs max-sm:top-8'>
      <div className='flex min-h-[48px] items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <Button
            variant='ghost'
            size='sm'
            className='size-7 flex-none p-1!'
            aria-label='Back to enrichments'
          >
            <ArrowLeft className='size-[14px]' />
          </Button>
          <OverflowText label='Company Info' className='text-[var(--text-primary)] text-small' />
        </div>
        <Button variant='ghost' size='sm' className='size-7 flex-none p-1!' aria-label='Close'>
          <X className='size-[14px]' />
        </Button>
      </div>
      <div className='px-2 pt-3 pb-2'>
        <div className='flex flex-col gap-[9.5px]'>
          <Label className='pl-0.5'>Inputs</Label>
          <CollapsibleCard
            title='Company domain *'
            badge={
              <Badge variant='type' size='sm'>
                string
              </Badge>
            }
            collapsed={false}
            onToggleCollapse={noop}
          >
            <Label className='text-small'>Column</Label>
            <ChipCombobox
              className='w-full'
              options={DOMAIN_COLUMN}
              value='domain'
              onChange={noop}
              searchable
              searchPlaceholder='Search columns…'
              dropdownWidth='trigger'
            />
          </CollapsibleCard>
        </div>
        <FieldDivider />
        <div className='flex flex-col gap-[9.5px]'>
          <Label className='pl-0.5'>Output columns</Label>
          <div className='flex flex-col gap-2'>
            {OUTPUTS.map((name) => (
              <CollapsibleCard
                key={name}
                title={name}
                badge={
                  <Badge variant='type' size='sm'>
                    string
                  </Badge>
                }
                collapsed={false}
                onToggleCollapse={noop}
              >
                <Label className='text-small'>Column name</Label>
                <ChipInput value={name} readOnly />
              </CollapsibleCard>
            ))}
          </div>
        </div>
        <FieldDivider />
        <div className='flex items-center justify-between pl-0.5'>
          <Label>Auto-run</Label>
          <Switch checked={false} aria-label='Auto-run' />
        </div>
      </div>
    </div>
  )
}
