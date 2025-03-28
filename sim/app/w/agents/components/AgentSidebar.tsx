import { useState } from 'react';
import { useAgentContext } from '../hooks/useAgentContext';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { CreateAgentModal } from './CreateAgentModal';

export function AgentSidebar() {
  const { agents, currentAgentId, setCurrentAgentId, deleteAgent, isLoading, error, createAgent } = useAgentContext();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);


  return (
    <>
      <div className="w-64 border-r border-white/10 bg-background">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Agents</h3>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="p-1.5 bg-white text-black rounded-md hover:bg-white/90 flex items-center text-xs"
            >
              <Plus size={14} className="mr-1" /> New
            </button>
          </div>
        </div>

        <div className="p-2">
          {isLoading && (
            <div className="flex items-center justify-center p-4 text-white/50">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span>Loading agents...</span>
            </div>
          )}

          {error && (
            <div className="p-3 text-red-400 text-sm bg-red-500/10 rounded-md mb-2">
              {error}
            </div>
          )}

          {!isLoading && !error && agents.map((agent) => (
            <div
              key={agent.id}
              className={`p-2 rounded-md mb-2 cursor-pointer ${
                currentAgentId === agent.id
                  ? 'bg-blue-500/20'
                  : 'hover:bg-white/5'
              }`}
              onClick={() => setCurrentAgentId(agent.id)}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{agent.name}</div>
                
                {!agent.isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAgent(agent.id);
                    }}
                    className="text-white/50 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              
              {agent.description && (
                <div className="text-xs text-white/50 mt-1">
                  {agent.description}
                </div>
              )}
              
              <div className="flex gap-2 mt-2 text-xs">
                <span className="bg-white/10 px-2 py-0.5 rounded">
                  {Object.values(agent.config || {}).filter(c => c.transport === 'sse').length} SSE
                </span>
                <span className="bg-white/10 px-2 py-0.5 rounded">
                  {Object.values(agent.config || {}).filter(c => c.transport === 'stdio').length} STDIO
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isCreateModalOpen && (
        <CreateAgentModal 
          isOpen={true} 
          onClose={() => setIsCreateModalOpen(false)} 
          createAgent={createAgent}
        />
      )}
    </>
  );
} 