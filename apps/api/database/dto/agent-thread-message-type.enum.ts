import { AgentThreadMessageType } from "../generated/prisma";
import { EnumEntry } from "../lib/enum.util";

export const AgentThreadMessageTypeEnum = AgentThreadMessageType;

export const getAgentThreadMessageTypeEnumEntries = (): EnumEntry[] => [
    { key: AgentThreadMessageTypeEnum.USER, value: "User" },
    { key: AgentThreadMessageTypeEnum.ASSISTANT, value: "Assistant" },
    { key: AgentThreadMessageTypeEnum.SYSTEM, value: "System" },
    { key: AgentThreadMessageTypeEnum.REASONING, value: "Reasoning" },
    { key: AgentThreadMessageTypeEnum.REASONING_HIDDEN, value: "Reasoning (Hidden)" },
    { key: AgentThreadMessageTypeEnum.TOOL_CALL, value: "Tool Call" },
    { key: AgentThreadMessageTypeEnum.TOOL_RETURN, value: "Tool Return" },
]