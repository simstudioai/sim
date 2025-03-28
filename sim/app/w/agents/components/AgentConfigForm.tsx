import { useEffect, useRef } from 'react';
import { useCoAgent } from '@copilotkit/react-core';
import { MCPConfigForm } from './MCPConfigForm';
import { useAgentContext, ServerConfig } from '../hooks/useAgentContext';

// Wrapper component for MCPConfigForm to work with agent context
export function AgentConfigForm() {
  const { getCurrentAgent, updateAgentConfig } = useAgentContext();
  const currentAgent = getCurrentAgent();
  
  // Use a ref to track and compare config changes
  const configRef = useRef(currentAgent.config || {});
  
  // Initialize agent state
  const { state: agentState, setState: setAgentState } = useCoAgent<{
    mcp_config: Record<string, ServerConfig>;
  }>({
    name: `agent_${currentAgent.id}`,
    initialState: {
      mcp_config: currentAgent.config || {},
    },
  });

  // When agent ID changes, update the agent state with the new agent's config
  useEffect(() => {
    // Only update if different from current state
    const currentConfig = currentAgent.config || {};
    const stateConfig = agentState?.mcp_config || {};
    
    // Deep comparison to avoid unnecessary updates
    if (JSON.stringify(currentConfig) !== JSON.stringify(stateConfig)) {
      setAgentState({
        mcp_config: currentConfig
      });
      configRef.current = currentConfig;
    }
  }, [currentAgent.id]);

  // Update agent context when MCPConfigForm changes the state
  useEffect(() => {
    if (!agentState?.mcp_config) return;
    
    // Only update if the config has actually changed
    if (JSON.stringify(configRef.current) !== JSON.stringify(agentState.mcp_config)) {
      updateAgentConfig(currentAgent.id, agentState.mcp_config);
      configRef.current = agentState.mcp_config;
    }
  }, [agentState?.mcp_config]);

  return (
    <div className="h-full overflow-auto">
      <MCPConfigForm agentName={`agent_${currentAgent.id}`} />
    </div>
  );
} 