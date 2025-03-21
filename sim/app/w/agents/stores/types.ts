/**
 * Type Definitions for Agent Builder
 *
 * This module defines the TypeScript interfaces and types used throughout the Agent Builder:
 * - Data models for agents, MCP servers, and chat sessions
 * - State interfaces for Zustand stores
 * - Type definitions for UI state and actions
 * - Utility types for filtering and sorting
 *
 * @module AgentTypes
 */

export interface MCPServer {
  id: string
  name: string
  url: string
  apiKey?: string
  status: 'connected' | 'disconnected' | 'error'
  lastConnected?: string
}

export interface AgentConfig {
  id: string
  name: string
  description: string
  model: string
  systemPrompt: string
  mcpServerId?: string
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  name: string
  description: string
  config: AgentConfig
  mcpServer?: MCPServer
}

export interface ChatMessage {
  id: string
  agentId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface ChatSession {
  id: string
  agentId: string
  name: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

type AgentSortOption = 'name' | 'createdAt' | 'updatedAt'
type SortDirection = 'asc' | 'desc'

export interface AgentState {
  // Collections
  agents: Agent[]
  mcpServers: MCPServer[]
  chatSessions: ChatSession[]

  // UI state
  selectedAgentId: string | null
  selectedSessionId: string | null
  isCreatingAgent: boolean
  isEditingAgent: boolean
  sortBy: AgentSortOption
  sortDirection: SortDirection
  searchQuery: string
  filteredAgents: Agent[]

  // Status
  loading: boolean
  error: string | null

  // Actions
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  deleteAgent: (id: string) => void
  selectAgent: (id: string | null) => void

  setMCPServers: (servers: MCPServer[]) => void
  addMCPServer: (server: MCPServer) => void
  updateMCPServer: (id: string, updates: Partial<MCPServer>) => void
  deleteMCPServer: (id: string) => void

  setChatSessions: (sessions: ChatSession[]) => void
  addChatSession: (session: ChatSession) => void
  updateChatSession: (id: string, updates: Partial<ChatSession>) => void
  deleteChatSession: (id: string) => void
  selectChatSession: (id: string | null) => void
  addMessageToSession: (sessionId: string, message: ChatMessage) => void

  setSearchQuery: (query: string) => void
  setSortBy: (sortBy: AgentSortOption) => void
  setSortDirection: (direction: SortDirection) => void

  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  // Filter and sort
  applyFilters: () => void
}
