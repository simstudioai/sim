import type { ReactNode } from 'react'
import { MessageSquareText, TerminalWindow, Workflow } from '@sim/emcn/icons'
import { Card } from '@/components/ui/cards'
import { Image } from '@/components/ui/image'

const BUILD_PATH_ICONS = {
  chat: MessageSquareText,
  workflow: Workflow,
  api: TerminalWindow,
} as const
interface IntroductionHeroProps {
  alt: string
}
interface IntroductionLinkProps {
  href: string
  title: string
  icon: keyof typeof BUILD_PATH_ICONS
  children: ReactNode
}

export function IntroductionHero({ alt }: IntroductionHeroProps) {
  return (
    <Image
      src='/static/introduction/platform.webp'
      alt={alt}
      width={2400}
      height={1200}
      variant='hero'
      preload
    />
  )
}

export function IntroductionLink({ href, title, icon, children }: IntroductionLinkProps) {
  const Icon = BUILD_PATH_ICONS[icon]
  return (
    <Card href={href} title={title} icon={<Icon />}>
      {children}
    </Card>
  )
}
