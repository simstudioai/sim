"use client";

import { CopilotActionHandler } from "./components/CopilotActionHandler";
import { MCPConfigForm } from "./components/MCPConfigForm";
import { AgentConfigForm } from "./components/AgentConfigForm";
import { AgentSidebar } from "./components/AgentSidebar";
// import { CreateAgentModal } from "./components/CreateAgentModal";
import { useState, useEffect } from "react";
import { PersistentChatUI } from "./components/PersistentChatUI";
import { AgentProvider, useAgentContext } from "./hooks/useAgentContext";

// Main content area wrapped with AgentProvider
function AgentContent() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { getCurrentAgent } = useAgentContext();

  // Force dark mode and prevent body scrolling
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  const currentAgent = getCurrentAgent();

  return (
    <div className="h-screen overflow-hidden bg-background text-white flex relative">
      {/* Client component that sets up the Copilot action handler */}
      <CopilotActionHandler />

      {/* Agent Sidebar */}
      <AgentSidebar />

      {/* Create Agent Modal */}
      {/* <CreateAgentModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} /> */}

      {/* Main content area - For the chat */}
      <div className="flex-1 p-4 md:p-8 lg:pl-8 lg:pr-[32vw] flex flex-col overflow-hidden">
        {/* Header with agent name and create button */}
        <div className="mb-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-medium">{currentAgent.name}</h1>
            {currentAgent.description && (
              <p className="text-sm text-white/60">{currentAgent.description}</p>
            )}
          </div>
          {/* Commenting out the create button since it's now in the sidebar */}
          {/* <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3 py-1.5 bg-blue-600 text-black rounded-md text-sm hover:bg-blue-700"
          >
            Create Agent
          </button> */}
        </div>

        {/* Chat UI takes the main area */}
        <PersistentChatUI
          instructions={`You are a professional assistant named Echo, providing expert guidance for the agent "${currentAgent.name}". Be concise and helpful.`}
          labels={{
            title: currentAgent.name,
            initial: "How can I help you today?",
            placeholder: "Ask a question...",
          }}
        />
      </div>

      {/* Mobile chat toggle button */}
      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className="fixed bottom-4 left-4 z-50 p-3 bg-background text-white rounded-full shadow-lg lg:hidden border border-white/20 hover:bg-white/10 transition-colors"
        aria-label="Toggle config"
      >
        {isChatOpen ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        )}
      </button>

      {/* Server config panel - Now with the agent config */}
      <div
        className={`fixed inset-0 lg:right-0 lg:left-auto lg:w-[30vw] bg-black border-l border-white/10 shadow-md transition-transform duration-300 overflow-hidden ${
          isChatOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
      >
        <AgentConfigForm />
      </div>
    </div>
  );
}

// Page component
export default function Page() {
  return (
    <AgentProvider>
      <AgentContent />
    </AgentProvider>
  );
}
