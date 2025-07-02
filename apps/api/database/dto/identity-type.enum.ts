import { IdentityType } from "../generated/prisma/client";
import { EnumEntry } from "../lib/enum.util";

export const IdentityTypeEnum = IdentityType;

export const getIdentityTypeEnumEntries = (): EnumEntry[] => [
    { key: IdentityTypeEnum.PERSON, value: "Person" },
    { key: IdentityTypeEnum.ORGANIZATION, value: "Organization" },
    { key: IdentityTypeEnum.OTHER, value: "Other" },
]