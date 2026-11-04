'use client'

import { useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import styles from '@/platform/design-system/components/components.module.css'
import { FieldFrame } from '@/platform/design-system/components/fields'
import { Icon } from '@/platform/design-system/components/icon'
import { usePopoverContainer } from '@/platform/design-system/components/use-popover-container'

interface SearchableSelectProps {
  label: string
  options: readonly string[]
  defaultValue: string
  searchLabel: string
  createLabel?: string
  onCreate?: () => void
}

export function SearchableSelect({
  label,
  options,
  defaultValue,
  searchLabel,
  createLabel,
  onCreate,
}: SearchableSelectProps) {
  const id = useId()
  const { trigger, container } = usePopoverContainer()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(defaultValue)
  const matches = options.filter((option) =>
    option.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <FieldFrame id={id} label={label}>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <Popover.Trigger
          ref={trigger}
          id={id}
          type='button'
          className={styles.selectTrigger}
          data-type='T043'
          aria-label={`${label}, ${selected}`}
        >
          {selected}
          <Icon name='I051' />
        </Popover.Trigger>
        {container && (
          <Popover.Portal container={container}>
            <Popover.Content
              className={styles.selectMenu}
              aria-label={label}
              align='start'
              data-material='floating'
              data-elevation='menu'
            >
              <div className={styles.search}>
                <Icon name='I089' />
                <input
                  aria-label={searchLabel}
                  placeholder={searchLabel}
                  value={query}
                  data-type='T060'
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {matches.map((option) => (
                <Popover.Close
                  key={option}
                  className={styles.option}
                  data-type='T060'
                  aria-pressed={selected === option}
                  onClick={() => setSelected(option)}
                >
                  {option}
                  {selected === option && <Icon name='I072' />}
                </Popover.Close>
              ))}
              {matches.length === 0 && (
                <p role='status' className={styles.noResults} data-type='T060'>
                  No matches
                </p>
              )}
              {createLabel && (
                <>
                  <hr className={styles.rule} />
                  <Popover.Close
                    className={styles.createOption}
                    data-type='T060'
                    onClick={onCreate}
                  >
                    <Icon name='I074' />
                    {createLabel}
                  </Popover.Close>
                </>
              )}
            </Popover.Content>
          </Popover.Portal>
        )}
      </Popover.Root>
    </FieldFrame>
  )
}
