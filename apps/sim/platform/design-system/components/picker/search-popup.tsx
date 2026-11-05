'use client'

import { type ReactNode, useRef } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Icon } from '@/platform/design-system/components/icon/icon'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import picker from '@/platform/design-system/components/picker/picker.module.css'
import { LoadMoreFooter } from '@/platform/design-system/components/scroll-area/load-more-footer'
import type { LoadMoreState } from '@/platform/design-system/components/scroll-area/use-load-more'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { MenuSearchField } from '@/platform/design-system/components/search-field/menu-search-field'

export type PickerOption =
  | string
  | { value: string; label: string; leading?: ReactNode; disabled?: boolean }

/** Hand searching to the caller: `options` becomes the current server result, unfiltered. */
export interface PickerServerSearch extends LoadMoreState {
  query: string
  onQueryChange: (query: string) => void
  /** Replaces "No matches", for a list that may hold more than it has loaded. */
  emptyMessage?: string
  /** Beneath the list: a way to reach what paging has not, or a note that the list is partial. */
  footer?: ReactNode
}

export const optionKeys = {
  getValue: (option: PickerOption) => (typeof option === 'string' ? option : option.value),
  getLabel: (option: PickerOption) => (typeof option === 'string' ? option : option.label),
}

interface SearchPopupProps {
  label: string
  searchLabel: string
  container: HTMLElement
  search?: PickerServerSearch
  children?: ReactNode
}

/** The floating part of a searchable picker. Must sit inside a `Combobox.Root`. */
export function SearchPopup({ label, searchLabel, container, search, children }: SearchPopupProps) {
  const input = useRef<HTMLInputElement>(null)
  const queryEdges = useScrollEdges('horizontal', { viewport: input })
  const scrollRef = useScrollEdges<HTMLDivElement>()
  return (
    <Combobox.Portal container={container}>
      <Combobox.Positioner
        align='start'
        positionMethod='fixed'
        sideOffset={8}
        className={popup.anchorWidth}
      >
        <Combobox.Popup
          className={popup.popup}
          data-material='floating'
          data-elevation='menu'
          aria-label={label}
          initialFocus={input}
        >
          <MenuSearchField
            input={
              <Combobox.Input ref={queryEdges} aria-label={searchLabel} placeholder={searchLabel} />
            }
          />
          <Combobox.Empty className={picker.empty} data-type='T060'>
            {search?.loading || search?.error ? null : (search?.emptyMessage ?? 'No matches')}
          </Combobox.Empty>
          <Combobox.List ref={scrollRef} aria-label={label} className={popup.list}>
            <Combobox.Collection>
              {(option: PickerOption) => (
                <Combobox.Item
                  key={optionKeys.getValue(option)}
                  value={optionKeys.getValue(option)}
                  disabled={typeof option !== 'string' && option.disabled}
                  className={popup.item}
                  data-type='T060'
                >
                  {typeof option !== 'string' && option.leading}
                  <span className={popup.label}>{optionKeys.getLabel(option)}</span>
                  <Combobox.ItemIndicator className={popup.indicator}>
                    <Icon name='I072' />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.Collection>
            {search && <LoadMoreFooter state={search} />}
            {search?.footer}
          </Combobox.List>
          {children}
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  )
}
