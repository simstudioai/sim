import { Label } from '@/components/emcn'

interface FormFieldProps {
  label: string
  children: React.ReactNode
  optional?: boolean
}

export function FormField({ label, children, optional }: FormFieldProps) {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <Label className='w-[100px] shrink-0 font-medium text-[13px] text-[var(--text-secondary)]'>
        {label}
        {optional && (
          <span className='ml-1 font-normal text-[11px] text-[var(--text-muted)]'>(optional)</span>
        )}
      </Label>
      <div className='relative flex-1'>{children}</div>
    </div>
  )
}
