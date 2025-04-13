/**
 * Agent Builder Zustand Store
 *
 * Central state management for the Agent Builder application:
 * - Maintains collections of agents, MCP servers, and chat sessions
 * - Handles CRUD operations for all entities
 * - Manages UI state including selections, filters, and sorting
 * - Provides actions for modifying state
 * - Implements filtering and sorting logic
 *
 * @module AgentStore
 */
import { create } from 'zustand'
import { AgentState } from './types'

export const useAgentStore = create<AgentState>((set, get) => ({
  // Collections
  agents: [],
  mcpServers: [],
  chatSessions: [],

  // UI state
  selectedAgentId: null,
  selectedSessionId: null,
  isCreatingAgent: false,
  isEditingAgent: false,
  sortBy: 'name',
  sortDirection: 'asc',
  searchQuery: '',
  filteredAgents: [],

  // Status
  loading: true,
  error: null,

  // Agent actions
  setAgents: (agents) => {
    set({ agents, filteredAgents: agents, loading: false })
    get().applyFilters()
  },

  addAgent: (agent) => {
    set((state) => ({
      agents: [...state.agents, agent],
      loading: false,
    }))
    get().applyFilters()
  },

  updateAgent: (id, updates) => {
    set((state) => ({
      agents: state.agents.map((agent) => (agent.id === id ? { ...agent, ...updates } : agent)),
    }))
    get().applyFilters()
  },

  deleteAgent: (id) => {
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== id),
    }))
    get().applyFilters()
  },

  selectAgent: (id) => {
    set({ selectedAgentId: id })
  },

  // MCP Server actions
  setMCPServers: (servers) => {
    set({ mcpServers: servers })
  },

  addMCPServer: (server) => {
    set((state) => ({
      mcpServers: [...state.mcpServers, server],
    }))
  },

  updateMCPServer: (id, updates) => {
    set((state) => ({
      mcpServers: state.mcpServers.map((server) =>
        server.id === id ? { ...server, ...updates } : server
      ),
    }))
  },

  deleteMCPServer: (id) => {
    set((state) => ({
      mcpServers: state.mcpServers.filter((server) => server.id !== id),
    }))
  },

  // Chat session actions
  setChatSessions: (sessions) => {
    set({ chatSessions: sessions })
  },

  addChatSession: (session) => {
    set((state) => ({
      chatSessions: [...state.chatSessions, session],
    }))
  },

  updateChatSession: (id, updates) => {
    set((state) => ({
      chatSessions: state.chatSessions.map((session) =>
        session.id === id ? { ...session, ...updates } : session
      ),
    }))
  },

  deleteChatSession: (id) => {
    set((state) => ({
      chatSessions: state.chatSessions.filter((session) => session.id !== id),
    }))
  },

  selectChatSession: (id) => {
    set({ selectedSessionId: id })
  },

  addMessageToSession: (sessionId, message) => {
    set((state) => ({
      chatSessions: state.chatSessions.map((session) =>
        session.id === sessionId
          ? { ...session, messages: [...session.messages, message] }
          : session
      ),
    }))
  },

  // UI state actions
  setSearchQuery: (query) => {
    set({ searchQuery: query })
    get().applyFilters()
  },

  setSortBy: (sortBy) => {
    set({ sortBy })
    get().applyFilters()
  },

  setSortDirection: (direction) => {
    set({ sortDirection: direction })
    get().applyFilters()
  },

  // Status actions
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  // Filters and sorting
  applyFilters: () => {
    const { agents, searchQuery, sortBy, sortDirection } = get()

    // Filter by search query
    let filtered = [...agents]
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.description.toLowerCase().includes(query)
      )
    }

    // Sort agents
    filtered.sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'createdAt':
          comparison =
            new Date(a.config.createdAt).getTime() - new Date(b.config.createdAt).getTime()
          break
        case 'updatedAt':
          comparison =
            new Date(a.config.updatedAt).getTime() - new Date(b.config.updatedAt).getTime()
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    set({ filteredAgents: filtered })
  },
}))
