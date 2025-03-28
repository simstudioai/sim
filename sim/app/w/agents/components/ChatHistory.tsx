import { useState } from 'react';
import { Chat } from '../utils/chat-api';
import { Loader2, MessageSquare, Plus, Trash2, Edit, Check, X } from 'lucide-react';

interface ChatHistoryProps {
  chats: Chat[];
  currentChatId: string | null;
  onSelectChat: (id: string) => void;
  onCreateChat: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  isLoading: boolean;
}

export function ChatHistory({
  chats,
  currentChatId,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onRenameChat,
  isLoading,
}: ChatHistoryProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEditing = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const saveTitle = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRenameChat(chatId, editTitle.trim());
    }
    setEditingChatId(null);
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).format(date);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-white/10 flex justify-between items-center">
        <h3 className="font-medium">Chat History</h3>
        <button
          onClick={onCreateChat}
          className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center text-xs"
          disabled={isLoading}
        >
          <Plus size={14} className="mr-1" /> New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && chats.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={24} className="animate-spin text-white/50" />
          </div>
        ) : chats.length === 0 ? (
          <div className="p-4 text-center text-white/50">
            <MessageSquare className="mx-auto mb-2 opacity-30" size={24} />
            <p>No chats yet</p>
            <p className="text-xs mt-1">Start a new conversation</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {chats.map((chat) => (
              <li
                key={chat.id}
                className={`p-3 cursor-pointer hover:bg-white/5 transition-colors ${
                  currentChatId === chat.id ? 'bg-blue-500/20' : ''
                }`}
                onClick={() => onSelectChat(chat.id)}
              >
                <div className="flex items-center justify-between">
                  {editingChatId === chat.id ? (
                    <div className="flex items-center flex-1 space-x-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 bg-black border border-white/30 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button 
                        onClick={(e) => saveTitle(chat.id, e)}
                        className="text-green-500 hover:text-green-400"
                      >
                        <Check size={16} />
                      </button>
                      <button 
                        onClick={cancelEditing}
                        className="text-red-500 hover:text-red-400"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 truncate font-medium text-sm">
                        {chat.title || 'Untitled Chat'}
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={(e) => startEditing(chat, e)}
                          className="text-white/50 hover:text-white"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChat(chat.id);
                          }}
                          className="text-white/50 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {!editingChatId && (
                  <div className="text-xs text-white/50 mt-1">
                    {formatDate(chat.updatedAt)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
} 