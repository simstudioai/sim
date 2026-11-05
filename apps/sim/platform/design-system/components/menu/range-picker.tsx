import { ChoiceMenu } from '@/platform/design-system/components/menu/choice-menu'

interface RangePickerProps {
  label: string
  options: readonly string[]
  value?: string
  defaultValue?: string
  defaultOpen?: boolean
  onValueChange?: (value: string) => void
}

export function RangePicker({
  label,
  options,
  value,
  defaultValue,
  defaultOpen,
  onValueChange,
}: RangePickerProps) {
  return (
    <ChoiceMenu
      label={label}
      options={options.map((label) => ({ label, value: label }))}
      value={value}
      defaultValue={defaultValue}
      defaultOpen={defaultOpen}
      onValueChange={onValueChange}
    />
  )
}
