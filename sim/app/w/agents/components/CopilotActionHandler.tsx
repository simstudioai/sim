"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { ToolCallRenderer } from "../components/ToolCallRenderer";

export const CopilotActionHandler: React.FC = () => {

  useCopilotAction({
    name: "*",
    render: ({ name, args, status, result }: any) => {
      return (
        <ToolCallRenderer
          name={name}
          args={args}
          status={status || "unknown"}
          result={result}
        />
      );
    },
  });
  
  return null;
}; 