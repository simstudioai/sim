"use client";

import { AgentProvider } from "./hooks/useAgentContext";
import { AgentContent } from "./components/AgentContent";

export default function AgentsPage() {
  return (
    <AgentProvider>
      <AgentContent />
    </AgentProvider>
  );
}
