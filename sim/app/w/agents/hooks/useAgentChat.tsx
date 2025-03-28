import { useState, useEffect, useCallback } from 'react';
import { useAgentContext } from './useAgentContext';
import { Role } from '@copilotkit/runtime-client-gql';
import { 
  Chat, 
  ChatMessage, 
  fetchAgentChats,
  fetchChat,
  createChat,
  updateChat,
  deleteChat,
  addMessage,
  clearMessages 
} from '../utils/chat-api';

interface UseAgentChatReturn {
  chats: Chat[];
  currentChatId: string | null;
  messages: ChatMessage[];
  setCurrentChatId: (id: string | null) => void;
  createNewChat: (title?: string) => Promise<Chat>;
  sendMessage: (content: string) => Promise<void>;
  addAssistantMessage: (content: string, toolCallData?: any) => Promise<void>;
  renameChat: (title: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  clearCurrentChat: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useAgentChat(): UseAgentChatReturn {
  const { currentAgentId } = useAgentContext();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all chats for current agent
  const fetchChats = useCallback(async () => {
    if (!currentAgentId) return;
    
    try {
      setIsLoading(true);
      const agentChats = await fetchAgentChats(currentAgentId);
      setChats(agentChats);
      
      // If we have chats but no current chat is selected, select the first one
      if (agentChats.length > 0 && !currentChatId) {
        setCurrentChatId(agentChats[0].id);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error fetching chats:', err);
      setError('Failed to load chats');
    } finally {
      setIsLoading(false);
    }
  }, [currentAgentId, currentChatId]);

  // Fetch current chat and its messages
  const fetchCurrentChat = useCallback(async () => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }
    
    try {
      setIsLoading(true);
      const { messages } = await fetchChat(currentChatId);
      setMessages(messages);
      setError(null);
    } catch (err) {
      console.error('Error fetching chat:', err);
      setError('Failed to load chat');
    } finally {
      setIsLoading(false);
    }
  }, [currentChatId]);

  // Fetch chats when current agent changes
  useEffect(() => {
    fetchChats();
  }, [currentAgentId, fetchChats]);

  // Fetch messages when current chat changes
  useEffect(() => {
    fetchCurrentChat();
  }, [currentChatId, fetchCurrentChat]);

  // Create a new chat
  const createNewChat = async (title?: string): Promise<Chat> => {
    if (!currentAgentId) {
      throw new Error('No agent selected');
    }
    
    try {
      setIsLoading(true);
      const newChat = await createChat(currentAgentId, title);
      setChats(prev => [newChat, ...prev]);
      setCurrentChatId(newChat.id);
      setMessages([]);
      setError(null);
      return newChat;
    } catch (err) {
      console.error('Error creating chat:', err);
      setError('Failed to create chat');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Send a user message
  const sendMessage = async (content: string): Promise<void> => {
    if (!currentChatId) {
      // If no chat exists, create one first
      try {
        const newChat = await createNewChat();
        await addUserMessage(newChat.id, content);
      } catch (err) {
        console.error('Error creating chat and sending message:', err);
        setError('Failed to send message');
      }
      return;
    }
    
    await addUserMessage(currentChatId, content);
  };

  // Helper for adding a user message
  const addUserMessage = async (chatId: string, content: string): Promise<void> => {
    try {
      setIsLoading(true);
      const newMessage = await addMessage(chatId, Role.User, content);
      setMessages(prev => [...prev, newMessage]);
      setError(null);
    } catch (err) {
      console.error('Error adding user message:', err);
      setError('Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  // Add an assistant message
  const addAssistantMessage = async (content: string, toolCallData?: any): Promise<void> => {
    if (!currentChatId) return;
    
    try {
      setIsLoading(true);
      const newMessage = await addMessage(currentChatId, Role.Assistant, content, toolCallData);
      setMessages(prev => [...prev, newMessage]);
      setError(null);
    } catch (err) {
      console.error('Error adding assistant message:', err);
      setError('Failed to add assistant response');
    } finally {
      setIsLoading(false);
    }
  };

  // Rename the current chat
  const renameChat = async (title: string): Promise<void> => {
    if (!currentChatId) return;
    
    try {
      setIsLoading(true);
      const updatedChat = await updateChat(currentChatId, title);
      setChats(prev => prev.map(chat => 
        chat.id === updatedChat.id ? updatedChat : chat
      ));
      setError(null);
    } catch (err) {
      console.error('Error renaming chat:', err);
      setError('Failed to rename chat');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a chat
  const removeChat = async (id: string): Promise<void> => {
    try {
      setIsLoading(true);
      await deleteChat(id);
      
      // Remove from state
      setChats(prev => prev.filter(chat => chat.id !== id));
      
      // If we deleted the current chat, select another one or set to null
      if (id === currentChatId) {
        const remainingChats = chats.filter(chat => chat.id !== id);
        if (remainingChats.length > 0) {
          setCurrentChatId(remainingChats[0].id);
        } else {
          setCurrentChatId(null);
          setMessages([]);
        }
      }
      
      setError(null);
    } catch (err) {
      console.error('Error deleting chat:', err);
      setError('Failed to delete chat');
    } finally {
      setIsLoading(false);
    }
  };

  // Clear messages in current chat
  const clearCurrentChat = async (): Promise<void> => {
    if (!currentChatId) return;
    
    try {
      setIsLoading(true);
      await clearMessages(currentChatId);
      setMessages([]);
      setError(null);
    } catch (err) {
      console.error('Error clearing messages:', err);
      setError('Failed to clear chat');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    chats,
    currentChatId,
    messages,
    setCurrentChatId,
    createNewChat,
    sendMessage,
    addAssistantMessage,
    renameChat,
    removeChat,
    clearCurrentChat,
    isLoading,
    error,
  };
} 