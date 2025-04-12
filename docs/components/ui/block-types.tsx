import { cn } from '@/lib/utils'
import { AgentIcon, ApiIcon, ChartBarIcon, CodeIcon, ConditionalIcon, ConnectIcon } from '../icons'

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
    '--block-color': title === 'Agent' ? '#8b5cf6' : 
                    title === 'API' ? '#3b82f6' : 
                    title === 'Condition' ? '#f59e0b' :
                    title === 'Function' ? '#10b981' :
                    title === 'Router' ? '#6366f1' :
                    title === 'Evaluator' ? '#ef4444' : '#8b5cf6'
  } as React.CSSProperties
  
  const content = (
    <>
      {index < itemsPerRow && (
        <div className="opacity-0 group-hover/feature:opacity-100 transition duration-200 absolute inset-0 h-full w-full bg-gradient-to-t from-neutral-100 dark:from-neutral-800 to-transparent pointer-events-none" />
      )}
      {index >= itemsPerRow && (
        <div className="opacity-0 group-hover/feature:opacity-100 transition duration-200 absolute inset-0 h-full w-full bg-gradient-to-b from-neutral-100 dark:from-neutral-800 to-transparent pointer-events-none" />
      )}
      <div className="mb-4 relative z-10 px-10 text-neutral-500 group-hover/feature:text-[color:var(--block-color,#8b5cf6)] dark:text-neutral-400 dark:group-hover/feature:text-[color:var(--block-color,#a78bfa)] transition-colors duration-200"
        style={blockColor}
      >
        {icon}
      </div>
      <div className="text-lg font-bold mb-2 relative z-10 px-10">
        <div className="absolute left-0 inset-y-0 h-6 group-hover/feature:h-8 w-1 rounded-tr-full rounded-br-full bg-neutral-300 dark:bg-neutral-700 group-hover/feature:bg-[color:var(--block-color,#8b5cf6)] transition-all duration-200 origin-center" style={blockColor} />
        <span className="group-hover/feature:translate-x-2 transition duration-200 inline-block text-neutral-800 dark:text-neutral-100">
          {title}
        </span>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300 max-w-xs relative z-10 px-10">
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
      icon: <AgentIcon className="w-6 h-6" />,
      href: '/blocks/agent',
    },
    {
      title: 'API',
      description:
        'Connect to any external API with support for all standard HTTP methods and customizable request parameters.',
      icon: <ApiIcon className="w-6 h-6" />,
      href: '/blocks/api',
    },
    {
      title: 'Condition',
      description:
        'Add a condition to the workflow to branch the execution path based on a boolean expression.',
      icon: <ConditionalIcon className="w-6 h-6" />,
      href: '/blocks/condition',
    },
    {
      title: 'Function',
      description:
        'Execute custom JavaScript or TypeScript code within your workflow to transform data or implement complex logic.',
      icon: <CodeIcon className="w-6 h-6" />,
      href: '/blocks/function',
    },
    {
      title: 'Router',
      description:
        'Intelligently direct workflow execution to different paths based on input analysis.',
      icon: <ConnectIcon className="w-6 h-6" />,
      href: '/blocks/router',
    },
    {
      title: 'Evaluator',
      description:
        'Assess content using customizable evaluation metrics and scoring criteria across multiple dimensions.',
      icon: <ChartBarIcon className="w-6 h-6" />,
      href: '/blocks/evaluator',
    },
  ]

  const totalItems = features.length
  const itemsPerRow = 3 // For large screens

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 relative z-10 py-10 max-w-7xl mx-auto">
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
