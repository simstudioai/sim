import { DiscordIcon, GithubIcon, LinkedInIcon, xIcon as XIcon } from '@/components/icons'

export default function SocialLinks() {
  return (
    <div className='flex items-center gap-[12px]'>
      <a
        href='https://discord.gg/Hr4UWYEcTT'
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        aria-label='Discord'
      >
        <DiscordIcon className='h-[20px] w-[20px]' aria-hidden='true' />
      </a>
      <a
        href='https://x.com/simdotai'
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        aria-label='X (Twitter)'
      >
        <XIcon className='h-[18px] w-[18px]' aria-hidden='true' />
      </a>
      <a
        href='https://www.linkedin.com/company/simstudioai/'
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        aria-label='LinkedIn'
      >
        <LinkedInIcon className='h-[18px] w-[18px]' aria-hidden='true' />
      </a>
      <a
        href='https://github.com/simstudioai/sim'
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        aria-label='GitHub'
      >
        <GithubIcon className='h-[20px] w-[20px]' aria-hidden='true' />
      </a>
    </div>
  )
}
