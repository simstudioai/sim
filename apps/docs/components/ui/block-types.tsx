import {
  AgentIcon,
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
  ResponseIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'

// Custom Feature component specifically for BlockTypes to handle the 6-item layout
const BlockFeature = ({
  title,
  description,
  icon,
  href,
  index,
  totalItems,
  itemsPerRow,
}: {
  title: string
  description: string
  icon: React.ReactNode
  href?: string
  index: number
  totalItems: number
  itemsPerRow: number
}) => {
  const blockColor = {
    '--block-color':
      title === 'Agent'
        ? '#8b5cf6'
        : title === 'API'
          ? '#3b82f6'
          : title === 'Condition'
            ? '#f59e0b'
            : title === 'Function'
              ? '#10b981'
              : title === 'Router'
                ? '#6366f1'
                : title === 'Evaluator'
                  ? '#ef4444'
                  : '#8b5cf6',
  } as React.CSSProperties

  const content = (
    <>
      {index < itemsPerRow && (
        <div className='pointer-events-none absolute inset-0 h-full w-full bg-gradient-to-t from-neutral-100 to-transparent opacity-0 transition duration-200 group-hover/feature:opacity-100 dark:from-neutral-800' />
      )}
      {index >= itemsPerRow && (
        <div className='pointer-events-none absolute inset-0 h-full w-full bg-gradient-to-b from-neutral-100 to-transparent opacity-0 transition duration-200 group-hover/feature:opacity-100 dark:from-neutral-800' />
      )}
      <div
        className='relative z-10 mb-4 px-10 text-neutral-500 transition-colors duration-200 group-hover/feature:text-[color:var(--block-color,#8b5cf6)] dark:text-neutral-400 dark:group-hover/feature:text-[color:var(--block-color,#a78bfa)]'
        style={blockColor}
      >
        {icon}
      </div>
      <div className='relative z-10 mb-2 px-10 font-bold text-lg'>
        <div
          className='absolute inset-y-0 left-0 h-6 w-1 origin-center rounded-tr-full rounded-br-full bg-neutral-300 transition-all duration-200 group-hover/feature:h-8 group-hover/feature:bg-[color:var(--block-color,#8b5cf6)] dark:bg-neutral-700'
          style={blockColor}
        />
        <span className='inline-block text-neutral-800 transition duration-200 group-hover/feature:translate-x-2 dark:text-neutral-100'>
          {title}
        </span>
      </div>
      <p className='relative z-10 max-w-xs px-10 text-neutral-600 text-sm dark:text-neutral-300'>
        {description}
      </p>
    </>
  )

  const containerClasses = cn(
    'flex flex-col lg:border-r py-5 relative group/feature dark:border-neutral-800',
    (index === 0 || index === itemsPerRow) && 'lg:border-l dark:border-neutral-800',
    index < itemsPerRow && 'lg:border-b dark:border-neutral-800',
    href && 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors'
  )

  if (href) {
    return (
      <a href={href} className={containerClasses} style={{ textDecoration: 'none' }}>
        {content}
      </a>
    )
  }

  return <div className={containerClasses}>{content}</div>
}

export function BlockTypes() {
  const features = [
    {
      title: 'Agent',
      description:
        'Create powerful AI agents using any LLM provider with customizable system prompts and tool integrations.',
      icon: <AgentIcon className='h-6 w-6' />,
      href: '/blocks/agent',
    },
    {
      title: 'API',
      description:
        'Connect to any external API with support for all standard HTTP methods and customizable request parameters.',
      icon: <ApiIcon className='h-6 w-6' />,
      href: '/blocks/api',
    },
    {
      title: 'Condition',
      description:
        'Add a condition to the workflow to branch the execution path based on a boolean expression.',
      icon: <ConditionalIcon className='h-6 w-6' />,
      href: '/blocks/condition',
    },
    {
      title: 'Function',
      description:
        'Execute custom JavaScript or TypeScript code within your workflow to transform data or implement complex logic.',
      icon: <CodeIcon className='h-6 w-6' />,
      href: '/blocks/function',
    },
    {
      title: 'Router',
      description:
        'Intelligently direct workflow execution to different paths based on input analysis.',
      icon: <ConnectIcon className='h-6 w-6' />,
      href: '/blocks/router',
    },
    {
      title: 'Evaluator',
      description:
        'Assess content using customizable evaluation metrics and scoring criteria across multiple dimensions.',
      icon: <ChartBarIcon className='h-6 w-6' />,
      href: '/blocks/evaluator',
    },
    {
      title: 'Response',
      description:
        'Send a response back to the caller with customizable data, status, and headers.',
      icon: <ResponseIcon className='h-6 w-6' />,
      href: '/blocks/response',
    },
  ]

  const totalItems = features.length
  const itemsPerRow = 3 // For large screens

  return (
    <div className='relative z-10 mx-auto grid max-w-7xl grid-cols-1 py-10 md:grid-cols-2 lg:grid-cols-3'>
      {features.map((feature, index) => (
        <BlockFeature
          key={feature.title}
          {...feature}
          index={index}
          totalItems={totalItems}
          itemsPerRow={itemsPerRow}
        />
      ))}
    </div>
  )
}
