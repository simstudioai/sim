import { memo } from 'react'
import { Handle, NodeProps, Position } from 'reactflow'
import { AgentIcon, ApiIcon, ConnectIcon } from '@/components/icons'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Textarea } from "@/components/ui/textarea"
import { 
  Info, 
  CodeXml, 
  Network, 
  Link2, // Icon for function chaining
  AlertTriangle, // Icon for error handling
  History, // Icon for real-time logging
  Settings2, // Icon for custom parameters
  DatabaseZap, // Icon for unified api
  BrainCircuit, // Icon for memory
  ScrollText, // Icon for format res
  Wrench, // Icon for tools
  Shuffle, // Icon for dynamic routing
  BrainCog, // Icon for model selection
  KeyRound, // Icon for api key management
  LineChart, // Icon for analytics
  GitBranch, // Icon for branches
  Bug, // Icon for debugging
  UserCheck, // Icon for human-in-the-loop
  ShieldAlert, // Icon for error recovery
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DotPattern } from './dot-pattern'

// Combine icons and feature labels
const featuresByType = {
  function: {
    icon: CodeXml,
    color: '#e11d48',
    labels: [
      { text: "function chaining", icon: Link2 },
      { text: "error handling", icon: AlertTriangle },
      { text: "real-time logging", icon: History },
      { text: "custom parameters", icon: Settings2 },
    ]
  },
  agent: {
    icon: AgentIcon,
    color: '#7c3aed',
    labels: [
      { text: "unified api", icon: DatabaseZap },
      { text: "memory", icon: BrainCircuit },
      { text: "format res", icon: ScrollText },
      { text: "tools", icon: Wrench },
    ]
  },
  router: {
    icon: ConnectIcon,
    color: '#16a34a',
    labels: [
      { text: "dynamic routing", icon: Shuffle },
      { text: "model selection", icon: BrainCog },
      { text: "api key management", icon: KeyRound },
      { text: "analytics", icon: LineChart },
    ]
  },
  workflow: {
    icon: Network,
    color: '#475569', // Adjusted grey color
    labels: [
      { text: "branches", icon: GitBranch },
      { text: "debugging", icon: Bug },
      { text: "human-in-the-loop", icon: UserCheck },
      { text: "error recovery", icon: ShieldAlert },
    ]
  },
}

export const HeroBlock = memo(({ data }: NodeProps) => {
  const type = data.type as keyof typeof featuresByType;
  const svgFilename = data.content as string; // Get SVG filename from data

  return (
    <div className="flex flex-col items-center group">
      <Card
        className={cn(
          'shadow-md select-none relative cursor-default bg-[#1f1f1f]/90 border border-neutral-700/80 backdrop-blur-sm rounded-lg opacity-40', // Adjusted bg, border, radius
          'transition-shadow duration-300 hover:shadow-lg hover:shadow-neutral-700/40'
        )}
      >
        {/* Left Handle - Adjusted style */}
        <Handle
          type="target"
          position={Position.Left}
          className={cn(
            '!w-2.5 !h-2.5 !bg-[#181818] !rounded-full !border-2 !border-neutral-600/80', // Adjusted size, bg, border
            'group-hover:!border-[#43a6ff]', '!cursor-crosshair', 'transition-colors duration-150',
            '!left-[-5px]' // Adjusted position
          )}
          isConnectable={false}
        />
        
        {/* Card Header - Changed to display SVG */}
        <CardHeader className="flex flex-row items-center justify-between gap-3 p-2.5 workflow-drag-handle cursor-grab active:cursor-grabbing">
           {/* Container for DotPattern and SVG */}
          <div className='w-80 h-48 overflow-hidden border border-[#262626] rounded-lg relative flex'> {/* Added flex center */}
            {/* Display SVG using img tag */}
            {svgFilename && (
              <img 
                src={`/svg/${svgFilename}`} 
                alt={`${type} illustration`} 
                className="relative z-10 w-full h-full object-cover object-left" // Ensure SVG is above pattern, add padding
              />
            )}
          </div>
        </CardHeader>

        {/* Card Content (Feature Labels) */}
        <CardContent className="w-full text-sm border-t px-0 py-0 border-[#262626]">
            <div className="grid grid-cols-2 grid-rows-2 w-full h-full text-neutral-500">
                {
                  featuresByType[type]?.labels.map((label, index) => (
                    <div key={index} className="w-full h-full flex items-center justify-center p-1 sm:p-2 gap-0.5 sm:gap-1 border-[0.5px] border-[#262626] text-neutral-500/70 font-geist-mono">
                      <label.icon className='w-3 h-3 sm:w-4 sm:h-4' />
                      <p className="text-[10px] sm:text-xs">{label.text}</p>
                    </div>
                  ))
                }
            </div>
        </CardContent>
        {/* Right Handle - Adjusted style */}
        <Handle
          type="source"
          position={Position.Right}
          className={cn(
             '!w-2.5 !h-2.5 !bg-[#181818] !rounded-full !border-2 !border-neutral-600/80', // Adjusted size, bg, border
            'group-hover:!border-[#43a6ff]', '!cursor-crosshair', 'transition-colors duration-150',
            '!right-[-5px]' // Adjusted position
          )}
           isConnectable={false}
        />
      </Card>
    </div>
  )
})

HeroBlock.displayName = 'HeroBlock'
