import { type Static, Type } from "@sinclair/typebox";
import * as PrismaAgentModel from "../generated/typebox/AgentModel";

export const AgentModelCreateSchema = Type.Object({
    ...PrismaAgentModel.AgentModelPlainInputCreate.properties,
    modelId: Type.String(),
});

export const AgentModelUpdateSchema = Type.Object({
    ...PrismaAgentModel.AgentModelPlainInputUpdate.properties,
    modelId: Type.Optional(Type.String()),
});

export type AgentModelCreateType = Static<typeof AgentModelCreateSchema>;
export type AgentModelUpdateType = Static<typeof AgentModelUpdateSchema>;