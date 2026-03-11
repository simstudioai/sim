import type { OptionItem } from '../../../../types'

interface OptionsProps {
  items: OptionItem[]
  onSelect?: (id: string) => void
}

export function Options({ items, onSelect }: OptionsProps) {
  if (items.length === 0) return null

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((item) => (
        <button
          key={item.id}
          type='button'
          onClick={() => onSelect?.(item.id)}
          className='rounded-full border border-[var(--divider)] bg-[var(--bg)] px-3.5 py-1.5 font-[430] font-[family-name:var(--font-inter)] text-[14px] text-[var(--text-primary)] leading-5 transition-colors hover:bg-[var(--surface-5)]'
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
