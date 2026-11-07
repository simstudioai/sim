'use client'

import { type ReactNode, useMemo } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '#emcn/components/menu/use-popover-container'
import picker from '#emcn/components/picker/picker.module.css'
import type { PickerServerSearch } from '#emcn/components/picker/search-popup'
import { LoadMoreFooter } from '#emcn/components/scroll-area/load-more-footer'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'

interface SearchComboboxOption {
  value: string
  label: string
  /** Lines under the label that tell results with the same label apart. */
  details?: readonly string[]
  leading?: ReactNode
}

const OPTION_KEYS = {
  getValue: (option: SearchComboboxOption) => option.value,
  getLabel: (option: SearchComboboxOption) => option.label,
}

interface SearchComboboxProps {
  label: string
  placeholder: string
  /** Names the results above the list. */
  heading: string
  emptyLabel: string
  /** What Enter does to the highlighted result, in the keyboard hints. */
  enterHint: string
  options: readonly SearchComboboxOption[]
  search: PickerServerSearch
  onSelect: (value: string) => void
  /** Lets a caller read its options only once the viewer asks for them. */
  onOpenChange?: (open: boolean) => void
}

/** A search field that stays on the page, with its server results in a popup under it. */
export function SearchCombobox({
  label,
  placeholder,
  heading,
  emptyLabel,
  enterHint,
  options,
  search,
  onSelect,
  onOpenChange,
}: SearchComboboxProps) {
  const { trigger, container, opener } = usePopoverContainer()
  const scrollRef = useScrollEdges<HTMLDivElement>()
  const items = useMemo(() => Combobox.createItems(options, OPTION_KEYS), [options])
  return (
    <Combobox.Root
      items={items}
      value={null}
      filter={null}
      inputValue={search.query}
      onInputValueChange={(query, details) => {
        if (details.reason !== 'item-press') search.onQueryChange(query)
      }}
      onOpenChange={onOpenChange}
      onValueChange={(next) => {
        if (!next) return
        search.onQueryChange('')
        onSelect(next)
      }}
      autoHighlight
      modal={false}
    >
      <div ref={trigger} className={picker.searchField}>
        <Icon name='I089' />
        <Combobox.Input aria-label={label} placeholder={placeholder} data-type='T043' />
      </div>
      {container && (
        <Combobox.Portal container={container}>
          <Combobox.Positioner
            anchor={opener}
            align='start'
            positionMethod='fixed'
            sideOffset={8}
            className={`${popup.positioner} ${picker.detachedPopup}`}
          >
            <Combobox.Popup className={popup.popup} data-material='floating' data-elevation='menu'>
              <span className={popup.heading} data-type='T050'>
                {heading}
              </span>
              <Combobox.Empty className={picker.empty} data-type='T060'>
                {search.loading || search.error ? null : emptyLabel}
              </Combobox.Empty>
              <Combobox.List
                ref={scrollRef}
                aria-label={label}
                className={`${popup.list} ${picker.results}`}
              >
                <Combobox.Collection>
                  {(option: SearchComboboxOption) => (
                    <Combobox.Item
                      key={option.value}
                      value={option.value}
                      className={`${popup.item} ${picker.result}`}
                    >
                      {option.leading}
                      <span className={picker.resultCopy}>
                        <span data-type='T042'>{option.label}</span>
                        {option.details?.map((detail) => (
                          <span key={detail} className={picker.resultDetail} data-type='T050'>
                            {detail}
                          </span>
                        ))}
                      </span>
                      <span className={picker.resultEnter} aria-hidden='true' data-type='T050'>
                        ↵
                      </span>
                    </Combobox.Item>
                  )}
                </Combobox.Collection>
                <LoadMoreFooter state={search} />
              </Combobox.List>
              <div className={picker.hints} aria-hidden='true' data-type='T050'>
                <span>↑↓ Navigate</span>
                <span>{enterHint}</span>
                <span>Esc to close</span>
              </div>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      )}
    </Combobox.Root>
  )
}
