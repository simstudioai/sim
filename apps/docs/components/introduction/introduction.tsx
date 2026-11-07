import type { ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import { Card } from '@sim/emcn-docs/cards'
import { Image } from '@/components/docs/image/image'
import platform from '@/public/static/introduction/platform.webp'

const BUILD_PATH_ICONS = {
  chat: 'I073',
  workflow: 'I118',
  api: 'I107',
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
  return <Image src={platform} alt={alt} width={2400} height={1200} variant='hero' preload />
}

export function IntroductionLink({ href, title, icon, children }: IntroductionLinkProps) {
  return (
    <Card href={href} title={title} icon={<Icon name={BUILD_PATH_ICONS[icon]} />}>
      {children}
    </Card>
  )
}
