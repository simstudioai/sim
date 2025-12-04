import { X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { FormattedInput } from '../formatted-input/formatted-input'
import type { EnvVarDropdownConfig, HeaderEntry, InputFieldType } from '../types'

interface HeaderRowProps {
  header: HeaderEntry
  index: number
  headerScrollLeft: Record<string, number>
  showEnvVars: boolean
  activeInputField: InputFieldType | null
  activeHeaderIndex: number | null
  envSearchTerm: string
  cursorPosition: number
  workspaceId: string
  onInputChange: (field: InputFieldType, value: string, index?: number) => void
  onHeaderScroll: (key: string, scrollLeft: number) => void
  onEnvVarSelect: (value: string) => void
  onEnvVarClose: () => void
  onRemove: () => void
}

export function HeaderRow({
  header,
  index,
  headerScrollLeft,
  showEnvVars,
  activeInputField,
  activeHeaderIndex,
  envSearchTerm,
  cursorPosition,
  workspaceId,
  onInputChange,
  onHeaderScroll,
  onEnvVarSelect,
  onEnvVarClose,
  onRemove,
}: HeaderRowProps) {
  const isKeyActive =
    showEnvVars && activeInputField === 'header-key' && activeHeaderIndex === index
  const isValueActive =
    showEnvVars && activeInputField === 'header-value' && activeHeaderIndex === index

  const envVarProps: EnvVarDropdownConfig = {
    searchTerm: envSearchTerm,
    cursorPosition,
    workspaceId,
    onSelect: onEnvVarSelect,
    onClose: onEnvVarClose,
  }

  return (
    <div className='relative flex items-center gap-[8px]'>
      <FormattedInput
        placeholder='Name'
        value={header.key || ''}
        scrollLeft={headerScrollLeft[`key-${index}`] || 0}
        showEnvVars={isKeyActive}
        envVarProps={envVarProps}
        className='flex-1'
        onChange={(e) => onInputChange('header-key', e.target.value, index)}
        onScroll={(scrollLeft) => onHeaderScroll(`key-${index}`, scrollLeft)}
      />

      <FormattedInput
        placeholder='Value'
        value={header.value || ''}
        scrollLeft={headerScrollLeft[`value-${index}`] || 0}
        showEnvVars={isValueActive}
        envVarProps={envVarProps}
        className='flex-1'
        onChange={(e) => onInputChange('header-value', e.target.value, index)}
        onScroll={(scrollLeft) => onHeaderScroll(`value-${index}`, scrollLeft)}
      />

      <Button type='button' variant='ghost' onClick={onRemove} className='h-6 w-6 shrink-0 p-0'>
        <X className='h-3 w-3' />
      </Button>
    </div>
  )
}
