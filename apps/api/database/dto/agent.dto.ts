import { Type, type Static } from "@sinclair/typebox";
import * as PrismaAgent from "../generated/typebox/Agent";
import * as PrismaAgentTag from "../generated/typebox/AgentTag";
import * as PrismaMemory from "../generated/typebox/Memory";
import * as PrismaTag from "../generated/typebox/Tag";
import * as PrismaMemoryBlock from "../generated/typebox/MemoryBlock";
import * as PrismaModel from "../generated/typebox/Model";
import { AgentModelCreateSchema, AgentModelUpdateSchema } from "./agent-model.dto";
import { AgentEnvironmentVariableCreateSchema } from "./agent-environment-variable.dto";
import { AgentModelPlain } from "../generated/typebox/AgentModel";

export const AgentSchema = PrismaAgent.AgentPlain;

export const AgentWithRelationsSchema = Type.Object({
    ...PrismaAgent.Agent.properties,
    memory: Type.Object({
        ...PrismaMemory.MemoryPlain.properties,
        blocks: Type.Optional(Type.Array(PrismaMemoryBlock.MemoryBlockPlain))
    }),
    modelConfig: Type.Object({
        ...AgentModelPlain.properties,
        model: PrismaModel.ModelPlain
    }),
    tags: Type.Array(Type.Object({
        ...PrismaAgentTag.AgentTagRelations.properties,
        tag: PrismaTag.TagPlain
    }))
});

export const AgentCreateSchema = Type.Object({
    ...PrismaAgent.AgentPlainInputCreate.properties,
    modelConfig: Type.Optional(AgentModelCreateSchema),
    environmentVariables: Type.Optional(Type.Array(AgentEnvironmentVariableCreateSchema)),
    tags: Type.Optional(Type.Array(Type.String())),
    identityId: Type.Optional(Type.String()),
    memoryId: Type.Optional(Type.String()),
});

export const AgentUpdateSchema = Type.Object({
    ...PrismaAgent.AgentPlainInputUpdate.properties,
    modelConfig: Type.Optional(AgentModelUpdateSchema),
    environmentVariables: Type.Optional(Type.Array(AgentEnvironmentVariableCreateSchema)),
    tags: Type.Optional(Type.Array(Type.String())),
    identityId: Type.Optional(Type.String()),
    memoryId: Type.Optional(Type.String()),
});

export type Agent = Static<typeof AgentSchema>;
export type AgentWithRelations = Static<typeof AgentWithRelationsSchema>;
export type AgentCreateType = Static<typeof AgentCreateSchema>;
export type AgentUpdateType = Static<typeof AgentUpdateSchema>;