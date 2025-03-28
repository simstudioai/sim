import type { Metadata } from "next";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export const metadata: Metadata = {
  title: "Agents - Sim Studio",
  description: "Create and manage custom agents",
};

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="sim_agent"
      showDevConsole={false}
    >
      {children}
    </CopilotKit>
  );
}
