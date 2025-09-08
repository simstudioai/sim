'use client'

import { GithubIcon } from '@/components/icons'

interface ChatHeaderProps {
  chatConfig: {
    title?: string
    customizations?: {
      headerText?: string
      logoUrl?: string
      imageUrl?: string
      primaryColor?: string
    }
  } | null
  starCount: string
}

export function ChatHeader({ chatConfig, starCount }: ChatHeaderProps) {
  const primaryColor = chatConfig?.customizations?.primaryColor || 'var(--brand-primary-hex)'
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl

  return (
    <div className='flex items-center justify-between bg-background/95 px-6 py-4 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-8 md:pt-4'>
      <div className='flex items-center gap-4'>
        {customImage && (
          <img
            src={customImage}
            alt={`${chatConfig?.title || 'Chat'} logo`}
            className='h-8 w-8 rounded-md object-cover'
          />
        )}
        <h2 className='font-medium text-foreground text-lg'>
          {chatConfig?.customizations?.headerText || chatConfig?.title || 'Chat'}
        </h2>
      </div>
      <div className='flex items-center gap-2'>
        <a
          href='https://github.com/simstudioai/sim'
          className='flex items-center gap-1 text-foreground'
          aria-label='GitHub'
          target='_blank'
          rel='noopener noreferrer'
        >
          <GithubIcon className='h-5 w-5' />
          <span className='hidden font-medium text-sm sm:inline-block'>{starCount}</span>
        </a>
        <a
          href='https://sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center rounded-md p-1 text-foreground/80 transition-colors duration-200 hover:text-foreground/100'
        >
          <div
            className='flex h-7 w-7 items-center justify-center rounded-md'
            style={{ backgroundColor: primaryColor }}
          >
            <svg
              width='16'
              height='16'
              viewBox='0 0 50 50'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z'
                fill={primaryColor}
                stroke='white'
                strokeWidth='3.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z'
                fill={primaryColor}
                stroke='white'
                strokeWidth='4'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398'
                stroke='white'
                strokeWidth='4'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <circle cx='25' cy='11' r='2' fill={primaryColor} />
            </svg>
          </div>
        </a>
      </div>
    </div>
  )
}
