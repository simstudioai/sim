import { Agent } from '../hooks/useAgentContext'

// Get all agents
export async function fetchAgents(): Promise<Agent[]> {
  try {
    const response = await fetch('/api/agents')
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`)
    }
    return await response.json()
  } catch (error) {
    console.error('Error fetching agents:', error)
    throw error
  }
}

// Get a specific agent
export async function fetchAgent(id: string): Promise<Agent | null> {
  try {
    const response = await fetch(`/api/agents/${id}`)
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch agent: ${response.statusText}`)
    }
    return await response.json()
  } catch (error) {
    console.error(`Error fetching agent ${id}:`, error)
    throw error
  }
}

// Create a new agent
export async function createAgent(agent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
  try {
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(agent),
    })
    if (!response.ok) {
      throw new Error(`Failed to create agent: ${response.statusText}`)
    }
    return await response.json()
  } catch (error) {
    console.error('Error creating agent:', error)
    throw error
  }
}

// Update an existing agent
export async function updateAgent(id: string, agent: Partial<Agent>): Promise<Agent> {
  try {
    const response = await fetch(`/api/agents/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(agent),
    })
    if (!response.ok) {
      throw new Error(`Failed to update agent: ${response.statusText}`)
    }
    return await response.json()
  } catch (error) {
    console.error(`Error updating agent ${id}:`, error)
    throw error
  }
}

// Delete an agent
export async function deleteAgent(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/agents/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(`Failed to delete agent: ${response.statusText}`)
    }
    return true
  } catch (error) {
    console.error(`Error deleting agent ${id}:`, error)
    throw error
  }
} 