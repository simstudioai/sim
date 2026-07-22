import { ChipLink, cn } from '@sim/emcn'

interface SettingsUnavailableProps {
  title?: string
  description?: string
  embedded?: boolean
}

export function SettingsUnavailable({
  title = 'Settings unavailable',
  description = 'You do not have access to manage this organization. Contact an organization owner or admin for help.',
  embedded = false,
}: SettingsUnavailableProps) {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-center bg-[var(--surface-1)] p-6',
        embedded ? 'h-full' : 'desktop-title-bar-page-height'
      )}
    >
      <div className='flex max-w-md flex-col items-center gap-3 text-center'>
        <h1 className='font-medium text-[var(--text-body)] text-lg'>{title}</h1>
        <p className='text-[var(--text-muted)] text-sm'>{description}</p>
        <ChipLink href='/workspace'>Back to workspaces</ChipLink>
      </div>
    </div>
  )
}
