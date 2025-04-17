import {
  FunctionSquare,
  Database,
  Image,
  Table2,
  Eye,
  Bot,
  MessageSquare,
  Workflow,
  PlayCircle,
  Code,
} from 'lucide-react'

export const formatBlockName = (name: string): string => {
  // Remove underscores and convert to title case
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/([0-9]+)/, ' $1') // Add space before numbers
}

export const getBlockIcon = (blockType: string) => {
  const iconMap = {
    function: FunctionSquare,
    mem0: Database,
    image_generator: Image,
    google_sheets: Table2,
    vision: Eye,
    agent: Bot,
    chat: MessageSquare,
    workflow: Workflow,
    starter: PlayCircle,
    code: Code,
  }

  return iconMap[blockType.toLowerCase() as keyof typeof iconMap] || Code
} 