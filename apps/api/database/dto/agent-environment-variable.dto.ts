import { type Static } from "@sinclair/typebox";
import * as PrismaAgentEnvironmentVariable from "../generated/typebox/AgentEnvironmentVariable";

export const AgentEnvironmentVariableCreateSchema = PrismaAgentEnvironmentVariable.AgentEnvironmentVariablePlainInputCreate;
export const AgentEnvironmentVariableUpdateSchema = PrismaAgentEnvironmentVariable.AgentEnvironmentVariablePlainInputUpdate;

export type AgentEnvironmentVariableCreateType = Static<typeof AgentEnvironmentVariableCreateSchema>;
export type AgentEnvironmentVariableUpdateType = Static<typeof AgentEnvironmentVariableUpdateSchema>;