"use client"
import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RepeatIcon, Search, UserIcon } from 'lucide-react'
import Image from 'next/image'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui'
import Link from 'next/link'

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
    <div className='border-t border-border flex justify-center items-center px-4 sm:px-8 md:px-12 lg:px-40'>
      <div className='w-full h-full flex flex-col p-6 sm:p-8 md:p-12 gap-10 border-l border-r border-border'>
        <p className='text-3xl font-medium leading-none text-foreground'>
            From the community
        </p>
        <div className='flex flex-col gap-8'>
            <div className='flex flex-col sm:flex-row justify-between sm:items-center gap-4 sm:gap-0'>
                {/* Category Selector */}
                <div className='flex items-center gap-1'>
                  {CATEGORIES.map((category) => (
                    <Button
                      key={category.id}
                      variant={selectedCategory === category.id ? 'secondary' : 'ghost'}
                      onClick={() => setSelectedCategory(category.id)}
                      className={`h-10 px-4 rounded-[10px] text-sm ${
                        selectedCategory === category.id ? '' : 'text-muted-foreground'
                      }`}
                    >
                      {category.label}
                    </Button>
                  ))}
                </div>
                {/* Search Bar */}
                <div className='relative'>
                  <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    placeholder='Search templates...'
                    className='h-10 w-full sm:w-80 pl-10 shadow-sm pr-4 bg-background border-border rounded-[10px]'
                  />
                </div>
            </div>
            <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6'>
                {/* Template Cards (mobile initially shows 4; Load more reveals the rest) */}
                {TEMPLATES.map((template, idx) => (
                  <div key={template.name} className={`${idx >= 4 && !showAllMobile ? 'hidden sm:block' : ''}`}>
                    <TemplateCard {...template} />
                  </div>
                ))}
            </div>
            {!showAllMobile ? (
              <div className='sm:hidden flex justify-center'>
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
  image: string,
  name: string,
  link: string,
  author: string,
  authorAvatar: string,
  usage: number,
}

const TemplateCard = ({ image, name, link, author, authorAvatar, usage }: TemplateCardProps) => {
  return (
    <Link href={link} target='_blank' className='flex flex-col w-full gap-4'>
      <div className="w-full bg-secondary rounded-[10px] max-h-[200px]">
        <Image src={image} alt={name} width={1000} height={1000} className='w-full h-full object-cover' />
      </div>
      <div className='flex gap-3 items-center'>
        <Avatar>
          <AvatarImage src={authorAvatar} />
          <AvatarFallback>{author.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className='flex flex-col gap-1'>
          <p className='text-sm font-medium leading-none text-foreground'>{author}</p>
          <div className='flex gap-1 items-center'>
            <div className='flex gap-1 items-center'>
              <UserIcon className='w-3 h-3 text-muted-foreground' />
              <p className='text-xs text-muted-foreground'>{author} uses</p>
            </div>
            <div className='flex gap-1 items-center'>
              <RepeatIcon className='w-3 h-3 text-muted-foreground' />
              <p className='text-xs text-muted-foreground'>{usage} remixes</p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default Templates
