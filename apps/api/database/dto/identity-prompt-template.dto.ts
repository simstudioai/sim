import { type Static } from "@sinclair/typebox";
import { IdentityPromptTemplatePlain } from "../generated/typebox/IdentityPromptTemplate";

export const IdentityPromptTemplateSchema = IdentityPromptTemplatePlain;

export type IdentityPromptTemplate = Static<typeof IdentityPromptTemplateSchema>;