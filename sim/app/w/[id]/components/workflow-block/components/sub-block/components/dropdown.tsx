import { useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface DropdownProps {
  options:
    | Array<string | { label: string; id: string }>
    | (() => Array<string | { label: string; id: string }>)
  defaultValue?: string
  blockId: string
  subBlockId: string
}

export function Dropdown({ options, defaultValue, blockId, subBlockId }: DropdownProps) {
  const [value, setValue] = useSubBlockValue<string>(blockId, subBlockId, true)

  // Evaluate options if it's a function
  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

  const getOptionValue = (option: string | { label: string; id: string }) => {
    return typeof option === 'string' ? option : option.id
  }

  const getOptionLabel = (option: string | { label: string; id: string }) => {
    return typeof option === 'string' ? option : option.label
  }

  // Calculate the effective value to use in the dropdown
  // Priority: 1. Stored value (value) > 2. Provided defaultValue > 3. First option
  const effectiveValue = useMemo(() => {
    // If we have a value from the store, use that
    if (value !== null && value !== undefined) {
      return value
    }

    // Fall back to provided defaultValue
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Last resort: use first option value if available
    if (evaluatedOptions.length > 0) {
      return getOptionValue(evaluatedOptions[0])
    }

    // No valid value available
    return undefined
  }, [value, defaultValue, evaluatedOptions])

  // Handle the case where evaluatedOptions changes and the current selection is no longer valid
  const isValueInOptions = useMemo(() => {
    if (!effectiveValue || evaluatedOptions.length === 0) return false
    return evaluatedOptions.some((opt) => getOptionValue(opt) === effectiveValue)
  }, [effectiveValue, evaluatedOptions])

  return (
    <Select
      value={isValueInOptions ? effectiveValue : undefined}
      onValueChange={(newValue) => setValue(newValue)}
    >
      <SelectTrigger className="text-left">
        <SelectValue placeholder="Select an option" />
      </SelectTrigger>
      <SelectContent className="max-h-48">
        {evaluatedOptions.map((option) => (
          <SelectItem key={getOptionValue(option)} value={getOptionValue(option)}>
            {getOptionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
