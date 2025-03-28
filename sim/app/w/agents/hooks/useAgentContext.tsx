import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { fetchAgents, createAgent as createAgentApi, updateAgent as updateAgentApi, deleteAgent as deleteAgentApi } from '../utils/agent-api';

// Types for our agent structure
export interface ServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  transport: 'stdio' | 'sse';
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  config: Record<string, ServerConfig>;
  isDefault?: boolean;
  createdAt: number;
  updatedAt?: number;
}

interface AgentContextType {
  agents: Agent[];
  currentAgentId: string;
  setCurrentAgentId: (id: string) => void;
  createAgent: (name: string, description?: string, initialConfig?: Record<string, ServerConfig>) => Promise<void>;
  updateAgentConfig: (agentId: string, config: Record<string, ServerConfig>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  getCurrentAgent: () => Agent;
  isLoading: boolean;
  error: string | null;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

const DEFAULT_AGENT: Agent = {
  id: 'default',
  name: 'Sim Bot',
  description: 'The default system agent',
  config: {},
  isDefault: true,
  createdAt: Date.now(),
};

export function AgentProvider({ children }: { children: ReactNode }) {
  // State for agents
  const [agents, setAgents] = useState<Agent[]>([DEFAULT_AGENT]);
  const [currentAgentId, setCurrentAgentId] = useState<string>(DEFAULT_AGENT.id);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [localAgents, setLocalAgents] = useLocalStorage<Agent[]>('custom-agents', []); // Just for backward compatibility

  // Fetch agents on component mount
  useEffect(() => {
    const getAgents = async () => {
      try {
        setIsLoading(true);
        const dbAgents = await fetchAgents();
        
        // If there are no saved agents in DB but we have local ones, migrate them
        if (dbAgents.length === 0 && localAgents.length > 0) {
          // Create the local agents in the database
          const savedAgents = await Promise.all(
            localAgents.map(async (agent) => {
              const { id, createdAt, ...rest } = agent;
              return await createAgentApi(rest);
            })
          );
          
          setAgents([DEFAULT_AGENT, ...savedAgents]);
          // Clear local storage since we've migrated the data
          setLocalAgents([]);
        } else {
          setAgents([DEFAULT_AGENT, ...dbAgents]);
        }
        
        setError(null);
      } catch (err) {
        console.error('Error fetching agents:', err);
        setError('Failed to load agents');
        // If API fails, fall back to local storage
        setAgents([DEFAULT_AGENT, ...localAgents]);
      } finally {
        setIsLoading(false);
      }
    };

    getAgents();
  }, []);

  const getCurrentAgent = () => {
    return agents.find(agent => agent.id === currentAgentId) || DEFAULT_AGENT;
  };

  const createAgent = async (name: string, description?: string, initialConfig: Record<string, ServerConfig> = {}) => {
    try {
      setIsLoading(true);
      const newAgent = await createAgentApi({
        name,
        description,
        config: initialConfig,
      });

      setAgents(prev => [...prev, newAgent]);
      setCurrentAgentId(newAgent.id);
      setError(null);
    } catch (err) {
      console.error('Error creating agent:', err);
      setError('Failed to create agent');
    } finally {
      setIsLoading(false);
    }
  };

  const updateAgentConfig = async (agentId: string, config: Record<string, ServerConfig>) => {
    if (agentId === DEFAULT_AGENT.id) {
      // For default agent, we just update it directly (it's not stored in DB)
      // Only update if config has actually changed
      if (JSON.stringify(DEFAULT_AGENT.config) !== JSON.stringify(config)) {
        DEFAULT_AGENT.config = config;
        setAgents([...agents]); // Force re-render
      }
      return;
    }

    try {
      setIsLoading(true);
      const agentToUpdate = agents.find(agent => agent.id === agentId);
      
      // If agent not found or config hasn't changed, don't update
      if (!agentToUpdate || JSON.stringify(agentToUpdate.config) === JSON.stringify(config)) {
        setIsLoading(false);
        return;
      }
      
      const updatedAgent = await updateAgentApi(agentId, { config });
      
      setAgents(prev => prev.map(agent => 
        agent.id === agentId ? updatedAgent : agent
      ));
      setError(null);
    } catch (err) {
      console.error('Error updating agent:', err);
      setError('Failed to update agent');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteAgent = async (id: string) => {
    if (id === DEFAULT_AGENT.id) {
      console.error("Cannot delete the default agent");
      return;
    }
    
    try {
      setIsLoading(true);
      await deleteAgentApi(id);
      
      setAgents(prev => prev.filter(agent => agent.id !== id));
      
      // If we deleted the currently selected agent, switch to the default agent
      if (id === currentAgentId) {
        setCurrentAgentId(DEFAULT_AGENT.id);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error deleting agent:', err);
      setError('Failed to delete agent');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AgentContext.Provider
      value={{
        agents,
        currentAgentId,
        setCurrentAgentId,
        createAgent,
        updateAgentConfig,
        deleteAgent,
        getCurrentAgent,
        isLoading,
        error,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgentContext() {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error('useAgentContext must be used within an AgentProvider');
  }
  return context;
} 