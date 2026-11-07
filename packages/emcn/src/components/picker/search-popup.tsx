'use client'

import { type ReactNode, useRef } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import picker from '#emcn/components/picker/picker.module.css'
import { LoadMoreFooter } from '#emcn/components/scroll-area/load-more-footer'
import type { LoadMoreState } from '#emcn/components/scroll-area/use-load-more'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { MenuSearchField } from '#emcn/components/search-field/menu-search-field'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

export type PickerOption =
  | string
  | { value: string; label: string; disabled?: boolean; disabledReason?: string }

/** Hand searching to the caller: `options` becomes the current server result, unfiltered. */
export interface PickerServerSearch extends LoadMoreState {
  query: string
  onQueryChange: (query: string) => void
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
  /** Size the popup for its rows instead of matching its trigger's width. */
  detached?: boolean
  children?: ReactNode
}

/** The floating part of a searchable picker. Must sit inside a `Combobox.Root`. */
export function SearchPopup({
  label,
  searchLabel,
  container,
  search,
  detached,
  children,
}: SearchPopupProps) {
  const input = useRef<HTMLInputElement>(null)
  const queryEdges = useScrollEdges('horizontal', { viewport: input })
  const scrollRef = useScrollEdges<HTMLDivElement>()
  return (
    <Combobox.Portal container={container}>
      <Combobox.Positioner
        align='start'
        positionMethod='fixed'
        sideOffset={8}
        className={detached ? `${popup.positioner} ${picker.detachedPopup}` : popup.anchorWidth}
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
            {search?.loading || search?.error ? null : 'No matches'}
          </Combobox.Empty>
          <Combobox.List ref={scrollRef} aria-label={label} className={popup.list}>
            <Combobox.Collection>
              {(option: PickerOption) => {
                const disabled = typeof option === 'string' ? undefined : option.disabled
                const reason = typeof option === 'string' ? undefined : option.disabledReason
                const item = (
                  <Combobox.Item
                    key={optionKeys.getValue(option)}
                    value={optionKeys.getValue(option)}
                    disabled={disabled}
                    className={popup.item}
                    data-type='T060'
                  >
                    <span className={popup.label}>{optionKeys.getLabel(option)}</span>
                    <Combobox.ItemIndicator className={popup.indicator}>
                      <Icon name='I072' />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )
                return disabled && reason ? (
                  <Tooltip key={optionKeys.getValue(option)} label={reason}>
                    {item}
                  </Tooltip>
                ) : (
                  item
                )
              }}
            </Combobox.Collection>
            {search && <LoadMoreFooter state={search} />}
          </Combobox.List>
          {children}
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  )
}
