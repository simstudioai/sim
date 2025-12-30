import { Input } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import type { EnvVarDropdownConfig } from '../types'

interface FormattedInputProps {
  ref?: React.RefObject<HTMLInputElement | null>
  placeholder: string
  value: string
  scrollLeft: number
  showEnvVars: boolean
  envVarProps: EnvVarDropdownConfig
  className?: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onScroll: (scrollLeft: number) => void
}

export function FormattedInput({
  ref,
  placeholder,
  value,
  scrollLeft,
  showEnvVars,
  envVarProps,
  className,
  onChange,
  onScroll,
}: FormattedInputProps) {
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    onScroll(e.currentTarget.scrollLeft)
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        ref={ref}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        onInput={handleScroll}
        className='h-9 text-transparent caret-foreground placeholder:text-[var(--text-muted)]'
      />
      <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-[8px] py-[6px] font-medium font-sans text-sm'>
        <div className='whitespace-nowrap' style={{ transform: `translateX(-${scrollLeft}px)` }}>
          {formatDisplayText(value)}
        </div>
      </div>
      {showEnvVars && (
        <EnvVarDropdown
          visible={showEnvVars}
          onSelect={envVarProps.onSelect}
          searchTerm={envVarProps.searchTerm}
          inputValue={value}
          cursorPosition={envVarProps.cursorPosition}
          workspaceId={envVarProps.workspaceId}
          onClose={envVarProps.onClose}
          className='w-full'
          maxHeight='200px'
          style={{ position: 'absolute', top: '100%', left: 0, zIndex: 99999 }}
        />
      )}
    </div>
  )
}
