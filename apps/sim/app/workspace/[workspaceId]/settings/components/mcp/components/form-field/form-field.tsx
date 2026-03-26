import { Label } from '@/components/emcn'

interface FormFieldProps {
  label: string
  children: React.ReactNode
  optional?: boolean
}

export function FormField({ label, children, optional }: FormFieldProps) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <Label className='w-[100px] shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
        {label}
        {optional && (
          <span className='ml-1 font-normal text-[var(--text-muted)] text-xs'>(optional)</span>
        )}
      </Label>
      <div className='relative flex-1'>{children}</div>
    </div>
  )
}
