import { Type, type Static } from "@sinclair/typebox";
import { ModelPlain, ModelPlainInputCreate, ModelPlainInputUpdate } from "../generated/typebox/Model";

export const ModelSchema = ModelPlain;
export const ModelCreateSchema = ModelPlainInputCreate;
export const ModelUpdateSchema = ModelPlainInputUpdate;

export type Model = Static<typeof ModelSchema>;
export type ModelCreateType = Static<typeof ModelCreateSchema>;
export type ModelUpdateType = Static<typeof ModelUpdateSchema>;