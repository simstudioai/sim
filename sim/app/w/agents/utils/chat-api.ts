import { Role } from "@copilotkit/runtime-client-gql";

// Types
export interface Chat {
  id: string;
  agentId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: string;
  content: string | null;
  toolCallData: any | null;
  createdAt: string;
  order: number;
}

export interface ChatWithMessages {
  chat: Chat;
  messages: ChatMessage[];
}

// Get all chats for an agent
export async function fetchAgentChats(agentId: string): Promise<Chat[]> {
  try {
    const response = await fetch(`/api/agent-chats?agentId=${agentId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch chats: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching agent chats:', error);
    throw error;
  }
}

// Create a new chat for an agent
export async function createChat(agentId: string, title?: string): Promise<Chat> {
  try {
    const response = await fetch('/api/agent-chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentId, title }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create chat: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error creating chat:', error);
    throw error;
  }
}

// Get a chat and its messages
export async function fetchChat(chatId: string): Promise<ChatWithMessages> {
  try {
    const response = await fetch(`/api/agent-chats/${chatId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch chat: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching chat:', error);
    throw error;
  }
}

// Update a chat (currently just title)
export async function updateChat(chatId: string, title: string): Promise<Chat> {
  try {
    const response = await fetch(`/api/agent-chats/${chatId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error(`Failed to update chat: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error updating chat:', error);
    throw error;
  }
}

// Delete a chat
export async function deleteChat(chatId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/agent-chats/${chatId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete chat: ${response.statusText}`);
    }
    return true;
  } catch (error) {
    console.error('Error deleting chat:', error);
    throw error;
  }
}

// Add a message to a chat
export async function addMessage(chatId: string, role: string, content: string, toolCallData?: any): Promise<ChatMessage> {
  try {
    const response = await fetch(`/api/agent-chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role, content, toolCallData }),
    });
    if (!response.ok) {
      throw new Error(`Failed to add message: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error adding message:', error);
    throw error;
  }
}

// Clear all messages in a chat
export async function clearMessages(chatId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/agent-chats/${chatId}/messages`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to clear messages: ${response.statusText}`);
    }
    return true;
  } catch (error) {
    console.error('Error clearing messages:', error);
    throw error;
  }
} 