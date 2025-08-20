'use client'
import React from 'react'
import { RepeatIcon, Search, UserIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CATEGORIES = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'research', label: 'Research' },
  { id: 'utilities', label: 'Utilities' },
]

function Templates() {
  const [selectedCategory, setSelectedCategory] = React.useState('recommended')
  const [showAllMobile, setShowAllMobile] = React.useState(false)

  return (
    <div className='flex items-center justify-center border-border border-t px-4 sm:px-8 md:px-12 lg:px-40'>
      <div className='flex h-full w-full flex-col gap-10 border-border border-r border-l p-6 sm:p-8 md:p-12'>
        <p className='font-medium text-3xl text-foreground leading-none'>From the community</p>
        <div className='flex flex-col gap-8'>
          <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-center sm:gap-0'>
            {/* Category Selector */}
            <div className='flex items-center gap-1'>
              {CATEGORIES.map((category) => (
                <Button
                  key={category.id}
                  variant={selectedCategory === category.id ? 'secondary' : 'ghost'}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`h-10 rounded-[10px] px-4 text-sm ${
                    selectedCategory === category.id ? '' : 'text-muted-foreground'
                  }`}
                >
                  {category.label}
                </Button>
              ))}
            </div>
            {/* Search Bar */}
            <div className='relative'>
              <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
              <Input
                placeholder='Search templates...'
                className='h-10 w-full rounded-[10px] border-border bg-background pr-4 pl-10 shadow-sm sm:w-80'
              />
            </div>
          </div>
          <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
            {/* Template Cards (mobile initially shows 4; Load more reveals the rest) */}
            {TEMPLATES.map((template, idx) => (
              <div
                key={template.name}
                className={`${idx >= 4 && !showAllMobile ? 'hidden sm:block' : ''}`}
              >
                <TemplateCard {...template} />
              </div>
            ))}
          </div>
          {!showAllMobile ? (
            <div className='flex justify-center sm:hidden'>
              <Button
                variant='secondary'
                className='rounded-[10px]'
                onClick={() => setShowAllMobile(true)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const TEMPLATES = [
  {
    image: '/static/templates/voice-agent.png',
    name: 'Voice Agent',
    link: '/template/voice-agent',
    author: 'Alice Johnson',
    authorAvatar: '/static/avatars/alice.png',
    usage: 120,
  },
  {
    image: '/static/templates/leadgen-bot.png',
    name: 'LeadGen Bot',
    link: '/template/leadgen-bot',
    author: 'Bob Smith',
    authorAvatar: '/static/avatars/bob.png',
    usage: 98,
  },
  {
    image: '/static/templates/gmail-automation.png',
    name: 'Gmail Automation',
    link: '/template/gmail-automation',
    author: 'Carol Lee',
    authorAvatar: '/static/avatars/carol.png',
    usage: 87,
  },
  {
    image: '/static/templates/slack-notifier.png',
    name: 'Slack Notifier',
    link: '/template/slack-notifier',
    author: 'David Kim',
    authorAvatar: '/static/avatars/david.png',
    usage: 76,
  },
  {
    image: '/static/templates/market-research.png',
    name: 'Market Researcher',
    link: '/template/market-research',
    author: 'Eva Green',
    authorAvatar: '/static/avatars/eva.png',
    usage: 65,
  },
  {
    image: '/static/templates/calendar-sync.png',
    name: 'Calendar Sync',
    link: '/template/calendar-sync',
    author: 'Frank Miller',
    authorAvatar: '/static/avatars/frank.png',
    usage: 54,
  },
  {
    image: '/static/templates/faq-bot.png',
    name: 'FAQ Bot',
    link: '/template/faq-bot',
    author: 'Grace Hopper',
    authorAvatar: '/static/avatars/grace.png',
    usage: 43,
  },
  {
    image: '/static/templates/seo-analyzer.png',
    name: 'SEO Analyzer',
    link: '/template/seo-analyzer',
    author: 'Henry Ford',
    authorAvatar: '/static/avatars/henry.png',
    usage: 32,
  },
  {
    image: '/static/templates/data-cleaner.png',
    name: 'Data Cleaner',
    link: '/template/data-cleaner',
    author: 'Ivy Chen',
    authorAvatar: '/static/avatars/ivy.png',
    usage: 21,
  },
  {
    image: '/static/templates/meeting-summarizer.png',
    name: 'Meeting Summarizer',
    link: '/template/meeting-summarizer',
    author: 'Jack Black',
    authorAvatar: '/static/avatars/jack.png',
    usage: 19,
  },
  {
    image: '/static/templates/social-media-scheduler.png',
    name: 'Social Media Scheduler',
    link: '/template/social-media-scheduler',
    author: 'Karen White',
    authorAvatar: '/static/avatars/karen.png',
    usage: 15,
  },
  {
    image: '/static/templates/translation-bot.png',
    name: 'Translation Bot',
    link: '/template/translation-bot',
    author: 'Leo Brown',
    authorAvatar: '/static/avatars/leo.png',
    usage: 12,
  },
]

type TemplateCardProps = {
  image: string
  name: string
  link: string
  author: string
  authorAvatar: string
  usage: number
}

const TemplateCard = ({ image, name, link, author, authorAvatar, usage }: TemplateCardProps) => {
  return (
    <Link href={link} target='_blank' className='flex w-full flex-col gap-4'>
      <div className='max-h-[200px] w-full rounded-[10px] bg-secondary'>
        <Image
          src={image}
          alt={name}
          width={1000}
          height={1000}
          className='h-full w-full object-cover'
        />
      </div>
      <div className='flex items-center gap-3'>
        <Avatar>
          <AvatarImage src={authorAvatar} />
          <AvatarFallback>{author.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className='flex flex-col gap-1'>
          <p className='font-medium text-foreground text-sm leading-none'>{author}</p>
          <div className='flex items-center gap-1'>
            <div className='flex items-center gap-1'>
              <UserIcon className='h-3 w-3 text-muted-foreground' />
              <p className='text-muted-foreground text-xs'>{author} uses</p>
            </div>
            <div className='flex items-center gap-1'>
              <RepeatIcon className='h-3 w-3 text-muted-foreground' />
              <p className='text-muted-foreground text-xs'>{usage} remixes</p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default Templates
