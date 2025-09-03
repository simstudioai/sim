import { Label } from '@/components/ui'
import { getBaseDomain, getEmailDomain } from '@/lib/urls/utils'

interface ExistingChat {
  id: string
  subdomain: string
  title: string
  description: string
  authType: 'public' | 'password' | 'email'
  allowedEmails: string[]
  outputConfigs: Array<{ blockId: string; path: string }>
  customizations?: {
    welcomeMessage?: string
  }
  isActive: boolean
}

interface SuccessViewProps {
  deployedUrl: string
  existingChat: ExistingChat | null
  onDelete?: () => void
  onUpdate?: () => void
}

export function SuccessView({ deployedUrl, existingChat, onDelete, onUpdate }: SuccessViewProps) {
  const url = new URL(deployedUrl)
  const hostname = url.hostname
  const isDevelopmentUrl = hostname.includes('localhost')

  let domainSuffix
  if (isDevelopmentUrl) {
    const baseDomain = getBaseDomain()
    const baseHost = baseDomain.split(':')[0]
    const port = url.port || (baseDomain.includes(':') ? baseDomain.split(':')[1] : '3000')
    domainSuffix = `.${baseHost}:${port}`
  } else {
    domainSuffix = `.${getEmailDomain()}`
  }

  const baseDomainForSplit = getEmailDomain()
  const subdomainPart = isDevelopmentUrl
    ? hostname.split('.')[0]
    : hostname.split(`.${baseDomainForSplit}`)[0]

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label className='font-medium text-sm'>
          Chat {existingChat ? 'Update' : 'Deployment'} Successful
        </Label>
        <div className='relative flex items-center rounded-md ring-offset-background'>
          <a
            href={deployedUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='flex h-10 flex-1 items-center break-all rounded-l-md border border-r-0 p-2 font-medium text-foreground text-sm'
          >
            {subdomainPart}
          </a>
          <div className='flex h-10 items-center whitespace-nowrap rounded-r-md border border-l-0 bg-muted px-3 font-medium text-muted-foreground text-sm'>
            {domainSuffix}
          </div>
        </div>
        <p className='text-muted-foreground text-xs'>
          Your chat is now live at{' '}
          <a
            href={deployedUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='text-foreground hover:underline'
          >
            this URL
          </a>
        </p>
      </div>

      {/* Hidden triggers for modal footer buttons */}
      <button type='button' data-delete-trigger onClick={onDelete} style={{ display: 'none' }} />
      <button type='button' data-update-trigger onClick={onUpdate} style={{ display: 'none' }} />
    </div>
  )
}
