// import { useState } from 'react'
// import { Trash2, Edit, ExternalLink } from 'lucide-react'
// import { useAgentStorage, Agent } from '../hooks/useAgentStorage'
// import { Button } from '@/components/ui/button'
// import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
// import { formatDistanceToNow } from 'date-fns'
// import { TestMCPConnection } from './TestMCPConnection'

// export function SavedAgentsList() {
//   const { agents, deleteAgent } = useAgentStorage()
//   const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)

//   if (agents.length === 0) {
//     return (
//       <div className="text-center py-12 border border-dashed rounded-md bg-muted/10">
//         <p className="text-muted-foreground mb-2">No agents created yet</p>
//         <p className="text-sm text-muted-foreground">Click "Create New Agent" to get started</p>
//       </div>
//     )
//   }

//   const toggleExpand = (agentId: string) => {
//     setExpandedAgentId(expandedAgentId === agentId ? null : agentId)
//   }

//   return (
//     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
//       {agents.map(agent => (
//         <Card key={agent.id} className="overflow-hidden">
//           <CardHeader className="pb-2">
//             <div className="flex justify-between items-start">
//               <CardTitle className="text-lg font-medium truncate">{agent.name}</CardTitle>
//               <div className="flex gap-1">
//                 <Button variant="ghost" size="icon" className="h-8 w-8">
//                   <Edit className="h-4 w-4" />
//                 </Button>
//                 <Button 
//                   variant="ghost" 
//                   size="icon" 
//                   className="h-8 w-8 text-destructive hover:text-destructive/90"
//                   onClick={() => deleteAgent(agent.id)}
//                 >
//                   <Trash2 className="h-4 w-4" />
//                 </Button>
//               </div>
//             </div>
//             <CardDescription className="text-xs">
//               Created {formatDistanceToNow(agent.createdAt, { addSuffix: true })}
//             </CardDescription>
//           </CardHeader>
          
//           <CardContent className="pb-2">
//             <div className="space-y-2">
//               <div>
//                 <h4 className="text-xs font-medium text-muted-foreground mb-1">Prompt</h4>
//                 <p className={`text-sm ${expandedAgentId === agent.id ? '' : 'line-clamp-2'}`}>
//                   {agent.prompt}
//                 </p>
//                 {agent.prompt.length > 100 && (
//                   <button 
//                     className="text-xs text-primary mt-1" 
//                     onClick={() => toggleExpand(agent.id)}
//                   >
//                     {expandedAgentId === agent.id ? 'Show less' : 'Show more'}
//                   </button>
//                 )}
//               </div>
              
//               <div>
//                 <h4 className="text-xs font-medium text-muted-foreground mb-1">MCP Servers</h4>
//                 <ul className="text-sm space-y-1">
//                   {agent.mcpServers.map((server, index) => (
//                     <li key={index} className="flex flex-col gap-1 mb-2">
//                       <div className="flex items-center gap-1">
//                         <span className="w-2 h-2 rounded-full bg-green-500"></span>
//                         <span className="truncate">{server.url}</span>
//                       </div>
//                       <TestMCPConnection url={server.url} />
//                     </li>
//                   ))}
//                 </ul>
//               </div>
//             </div>
//           </CardContent>
          
//           <CardFooter className="pt-2">
//             <Button size="sm" variant="outline" className="w-full text-sm gap-1">
//               <ExternalLink className="h-3.5 w-3.5" />
//               Use Agent
//             </Button>
//           </CardFooter>
//         </Card>
//       ))}
//     </div>
//   )
// } 