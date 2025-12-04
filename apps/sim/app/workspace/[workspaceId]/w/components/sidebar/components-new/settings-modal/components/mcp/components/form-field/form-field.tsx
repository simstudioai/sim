import { Label } from '@/components/emcn'

interface FormFieldProps {
  label: string
  children: React.ReactNode
}

export function FormField({ label, children }: FormFieldProps) {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <Label className='w-[100px] shrink-0 font-medium text-[13px] text-[var(--text-secondary)]'>
        {label}
      </Label>
      <div className='relative flex-1'>{children}</div>
    </div>
  )
}
