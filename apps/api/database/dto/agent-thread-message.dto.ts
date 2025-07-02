import { Type, type Static } from "@sinclair/typebox";
import { AgentThreadMessagePlainInputCreate, AgentThreadMessagePlainInputUpdate, AgentThreadMessagePlain } from "../generated/typebox/AgentThreadMessage";

export const AgentThreadMessageContentImage = Type.Object({
    image_url: Type.Optional(Type.String())
});

export const AgentThreadMessageSchema = AgentThreadMessagePlain;
export const AgentThreadMessageCreateSchema = AgentThreadMessagePlainInputCreate;
export const AgentThreadMessageUpdateSchema = AgentThreadMessagePlainInputUpdate;

export type AgentThreadMessage = Static<typeof AgentThreadMessageSchema>;
export type AgentThreadMessageCreateType = Static<typeof AgentThreadMessageCreateSchema>;
export type AgentThreadMessageUpdateType = Static<typeof AgentThreadMessageUpdateSchema>;