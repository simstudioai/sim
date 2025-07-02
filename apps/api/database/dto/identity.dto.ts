import { Type, type Static } from "@sinclair/typebox";
import { IdentityPlainInputCreate, IdentityPlainInputUpdate, IdentityPlain } from "../generated/typebox/Identity";

export const IdentitySchema = IdentityPlain;

export const IdentityCreateSchema = Type.Object({
    ...IdentityPlainInputCreate.properties,
    promptTemplateId: Type.Optional(Type.String()),
});

export const IdentityUpdateSchema = Type.Object({
    ...IdentityPlainInputUpdate.properties,
    promptTemplateId: Type.Optional(Type.String()),
});

export type Identity = Static<typeof IdentitySchema>;
export type IdentityCreateType = Static<typeof IdentityCreateSchema>;
export type IdentityUpdateType = Static<typeof IdentityUpdateSchema>;