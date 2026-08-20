import {
  IconAdjustmentsBolt,
  IconCloud,
  IconEaseInOut,
  IconHeart,
  IconHelp,
  IconHistory,
  IconRouteAltLeft,
  IconTerminal2,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'

export function Features() {
  const features = [
    {
      title: 'Multi-LLM Support',
      description: 'Connect to any LLM provider including OpenAI, Anthropic, and more',
      icon: <IconCloud />,
    },
    {
      title: 'API Deployment',
      description: 'Deploy your workflows as secure, scalable APIs',
      icon: <IconTerminal2 />,
    },
    {
      title: 'Webhook Integration',
      description: 'Trigger workflows via webhooks from external services',
      icon: <IconRouteAltLeft />,
    },
    {
      title: 'Scheduled Execution',
      description: 'Schedule workflows to run at specific times or intervals',
      icon: <IconEaseInOut />,
    },
    {
      title: '40+ Integrations',
      description: 'Connect to hundreds of external services and data sources',
      icon: <IconAdjustmentsBolt />,
    },
    {
      title: 'Visual Debugging',
      description: 'Debug workflows visually with detailed execution logs',
      icon: <IconHelp />,
    },
    {
      title: 'Version Control',
      description: 'Track changes and roll back to previous versions',
      icon: <IconHistory />,
    },
    {
      title: 'Team Collaboration',
      description: 'Collaborate with team members on workflow development',
      icon: <IconHeart />,
    },
  ]
  return (
    <div className='relative z-20 mx-auto grid max-w-7xl grid-cols-1 py-10 md:grid-cols-2 lg:grid-cols-4'>
      {features.map((feature, index) => (
        <Feature key={feature.title} {...feature} index={index} />
      ))}
    </div>
  )
}

export const Feature = ({
  title,
  description,
  icon,
  index,
}: {
  title: string
  description: string
  icon: React.ReactNode
  index: number
}) => {
  return (
    <div
      className={cn(
        'group/feature relative flex flex-col py-5 lg:border-r dark:border-neutral-800',
        (index === 0 || index === 4) && 'lg:border-l dark:border-neutral-800',
        index < 4 && 'lg:border-b dark:border-neutral-800'
      )}
    >
      {index < 4 && (
        <div className='pointer-events-none absolute inset-0 h-full w-full bg-gradient-to-t from-neutral-100 to-transparent opacity-0 transition duration-200 group-hover/feature:opacity-100 dark:from-neutral-800' />
      )}
      {index >= 4 && (
        <div className='pointer-events-none absolute inset-0 h-full w-full bg-gradient-to-b from-neutral-100 to-transparent opacity-0 transition duration-200 group-hover/feature:opacity-100 dark:from-neutral-800' />
      )}
      <div className='relative z-10 mb-4 px-10 text-neutral-600 dark:text-neutral-400'>{icon}</div>
      <div className='relative z-10 mb-2 px-10 font-bold text-lg'>
        <div className='absolute inset-y-0 left-0 h-6 w-1 origin-center rounded-tr-full rounded-br-full bg-neutral-300 transition-all duration-200 group-hover/feature:h-8 group-hover/feature:bg-purple-500 dark:bg-neutral-700' />
        <span className='inline-block text-neutral-800 transition duration-200 group-hover/feature:translate-x-2 dark:text-neutral-100'>
          {title}
        </span>
      </div>
      <p className='relative z-10 max-w-xs px-10 text-neutral-600 text-sm dark:text-neutral-300'>
        {description}
      </p>
    </div>
  )
}
