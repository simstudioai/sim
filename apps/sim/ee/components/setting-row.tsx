import { Label } from '@/components/emcn'

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Label className='text-[13px] text-[var(--text-primary)]'>{label}</Label>
      {description && <p className='text-[12px] text-[var(--text-muted)]'>{description}</p>}
      {children}
    </div>
  )
}
