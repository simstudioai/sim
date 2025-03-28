"use client";

import { AgentSidebar } from "./AgentSidebar";
import { useState, useEffect } from "react";
import { CustomChatUI } from "./CustomChatUI";
import { useAgentContext } from "../hooks/useAgentContext";
import { AgentConfigForm } from "./AgentConfigForm";
import { CreateAgentModal } from "./CreateAgentModal";

export function AgentContent() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { getCurrentAgent, createAgent } = useAgentContext();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const currentAgent = getCurrentAgent();

  return (
    <div className="flex h-screen bg-background text-white">
      <AgentSidebar />

      <div className="flex-1 p-4 flex flex-col">
        <div className="mb-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-medium">{currentAgent.name}</h1>
            {currentAgent.description && (
              <p className="text-sm text-white/60">{currentAgent.description}</p>
            )}
          </div>
          
        </div>

        <div className="flex-1 overflow-hidden">
          <CustomChatUI
            instructions={`You are a professional assistant for the agent "${currentAgent.name}". Be concise and helpful.`}
            labels={{
              title: "",
              initial: "How can I help you today?",
              placeholder: "Ask a question...",
            }}
          />
        </div>
      </div>

      <div className="w-80 border-l border-white/10 bg-black">
        <AgentConfigForm />
      </div>

      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className="fixed bottom-4 left-4 z-50 p-3 bg-background text-white rounded-full shadow-lg lg:hidden border border-white/20 hover:bg-white/10 transition-colors"
        aria-label="Toggle config"
      >
        {isChatOpen ? "×" : "⚙"}
      </button>
      
      <CreateAgentModal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)}
        createAgent={createAgent}
      />
    </div>
  );
}