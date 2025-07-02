import { AgentType } from "../generated/prisma";
import { EnumEntry } from "../lib/enum.util";

export const AgentTypeEnum = AgentType;

export const getAgentTypeEnumEntries = (): EnumEntry[] => [
    { key: AgentTypeEnum.STATEFUL, value: "Stateful" },
    { key: AgentTypeEnum.SPLIT_THREAD_AGENT, value: "Split Thread Agent" },
    { key: AgentTypeEnum.OFFLINE_MEMORY, value: "Offline Memory" },
]
