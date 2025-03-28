"use client";

import { useCopilotChat, UseCopilotChatOptions } from "@copilotkit/react-core";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { useState, useRef, useEffect } from "react";
import { ArrowUp, StopCircle } from "lucide-react";
import { Markdown } from "@copilotkit/react-ui";
import { ToolCallRenderer } from "./ToolCallRenderer";

interface CustomChatUIProps {
  instructions: string;
  labels?: {
    title: string;
    initial: string;
    placeholder: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = any;

const getDisplayName = (name: string): string => {
  if (!name) return "Unknown Tool";
  
  const nameMap: Record<string, string> = {
    'GMAIL_FETCH_EMAILS': 'Using Gmail Tool',
    'GMAIL_CHECK_ACTIVE_CONNECTION': 'Checking Gmail Connection',
    'GMAIL_GET_REQUIRED_PARAMETERS': 'Getting Gmail Setup',
    'GMAIL_INITIATE_CONNECTION': 'Initiating Gmail Auth',
    // Add more mappings as needed
  };
  
  if (nameMap[name]) {
    return nameMap[name];
  }
  
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export function CustomChatUI({
  instructions,
  labels = {
    title: "Echo",
    initial: "Need any help?",
    placeholder: "Ask a question...",
  },
}: CustomChatUIProps) {
  const {
    visibleMessages,
    appendMessage,
    setMessages,
    deleteMessage,
    reloadMessages,
    stopGeneration,
    isLoading,
  } = useCopilotChat({
    systemPrompt: instructions,
  } as UseCopilotChatOptions);

  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = () => {
    if (inputValue.trim() && !isLoading) {
      appendMessage(
        new TextMessage({ content: inputValue.trim(), role: Role.User })
      );
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent new lines - catch all enter key combinations
    if (e.key === "Enter") {
      e.preventDefault();
      // Only send message if not shift+enter
      if (!e.shiftKey) {
        sendMessage();
      }
    }
  };

  // Handle auto-resizing of the textarea
  const autoResizeTextarea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    // No need to resize height since we're using horizontal scrolling
    setInputValue(textarea.value);
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Render different types of messages
  const renderMessage = (message: ChatMessage) => {
    // For debugging - log the message structure
    console.log("Message to render:", message);

    // Skip rendering for empty messages or certain message types we want to ignore
    if (!message || message.__typename === "AgentStateMessage") {
      return null;
    }

    // Check if message is a user message
    if (message.role === Role.User) {
      return <div className="whitespace-pre-wrap">{message.content}</div>;
    }

    // Check if it's a tool call message - return directly without the bubble wrapper
    const isToolCall = 
      message.__typename === "ActionExecutionMessage" || 
      (typeof message.id === 'string' && message.id.includes('call_')) ||
      message.__typename === "ResultMessage" || 
      (typeof message.id === 'string' && message.id.includes('result_')) ||
      message.toolCalls || 
      (message.name && message.args && message.status);

    // If it's a tool call, return the appropriate renderer directly
    if (isToolCall) {
      // Check ActionExecutionMessage type
      if (message.__typename === "ActionExecutionMessage" || 
          (typeof message.id === 'string' && message.id.includes('call_'))) {
        return (
          <ToolCallRenderer
            name={getDisplayName(message.name) || "Unknown Tool"}
            args={message.arguments || {}}
            status="running"
            result={null}
          />
        );
      }

      // Check ResultMessage type
      if (message.__typename === "ResultMessage" || 
          (typeof message.id === 'string' && message.id.includes('result_'))) {
        return (
          <ToolCallRenderer
            name={getDisplayName(message.actionName) || "Unknown Tool"}
            args={message.args || {}}
            status={message.result && message.result.error ? "error" : "success"}
            result={message.result || {}}
          />
        );
      }
      
      // Original tool call checks - for backward compatibility
      if (message.toolCalls && message.toolCalls.length > 0) {
        return (
          <div className="space-y-3">
            {message.toolCalls.map((toolCall: any, index: number) => (
              <ToolCallRenderer
                key={index}
                name={getDisplayName(toolCall.name) || "Unknown Tool"}
                args={toolCall.args || {}}
                status={toolCall.status || "unknown"}
                result={toolCall.result}
              />
            ))}
          </div>
        );
      }
      
      // Original tool call check - for backward compatibility
      if (message.name && message.args && message.status) {
        return (
          <ToolCallRenderer
            name={getDisplayName(message.name)}
            args={message.args}
            status={message.status}
            result={message.result}
          />
        );
      }
    }

    // Default for assistant text messages
    return message.content ? <Markdown content={message.content} /> : null;
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center py-2">
        <h2 className="text-lg font-light">{labels.title}</h2>
        <div className="flex space-x-2">
          <button
            onClick={reloadMessages}
            className="p-2 rounded-full cursor-pointer hover:scale-105 hover:bg-white/10 transition-all duration-300"
            aria-label="Reload conversation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages - Only this section should scroll */}
      <div className="flex-1 overflow-y-auto p-4 overflow-x-hidden">
        {visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-white text-2xl tracking-tight">{labels.initial}</p>
          </div>
        ) : (
          <div className="space-y-6 w-full">
            {visibleMessages.map((message) => {
              // Cast message to ChatMessage type to fix TypeScript errors
              const msg = message as ChatMessage;
              
              // Check if it's a tool call message
              const isToolCall = 
                msg.__typename === "ActionExecutionMessage" || 
                (typeof msg.id === 'string' && msg.id.includes('call_')) ||
                msg.__typename === "ResultMessage" || 
                (typeof msg.id === 'string' && msg.id.includes('result_')) ||
                msg.toolCalls || 
                (msg.name && msg.args && msg.status);
              
              // For tool calls, render without the message bubble
              if (isToolCall && msg.role !== Role.User) {
                return (
                  <div key={msg.id} className="flex justify-start w-full">
                    {renderMessage(msg)}
                  </div>
                );
              }
              
              // For regular messages, render with the message bubble
              return (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === Role.User ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-4 ${
                      msg.role === Role.User
                        ? "bg-white text-black"
                        : "bg-black text-white border border-white/10"
                    }`}
                  >
                    {renderMessage(msg)}
                  </div>
                </div>
              );
            })}
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg p-4 bg-black text-white border border-white/10">
                  <div className="flex items-center space-x-3">
                    <div className="flex space-x-2">
                      <div className="w-2 h-2 rounded-full bg-white/50 animate-pulse"></div>
                      <div
                        className="w-2 h-2 rounded-full bg-white/50 animate-pulse"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                      <div
                        className="w-2 h-2 rounded-full bg-white/50 animate-pulse"
                        style={{ animationDelay: "0.4s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="px-4 shrink-0 bg-background"
      >
        <div className="flex space-x-2 justify-between items-center">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={autoResizeTextarea}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData('text/plain');
              // Replace all newlines with spaces to keep it a single line
              const sanitizedText = text.replace(/[\r\n]+/g, ' ');
              // Update the input value with the sanitized text
              const newValue = inputValue.substring(0, e.currentTarget.selectionStart) + 
                              sanitizedText + 
                              inputValue.substring(e.currentTarget.selectionEnd);
              setInputValue(newValue);
            }}
            placeholder={labels.placeholder}
            className="flex-1 bg-background text-white rounded-lg px-4 py-2 ring-1 ring-white/20 focus:ring-white/30 transition-all focus:outline-none resize-none overflow-x-auto [&::-webkit-scrollbar]:hidden"
            style={{
              height: "41.5px",
              minHeight: "41.5px",
              maxHeight: "41.5px",
              whiteSpace: "nowrap",
              overflowY: "hidden",
              overflowX: "auto",
              scrollbarWidth: "none", /* Firefox */
              msOverflowStyle: "none", /* IE and Edge */
            }}
            disabled={isLoading}
          />
          <div className=" flex justify-end">
            {isLoading ? (
              <button
                onClick={stopGeneration}
                className="!bg-white !text-black px-4 py-3 rounded-lg cursor-pointer hover:scale-105 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ backgroundColor: "white", color: "black" }}
              >
                <StopCircle className="h-5 w-5 text-black" />
              </button>
            ) : (
              <button
                type="submit"
                className="!bg-white !text-black px-4 py-3 rounded-lg cursor-pointer hover:scale-105 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100"
                style={{ backgroundColor: "white", color: "black" }}
                disabled={!inputValue.trim() || isLoading}
              >
                <ArrowUp className="h-5 w-5 text-black" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default CustomChatUI;
