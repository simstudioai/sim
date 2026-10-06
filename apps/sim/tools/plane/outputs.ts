import type { OutputProperty } from '@/tools/types'

const ASSETID_OUTPUT: OutputProperty = { type: 'string', description: 'Asset Id', optional: true }

const FIELDS_OUTPUT: OutputProperty = { type: 'json', description: 'Fields', optional: true }

const ID045D22_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const ID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COLLECTION_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const FIRSTNAME_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const LASTNAME_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const EMAIL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const AVATAR_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const AVATARURL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Avatar URL',
  optional: true,
  nullable: true,
}

const DISPLAYNAME_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CREATEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const UPDATEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PAGE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const SORTORDERDDE3E5_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Sort Order',
  optional: true,
}

const SORTORDER_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

const NAME_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const OWNEDBYID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const HASPAGES8E2BC3_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
}

const HASPAGES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISDEFAULT_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISGLOBAL_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const LOGOPROPS_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const PAGECOLLECTIONID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COLLECTIONID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PARENTID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ACCESS644595_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
}

const LABELIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Label Ids',
  optional: true,
  items: { type: 'json', description: 'Logo Props' },
}

export const COLLECTIONPAGESEARCHRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'A page eligible to be added to a collection.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
  },
}

const DELETEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DISPLAYNAMED4D29D_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Display  Name',
  optional: true,
}

const DESCRIPTION_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CUSTOMERPROPERTYTYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Customer property types -- the work item set without FORMULA and CASCADING.',
  optional: true,
}

const ISREQUIRED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const DEFAULTVALUECB839F_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Default Value',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const DEFAULTVALUE_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Default Value',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
  nullable: true,
}

const ISACTIVE_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISMULTI_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const VALIDATIONRULES_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const EXTERNALSOURCE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const EXTERNALID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const NAMEEB0F45_OUTPUT: OutputProperty = { type: 'string', description: 'Name', optional: true }

const PROPERTY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DESCRIPTION2C8FE8_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const DESCRIPTIONHTML_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const LINK_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const WORKITEMIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Default Value',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
  nullable: true,
}

const ATTACHMENTCOUNT_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const CUSTOMERREQUESTCOUNT_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const LOGOURL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONSTRIPPED_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONBINARY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const WEBSITEURL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DOMAIN_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const EMPLOYEES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const STAGE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CONTRACTSTATUS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const REVENUE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ARCHIVEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const LOGOASSET_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const IDE04262_OUTPUT: OutputProperty = { type: 'string', description: 'Id', optional: true }

const PROJECTID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DETAIL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Provider confirmation message.',
  optional: true,
}

export const CUSTOMERREQUESTBECA62_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Customer request model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION2C8FE8_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    link: { ...LINK_OUTPUT, description: 'Link' },
    work_item_ids: { ...WORKITEMIDS_OUTPUT, description: 'Work item ids' },
    attachment_count: { ...ATTACHMENTCOUNT_OUTPUT, description: 'Attachment count' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
  },
}

const SUBISSUESCOUNT_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const IDENTIFIER_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Identifier',
  optional: true,
}

const COVERIMAGE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ICONPROP_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const EMOJI_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COVERIMAGEURL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ISSUE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CYCLE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const TOTALISSUES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const CANCELLEDISSUES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const COMPLETEDISSUES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const STARTEDISSUES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const UNSTARTEDISSUES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const BACKLOGISSUES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const TOTALESTIMATES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const COMPLETEDESTIMATES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const STARTEDESTIMATES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const STARTDATE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ENDDATE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const VIEWPROPS_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const PROGRESSSNAPSHOT_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const TIMEZONE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const VERSION_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const COLOR_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const TYPEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const POINT_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const PRIORITY7C079D_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Priority',
  optional: true,
  nullable: true,
}

const TARGETDATE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COMPLETEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ISDRAFT_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const GROUP_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Group',
  optional: true,
  nullable: true,
}

const ESTIMATE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const KEY_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const VALUE_OUTPUT: OutputProperty = { type: 'string', description: 'Value', optional: true }

const CREATEDBY94A812_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const UPDATEDBY1F6D11_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PROJECT0BF380_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const WORKSPACE8D2899_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const TYPE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Type',
  optional: true,
  nullable: true,
}

const CYCLE883343_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const TYPE0858AE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PROJECT4C8EC3_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Project',
  optional: true,
}

const WORKSPACE259123_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Workspace',
  optional: true,
}

const LASTUSED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

export const PLANELISTWORKSPACEMAPPINGSRESULTITEM_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane List Workspace Mappings Result Item',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    idp_group_name: { ...ASSETID_OUTPUT, description: 'Idp group name' },
    role: { ...ASSETID_OUTPUT, description: 'Role' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

const DESCRIPTIONBINARY7500ED_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Description Binary',
  optional: true,
  nullable: true,
}

const LOGOPROPSF7FCCC_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo  Props',
  optional: true,
}

const LEAD_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const TOTALMEMBERS_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const TOTALCYCLES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const TOTALMODULES_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const ISMEMBER_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const MEMBERROLE_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const ISDEPLOYED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const DESCRIPTIONTEXT_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const DESCRIPTIONHTMLFA4901_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const NETWORK_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const MODULEVIEW_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const CYCLEVIEW_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISSUEVIEWSVIEW_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const PAGEVIEW_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const INTAKEVIEW_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISTIMETRACKINGENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISISSUETYPEENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const GUESTVIEWALLFEATURES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ARCHIVEIN_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const CLOSEIN_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const TIMEZONE7677DD_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Timezone',
  optional: true,
  nullable: true,
}

const COVERIMAGEASSET_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DEFAULTSTATE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const EXTRASTATS_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Extra stats (nullable provider value).',
  optional: true,
}

const RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Results',
  optional: true,
  items: {
    type: 'object',
    description: 'results Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const STATUS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Status',
  optional: true,
  nullable: true,
}

const INBOX_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const STATUS60A688_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const SNOOZEDTILL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const SOURCE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const SOURCEEMAIL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const EXTRA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const INTAKE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ISSUE4193E9_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Issue',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    description: { type: 'string', description: 'Asset Id', optional: true },
    priority: { type: 'string', description: 'Asset Id', optional: true },
    sequence_id: { type: 'number', description: 'Sort Order', optional: true },
  },
}

const DUPLICATETO_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const VERB_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const FIELD_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const OLDVALUE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const NEWVALUE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COMMENT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ATTACHMENTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Default Value',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
  nullable: true,
}

const OLDIDENTIFIER_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const NEWIDENTIFIER_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const EPOCH_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const ISSUECOMMENT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const RESULTS803362_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Results',
  optional: true,
  items: {
    type: 'object',
    description: 'results Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const ATTRIBUTES0D5D79_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const ASSET_OUTPUT: OutputProperty = { type: 'string', description: 'Asset', optional: true }

const ENTITYTYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ENTITYIDENTIFIER_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ISDELETED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISARCHIVED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const SIZE_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const ISUPLOADED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const STORAGEMETADATA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const DRAFTISSUE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const UPLOADDATA016C9C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Upload Data',
  optional: true,
  properties: {
    url: { ...ASSETID_OUTPUT, description: 'Url' },
    fields: { ...FIELDS_OUTPUT, description: 'Fields' },
  },
}

const COMMENTSTRIPPED_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COMMENTHTML_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ACCESS11DBB2_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Access',
  optional: true,
  nullable: true,
}

const EDITEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CONTENT_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Content',
  optional: true,
  items: {
    type: 'object',
    description: 'content Item',
    properties: {
      type: { type: 'string', description: 'Asset Id', optional: true },
      content: {
        type: 'array',
        description: 'Content',
        optional: true,
        items: {
          type: 'object',
          description: 'content Item',
          properties: {
            type: { type: 'string', description: 'Asset Id', optional: true },
            text: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
    },
  },
}

const COMMENTJSON_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'comment json',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    content: { ...CONTENT_OUTPUT, description: 'Content' },
  },
}

const PROJECTIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Default Value',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
  nullable: true,
}

const ISEPIC_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const LEVEL_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const ID0C8996_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for this property value',
  optional: true,
}

const PROPERTYID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'ID of the property',
  optional: true,
}

const ISSUEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'ID of the work item',
  optional: true,
}

const VALUE1511A4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'The actual value, formatted according to property type',
  optional: true,
  nullable: true,
}

const VALUETYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Type of the value',
  optional: true,
  nullable: true,
}

const VALUEDETAIL_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'The stored content of a rich text property. For rich text, `value` is the ID of that stored content; the HTML is here.',
  optional: true,
  properties: {
    id: {
      type: 'string',
      description: 'ID of the stored description; None when never set',
      optional: true,
      nullable: true,
    },
    description_html: {
      type: 'string',
      description: 'The content as sanitised HTML',
      optional: true,
    },
    description_stripped: {
      type: 'string',
      description: 'The content as plain text',
      optional: true,
    },
  },
  nullable: true,
}

const EXTERNALIDC082CC_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'External identifier if synced with external system',
  optional: true,
  nullable: true,
}

const EXTERNALSOURCE22E8D8_OUTPUT: OutputProperty = {
  type: 'string',
  description: "External source identifier (e.g., 'github', 'jira')",
  optional: true,
  nullable: true,
}

const CREATEDAT6CA285_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Timestamp when created',
  optional: true,
  nullable: true,
}

const UPDATEDAT32AD46_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Timestamp when last updated',
  optional: true,
  nullable: true,
}

export const WORKITEMPROPERTYVALUEDETAIL_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Detailed work item property value response.\n\nProvides a clean response structure with the value extracted\nand formatted according to property type.',
  optional: true,
  properties: {
    id: { ...ID0C8996_OUTPUT, description: 'Unique identifier for this property value' },
    property_id: { ...PROPERTYID_OUTPUT, description: 'ID of the property' },
    issue_id: { ...ISSUEID_OUTPUT, description: 'ID of the work item' },
    value: {
      ...VALUE1511A4_OUTPUT,
      description: 'The actual value, formatted according to property type',
    },
    value_type: { ...VALUETYPE_OUTPUT, description: 'Type of the value' },
    value_detail: {
      ...VALUEDETAIL_OUTPUT,
      description:
        'The stored content of a rich text property. For rich text, `value` is the ID of that stored content; the HTML is here.',
    },
    external_id: {
      ...EXTERNALIDC082CC_OUTPUT,
      description: 'External identifier if synced with external system',
    },
    external_source: {
      ...EXTERNALSOURCE22E8D8_OUTPUT,
      description: "External source identifier (e.g., 'github', 'jira')",
    },
    created_at: { ...CREATEDAT6CA285_OUTPUT, description: 'Timestamp when created' },
    updated_at: { ...UPDATEDAT32AD46_OUTPUT, description: 'Timestamp when last updated' },
  },
}

const TITLE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const URL_OUTPUT: OutputProperty = { type: 'string', description: 'Url', optional: true }

const METADATA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const ROLE_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const ROLESLUG_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ISBOT_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

export const PROJECTMEMBER_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Project member model.\n\nExtends UserLite with project-scoped role fields. Returned by\nProjects.get_members(). isinstance(member, UserLite) remains True,\nso existing callers that type-check against UserLite are unaffected.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    first_name: { ...FIRSTNAME_OUTPUT, description: 'First name' },
    last_name: { ...LASTNAME_OUTPUT, description: 'Last name' },
    email: { ...EMAIL_OUTPUT, description: 'Email' },
    avatar: { ...AVATAR_OUTPUT, description: 'Avatar' },
    avatar_url: { ...AVATARURL_OUTPUT, description: 'Avatar URL' },
    display_name: { ...DISPLAYNAME_OUTPUT, description: 'Display name' },
    role: { ...ROLE_OUTPUT, description: 'Role' },
    role_slug: { ...ROLESLUG_OUTPUT, description: 'Role slug' },
    is_active: { ...ISACTIVE_OUTPUT, description: 'Is active' },
    is_bot: { ...ISBOT_OUTPUT, description: 'Is bot' },
  },
}

export const WORKSPACEMEMBER_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Workspace member model.\n\nExtends UserLite with workspace-scoped role fields. Returned by\nWorkspaces.get_members(). isinstance(member, UserLite) remains True,\nso existing callers that type-check against UserLite are unaffected.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    first_name: { ...FIRSTNAME_OUTPUT, description: 'First name' },
    last_name: { ...LASTNAME_OUTPUT, description: 'Last name' },
    email: { ...EMAIL_OUTPUT, description: 'Email' },
    avatar: { ...AVATAR_OUTPUT, description: 'Avatar' },
    avatar_url: { ...AVATARURL_OUTPUT, description: 'Avatar URL' },
    display_name: { ...DISPLAYNAME_OUTPUT, description: 'Display name' },
    role: { ...ROLE_OUTPUT, description: 'Role' },
    role_slug: { ...ROLESLUG_OUTPUT, description: 'Role slug' },
    is_active: { ...ISACTIVE_OUTPUT, description: 'Is active' },
    is_bot: { ...ISBOT_OUTPUT, description: 'Is bot' },
  },
}

const TITLE835A49_OUTPUT: OutputProperty = { type: 'string', description: 'Title', optional: true }

export const MILESTONE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Milestone model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    title: { ...TITLE835A49_OUTPUT, description: 'Title' },
    target_date: { ...TARGETDATE_OUTPUT, description: 'Target date' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
  },
}

const MILESTONE92B31C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

export const MILESTONEWORKITEM_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item in a milestone.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    milestone: { ...MILESTONE92B31C_OUTPUT, description: 'Milestone' },
  },
}

const MODULE83515F_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONB39DCD_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const ANCHOR_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PROJECTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Default Value',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
  nullable: true,
}

const ISLOCKED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const LINKS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Links',
  optional: true,
  properties: { download: { ...ASSETID_OUTPUT, description: 'Download' } },
}

export const PLANEGETWORKSPACEPAGEATTACHMENTRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane Get Workspace Page Attachment Result',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    page_id: { ...ASSETID_OUTPUT, description: 'Page id' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    size: { ...ACCESS644595_OUTPUT, description: 'Size' },
    is_uploaded: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is uploaded' },
    asset_url: { ...ASSETID_OUTPUT, description: 'Asset url' },
    _links: { ...LINKS_OUTPUT, description: ' links' },
  },
}

const EPICS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const MODULES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const CYCLES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const VIEWS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const PAGES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const INTAKES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const WORKITEMTYPES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const WORKFLOWS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const PARALLELCYCLES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const PROJECTUPDATES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const PROJECT24481A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Project (nullable provider value).',
  optional: true,
}

const STATUS4B8517_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const RELEASEDATE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const TAG_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ISLATEST_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISPRERELEASE_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const COMMENTFBE0C5_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const ISHIDDEN_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const ISRESOLVED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const RELEASE5C8689_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const URLB58D03_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const VERSIONE55854_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COMMITHASH_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const GITTAG_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CHANGELOG_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const COLORBBA70B_OUTPUT: OutputProperty = { type: 'string', description: 'Color', optional: true }

const SEQUENCE_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

const ISTRIAGE_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const DEFAULT_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const LOGOPROPS235527_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
  nullable: true,
}

const BACKGROUNDCOLOR_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const OWNER_OUTPUT: OutputProperty = { type: 'string', description: 'Owner', optional: true }

const RESULTS5FA64D_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Results',
  optional: true,
  items: {
    type: 'object',
    description: 'results Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description_html: { type: 'string', description: 'Asset Id', optional: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DESCRIPTIONJSON_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description  Json',
  optional: true,
  nullable: true,
}

const LOGOPROPS30A00B_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Logo Props',
  optional: true,
  properties: {
    in_use: { type: 'string', description: 'Asset Id', optional: true },
    emoji: {
      type: 'object',
      description: 'emoji',
      optional: true,
      properties: { value: { type: 'string', description: 'Asset Id', optional: true } },
    },
  },
  nullable: true,
}

const CREATEDATFF28E1_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Created  At',
  optional: true,
}

const UPDATEDAT43E222_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Updated  At',
  optional: true,
}

const UPDATEDBYE10D2E_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Updated by (nullable provider value).',
  optional: true,
}

const BLOCKING_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Blocking',
  optional: true,
  items: {
    type: 'json',
    description: 'Blocking Item',
    properties: {
      project_id: { type: 'string', description: 'Asset Id', optional: true },
      issue_id: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

export const WORKITEMRELATIONS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work Item Relations',
  optional: true,
  properties: {
    blocking: { ...BLOCKING_OUTPUT, description: 'Blocking' },
    blocked_by: { ...BLOCKING_OUTPUT, description: 'Blocked by' },
    duplicate: { ...BLOCKING_OUTPUT, description: 'Duplicate' },
    relates_to: { ...BLOCKING_OUTPUT, description: 'Relates to' },
    start_after: { ...BLOCKING_OUTPUT, description: 'Start after' },
    start_before: { ...BLOCKING_OUTPUT, description: 'Start before' },
    finish_after: { ...BLOCKING_OUTPUT, description: 'Finish after' },
    finish_before: { ...BLOCKING_OUTPUT, description: 'Finish before' },
  },
}

const DURATION_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const WORKSPACEID41DAD2_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const LOGGEDBY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PROJECTGROUPING_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const INITIATIVES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const TEAMS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const CUSTOMERS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const WIKI_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const PI_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const RELEASES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

const STATESOWNEDBYWORKSPACE_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Has Pages',
  optional: true,
  nullable: true,
}

export const PLANELISTWORKSPACEINVITATIONSRESULTITEM_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane List Workspace Invitations Result Item',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    email: { ...ASSETID_OUTPUT, description: 'Email' },
    role: { ...ACCESS644595_OUTPUT, description: 'Role' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    responded_at: { ...ASSETID_OUTPUT, description: 'Responded at' },
    accepted: { ...HASPAGES8E2BC3_OUTPUT, description: 'Accepted' },
  },
}

export const PLANEUPDATEWORKSPACEINVITATIONRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane Update Workspace Invitation Result',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    email: { ...ASSETID_OUTPUT, description: 'Email' },
    role: { ...ACCESS644595_OUTPUT, description: 'Role' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    responded_at: { ...ASSETID_OUTPUT, description: 'Responded at' },
    accepted: { ...HASPAGES8E2BC3_OUTPUT, description: 'Accepted' },
  },
}

const IDE023AA_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for the artifact.',
  optional: true,
}

const NAME0AB876_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Display name. Maximum 255 characters. Defaults to `Untitled dashboard` when created without one.',
  optional: true,
}

const DESCRIPTION79D89E_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Free-form description. Maximum 2000 characters. Returned on the detail read only.',
  optional: true,
}

const CURRENTVERSION_OUTPUT: OutputProperty = {
  type: 'number',
  description:
    'Which version is current. Starts at `1` and increments by one each time you append a version.',
  optional: true,
}

const DATAMODE_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    "How the artifact's data is sourced — `snapshot` (data frozen at generation time) or `live` (re-read on view). Defaults to `snapshot`.",
  optional: true,
}

const HTML_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The rendered HTML of the **current** version. Returned on the detail read only.',
  optional: true,
}

const ISPUBLISHED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether the artifact has a public anchor. Returned on create.',
  optional: true,
}

export const PLANEV2ARTIFACTS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Artifacts',
  optional: true,
  properties: {
    id: { ...IDE023AA_OUTPUT, description: 'Unique identifier for the artifact.' },
    name: {
      ...NAME0AB876_OUTPUT,
      description:
        'Display name. Maximum 255 characters. Defaults to `Untitled dashboard` when created without one.',
    },
    description: {
      ...DESCRIPTION79D89E_OUTPUT,
      description:
        'Free-form description. Maximum 2000 characters. Returned on the detail read only.',
    },
    current_version: {
      ...CURRENTVERSION_OUTPUT,
      description:
        'Which version is current. Starts at `1` and increments by one each time you append a version.',
    },
    data_mode: {
      ...DATAMODE_OUTPUT,
      description:
        "How the artifact's data is sourced — `snapshot` (data frozen at generation time) or `live` (re-read on view). Defaults to `snapshot`.",
    },
    html: {
      ...HTML_OUTPUT,
      description:
        'The rendered HTML of the **current** version. Returned on the detail read only.',
    },
    is_published: {
      ...ISPUBLISHED_OUTPUT,
      description: 'Whether the artifact has a public anchor. Returned on create.',
    },
    anchor: { ...CYCLE883343_OUTPUT, description: 'Anchor' },
  },
}

const ANCHOR536038_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The public anchor once published, otherwise `null`. Returned on create and publish.',
  optional: true,
  nullable: true,
}

export const PLANEV2ARTIFACTS646EAE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Artifacts',
  optional: true,
  properties: {
    id: { ...IDE023AA_OUTPUT, description: 'Unique identifier for the artifact.' },
    name: {
      ...NAME0AB876_OUTPUT,
      description:
        'Display name. Maximum 255 characters. Defaults to `Untitled dashboard` when created without one.',
    },
    description: {
      ...DESCRIPTION79D89E_OUTPUT,
      description:
        'Free-form description. Maximum 2000 characters. Returned on the detail read only.',
    },
    current_version: {
      ...CURRENTVERSION_OUTPUT,
      description:
        'Which version is current. Starts at `1` and increments by one each time you append a version.',
    },
    data_mode: {
      ...DATAMODE_OUTPUT,
      description:
        "How the artifact's data is sourced — `snapshot` (data frozen at generation time) or `live` (re-read on view). Defaults to `snapshot`.",
    },
    html: {
      ...HTML_OUTPUT,
      description:
        'The rendered HTML of the **current** version. Returned on the detail read only.',
    },
    is_published: {
      ...ISPUBLISHED_OUTPUT,
      description: 'Whether the artifact has a public anchor. Returned on create.',
    },
    anchor: {
      ...ANCHOR536038_OUTPUT,
      description:
        'The public anchor once published, otherwise `null`. Returned on create and publish.',
    },
  },
}

const ID6E9F97_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for this audit log record. This is the id you pass to [Get an audit log](/api-reference/v2/audit-logs/get-audit-log).',
  optional: true,
}

const EVENTID_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Identifier of the event the record describes, distinct from `id`. Use it as the idempotency key when you ingest entries into another system so a re-read never double-counts.',
  optional: true,
}

const SEQUENCENUMBER_OUTPUT: OutputProperty = {
  type: 'number',
  description:
    'An ordering number assigned to the entry as it was written. Useful as a stable tiebreaker when two entries share the same `created_at`.',
  optional: true,
}

const EVENTNAME_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The specific event, for example `member.role_updated`. Filterable — this is the field to pin when you know exactly which action you are hunting for.',
  optional: true,
}

const CATEGORY_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The family the event belongs to. One of `auth`, `member`, `role`, `settings`, `integration`, `webhook`, `security`, or `instance`. Filter on `category` when you want a whole class of activity rather than one event name.',
  optional: true,
}

const OUTCOME_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Whether the attempt succeeded. One of `success` or `failure`. Failed attempts are recorded, which is what makes this useful for detecting probing.',
  optional: true,
}

const SOURCE19411E_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The surface the request came through. One of `platform`, `api`, `graphql`, `auth`, `admin`, or `system`. `api` marks calls made with a token like yours; `admin` marks actions taken through instance God Mode; `system` marks actions Plane took on its own.',
  optional: true,
}

const ACTORTYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'What kind of principal acted. One of `user`, `api_token`, `system`, or `anonymous`.',
  optional: true,
}

const TARGETTYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The kind of thing that was acted on, for example `workspace_member`.',
  optional: true,
}

const TARGETID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Identifier of the thing that was acted on.',
  optional: true,
}

const TARGETDISPLAYNAME_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'A human-readable label for the target, captured at the time of the event.',
  optional: true,
}

const OLDVALUEC4F659_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Old Value',
  optional: true,
  properties: { role: { type: 'string', description: 'Asset Id', optional: true } },
  nullable: true,
}

const NEWVALUEDCB173_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 New Value',
  optional: true,
  properties: { role: { type: 'string', description: 'Asset Id', optional: true } },
  nullable: true,
}

const REASON_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'A short explanation recorded alongside the event. Most informative on `outcome: failure` entries.',
  optional: true,
}

const METADATA4D876E_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Metadata',
  optional: true,
  properties: { workspace_slug: { type: 'string', description: 'Asset Id', optional: true } },
}

const USERAGENT_OUTPUT: OutputProperty = {
  type: 'string',
  description: "The client's user agent string.",
  optional: true,
}

const WORKSPACEIDD93D64_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The workspace the event belongs to.',
  optional: true,
}

const PROJECTID926533_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Project Id',
  optional: true,
  nullable: true,
}

const CREATEDATB0F827_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the event was recorded. This is the field the date-range filters work on.',
  optional: true,
}

export const PLANEV2AUDITLOGS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Audit- Logs',
  optional: true,
  properties: {
    id: {
      ...ID6E9F97_OUTPUT,
      description:
        'Unique identifier for this audit log record. This is the id you pass to [Get an audit log](/api-reference/v2/audit-logs/get-audit-log).',
    },
    event_id: {
      ...EVENTID_OUTPUT,
      description:
        'Identifier of the event the record describes, distinct from `id`. Use it as the idempotency key when you ingest entries into another system so a re-read never double-counts.',
    },
    sequence_number: {
      ...SEQUENCENUMBER_OUTPUT,
      description:
        'An ordering number assigned to the entry as it was written. Useful as a stable tiebreaker when two entries share the same `created_at`.',
    },
    event_name: {
      ...EVENTNAME_OUTPUT,
      description:
        'The specific event, for example `member.role_updated`. Filterable — this is the field to pin when you know exactly which action you are hunting for.',
    },
    category: {
      ...CATEGORY_OUTPUT,
      description:
        'The family the event belongs to. One of `auth`, `member`, `role`, `settings`, `integration`, `webhook`, `security`, or `instance`. Filter on `category` when you want a whole class of activity rather than one event name.',
    },
    outcome: {
      ...OUTCOME_OUTPUT,
      description:
        'Whether the attempt succeeded. One of `success` or `failure`. Failed attempts are recorded, which is what makes this useful for detecting probing.',
    },
    source: {
      ...SOURCE19411E_OUTPUT,
      description:
        'The surface the request came through. One of `platform`, `api`, `graphql`, `auth`, `admin`, or `system`. `api` marks calls made with a token like yours; `admin` marks actions taken through instance God Mode; `system` marks actions Plane took on its own.',
    },
    actor_type: {
      ...ACTORTYPE_OUTPUT,
      description:
        'What kind of principal acted. One of `user`, `api_token`, `system`, or `anonymous`.',
    },
    actor_id: { ...CYCLE883343_OUTPUT, description: 'Actor id' },
    actor_display_name: { ...ASSETID_OUTPUT, description: 'Actor display name' },
    actor_email: { ...ASSETID_OUTPUT, description: 'Actor email' },
    target_type: {
      ...TARGETTYPE_OUTPUT,
      description: 'The kind of thing that was acted on, for example `workspace_member`.',
    },
    target_id: { ...TARGETID_OUTPUT, description: 'Identifier of the thing that was acted on.' },
    target_display_name: {
      ...TARGETDISPLAYNAME_OUTPUT,
      description: 'A human-readable label for the target, captured at the time of the event.',
    },
    old_value: { ...OLDVALUEC4F659_OUTPUT, description: 'Old value' },
    new_value: { ...NEWVALUEDCB173_OUTPUT, description: 'New value' },
    reason: {
      ...REASON_OUTPUT,
      description:
        'A short explanation recorded alongside the event. Most informative on `outcome: failure` entries.',
    },
    metadata: { ...METADATA4D876E_OUTPUT, description: 'Metadata' },
    ip_address: { ...CYCLE883343_OUTPUT, description: 'Ip address' },
    user_agent: { ...USERAGENT_OUTPUT, description: "The client's user agent string." },
    workspace_id: {
      ...WORKSPACEIDD93D64_OUTPUT,
      description: 'The workspace the event belongs to.',
    },
    project_id: { ...PROJECTID926533_OUTPUT, description: 'Project id' },
    created_at: {
      ...CREATEDATB0F827_OUTPUT,
      description: 'When the event was recorded. This is the field the date-range filters work on.',
    },
  },
}

const DATA_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Audit- Logs',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for this audit log record. This is the id you pass to [Get an audit log](/api-reference/v2/audit-logs/get-audit-log).',
        optional: true,
      },
      event_id: {
        type: 'string',
        description:
          'Identifier of the event the record describes, distinct from `id`. Use it as the idempotency key when you ingest entries into another system so a re-read never double-counts.',
        optional: true,
      },
      sequence_number: {
        type: 'number',
        description:
          'An ordering number assigned to the entry as it was written. Useful as a stable tiebreaker when two entries share the same `created_at`.',
        optional: true,
      },
      event_name: {
        type: 'string',
        description:
          'The specific event, for example `member.role_updated`. Filterable — this is the field to pin when you know exactly which action you are hunting for.',
        optional: true,
      },
      category: {
        type: 'string',
        description:
          'The family the event belongs to. One of `auth`, `member`, `role`, `settings`, `integration`, `webhook`, `security`, or `instance`. Filter on `category` when you want a whole class of activity rather than one event name.',
        optional: true,
      },
      outcome: {
        type: 'string',
        description:
          'Whether the attempt succeeded. One of `success` or `failure`. Failed attempts are recorded, which is what makes this useful for detecting probing.',
        optional: true,
      },
      source: {
        type: 'string',
        description:
          'The surface the request came through. One of `platform`, `api`, `graphql`, `auth`, `admin`, or `system`. `api` marks calls made with a token like yours; `admin` marks actions taken through instance God Mode; `system` marks actions Plane took on its own.',
        optional: true,
      },
      actor_type: {
        type: 'string',
        description:
          'What kind of principal acted. One of `user`, `api_token`, `system`, or `anonymous`.',
        optional: true,
      },
      actor_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      actor_display_name: { type: 'string', description: 'Asset Id', optional: true },
      actor_email: { type: 'string', description: 'Asset Id', optional: true },
      target_type: {
        type: 'string',
        description: 'The kind of thing that was acted on, for example `workspace_member`.',
        optional: true,
      },
      target_id: {
        type: 'string',
        description: 'Identifier of the thing that was acted on.',
        optional: true,
      },
      target_display_name: {
        type: 'string',
        description: 'A human-readable label for the target, captured at the time of the event.',
        optional: true,
      },
      old_value: {
        type: 'object',
        description: 'Plane V2 Old Value',
        optional: true,
        properties: { role: { type: 'string', description: 'Asset Id', optional: true } },
        nullable: true,
      },
      new_value: {
        type: 'object',
        description: 'Plane V2 New Value',
        optional: true,
        properties: { role: { type: 'string', description: 'Asset Id', optional: true } },
        nullable: true,
      },
      reason: {
        type: 'string',
        description:
          'A short explanation recorded alongside the event. Most informative on `outcome: failure` entries.',
        optional: true,
      },
      metadata: {
        type: 'json',
        description: 'Metadata',
        optional: true,
        properties: {
          workspace_slug: { type: 'string', description: 'Asset Id', optional: true },
          requested: { type: 'string', description: 'Asset Id', optional: true },
        },
      },
      ip_address: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      user_agent: {
        type: 'string',
        description: "The client's user agent string.",
        optional: true,
      },
      workspace_id: {
        type: 'string',
        description: 'The workspace the event belongs to.',
        optional: true,
      },
      project_id: { type: 'json', description: 'Project Id', optional: true, nullable: true },
      created_at: {
        type: 'string',
        description:
          'When the event was recorded. This is the field the date-range filters work on.',
        optional: true,
      },
    },
  },
}

const PREVIOUS_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access',
  optional: true,
  nullable: true,
}

const PLANEV2PAGINATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Pagination',
  optional: true,
  properties: { style: { ...ASSETID_OUTPUT, description: 'Style' } },
}

const ACCESS97D6DB_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Who can see this.',
  optional: true,
}

const CREATEDAT50E5D2_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the record was created.',
  optional: true,
}

const CREATEDBYID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The user who created the record.',
  optional: true,
}

const ID35193D_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier.',
  optional: true,
}

const ISDEFAULT779508_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Make this the default for its parent. Setting it clears the flag on the previous default.',
  optional: true,
}

const ISGLOBAL48E7DF_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether this lives at the workspace level rather than inside a project.',
  optional: true,
}

const LOGOPROPSB599B9_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
  optional: true,
}

const LOGOPROPS06ABC6_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
  optional: true,
  nullable: true,
}

const NAMEF3CA52_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Display name.',
  optional: true,
}

const OWNEDBYID53BB5A_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related owned by.',
  optional: true,
}

const PAGEIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated pages.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const SORTORDER7C3A9E_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Manual ordering weight. Lower sorts first.',
  optional: true,
}

const SORTORDERDDAA43_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
}

const PAGEIDSD23A08_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated pages.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

export const PLANEV2COLLECTIONS992736_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Collections',
  optional: true,
  properties: {
    access: { ...ACCESS97D6DB_OUTPUT, description: 'Who can see this.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_default: {
      ...ISDEFAULT779508_OUTPUT,
      description:
        'Make this the default for its parent. Setting it clears the flag on the previous default.',
    },
    is_global: {
      ...ISGLOBAL48E7DF_OUTPUT,
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    logo_props: { ...LOGOPROPS06ABC6_OUTPUT, description: 'Logo props' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    page_ids: { ...PAGEIDSD23A08_OUTPUT, description: 'Ids of the associated pages.' },
    sort_order: {
      ...SORTORDER7C3A9E_OUTPUT,
      description: 'Manual ordering weight. Lower sorts first.',
    },
  },
}

const DESCRIPTION36D05F_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Free-form description.',
  optional: true,
}

const DISPLAYNAME940D5D_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The display name.',
  optional: true,
}

const EXTERNALIDBA2ED6_OUTPUT: OutputProperty = {
  type: 'string',
  description: "Your system's identifier for this record, for sync and import correlation.",
  optional: true,
}

const EXTERNALIDE53BCD_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'External Id',
  optional: true,
  nullable: true,
}

const EXTERNALSOURCEDF9B11_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The system `external_id` came from, for example `github` or `jira`.',
  optional: true,
}

const EXTERNALSOURCEEB04B9_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'External Source',
  optional: true,
  nullable: true,
}

const ISACTIVE8F30A3_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether the record is active.',
  optional: true,
}

const PROPERTYTYPE80786B_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The property type.',
  optional: true,
}

const DATA029D9C_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Customer- Properties',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      default_value: {
        type: 'array',
        description: 'The default value.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      display_name: { type: 'string', description: 'The display name.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_active: { type: 'boolean', description: 'Whether the record is active.', optional: true },
      is_multi: { type: 'boolean', description: 'Whether is multi.', optional: true },
      is_required: { type: 'boolean', description: 'Whether is required.', optional: true },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      options: {
        type: 'array',
        description: 'The options.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      property_type: { type: 'string', description: 'The property type.', optional: true },
      relation_type: {
        type: 'string',
        description: 'The relation type.',
        optional: true,
        nullable: true,
      },
      settings: { type: 'string', description: 'The settings.', optional: true, nullable: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      validation_rules: {
        type: 'string',
        description: 'The validation rules.',
        optional: true,
        nullable: true,
      },
    },
  },
}

const ARCHIVEDAT31CCCE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the record was archived, or `null` if it is active.',
  optional: true,
  nullable: true,
}

const CUSTOMERID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related customer.',
  optional: true,
}

const DESCRIPTIONHTML92A7E9_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
  optional: true,
}

const DATA22ACEC_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Customer- Requests',
    properties: {
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      customer_id: { type: 'string', description: 'The related customer.', optional: true },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      link: { type: 'string', description: 'The link.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
    },
  },
}

const CONTRACTSTATUS47B242_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Current contract state, in your own vocabulary.',
  optional: true,
}

const CUSTOMERREQUESTCOUNT53613D_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'How many customer requests are attached.',
  optional: true,
}

const DOMAIN08310A_OUTPUT: OutputProperty = {
  type: 'string',
  description: "The customer's primary domain, for example `example.com`.",
  optional: true,
}

const EMAIL0E37ED_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Email address.',
  optional: true,
}

const EMPLOYEESBDE09A_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Headcount, for segmentation.',
  optional: true,
}

const LOGOASSETID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related logo asset.',
  optional: true,
}

const LOGOURLE1F9CC_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'URL of the logo image.',
  optional: true,
}

const REVENUEDC4A8C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Annual revenue, for segmentation.',
  optional: true,
}

const STAGEF8ED88_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Where the customer sits in your funnel.',
  optional: true,
}

const WEBSITEURLDBBBFF_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Public website URL.',
  optional: true,
}

export const PLANEV2CUSTOMERS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Customers',
  optional: true,
  properties: {
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    contract_status: {
      ...CONTRACTSTATUS47B242_OUTPUT,
      description: 'Current contract state, in your own vocabulary.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    customer_request_count: {
      ...CUSTOMERREQUESTCOUNT53613D_OUTPUT,
      description: 'How many customer requests are attached.',
    },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    domain: {
      ...DOMAIN08310A_OUTPUT,
      description: "The customer's primary domain, for example `example.com`.",
    },
    email: { ...EMAIL0E37ED_OUTPUT, description: 'Email address.' },
    employees: { ...EMPLOYEESBDE09A_OUTPUT, description: 'Headcount, for segmentation.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    logo_asset_id: { ...LOGOASSETID_OUTPUT, description: 'The related logo asset.' },
    logo_props: { ...LOGOPROPS06ABC6_OUTPUT, description: 'Logo props' },
    logo_url: { ...LOGOURLE1F9CC_OUTPUT, description: 'URL of the logo image.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    revenue: { ...REVENUEDC4A8C_OUTPUT, description: 'Annual revenue, for segmentation.' },
    stage: { ...STAGEF8ED88_OUTPUT, description: 'Where the customer sits in your funnel.' },
    website_url: { ...WEBSITEURLDBBBFF_OUTPUT, description: 'Public website URL.' },
  },
}

const DATADDAF7A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Customers',
    properties: {
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      contract_status: {
        type: 'string',
        description: 'Current contract state, in your own vocabulary.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      customer_request_count: {
        type: 'number',
        description: 'How many customer requests are attached.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      domain: {
        type: 'string',
        description: "The customer's primary domain, for example `example.com`.",
        optional: true,
      },
      email: { type: 'string', description: 'Email address.', optional: true },
      employees: { type: 'number', description: 'Headcount, for segmentation.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      logo_asset_id: { type: 'string', description: 'The related logo asset.', optional: true },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      logo_url: { type: 'string', description: 'URL of the logo image.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      revenue: { type: 'string', description: 'Annual revenue, for segmentation.', optional: true },
      stage: {
        type: 'string',
        description: 'Where the customer sits in your funnel.',
        optional: true,
      },
      website_url: { type: 'string', description: 'Public website URL.', optional: true },
    },
  },
}

const RESULTSD78556_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Results',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Resultsitem',
    properties: {
      index: { type: 'number', description: 'Access', optional: true },
      result: { type: 'string', description: 'Asset Id', optional: true },
      id: { type: 'string', description: 'Asset Id', optional: true },
      type: { type: 'string', description: 'Asset Id', optional: true },
      code: { type: 'string', description: 'Asset Id', optional: true },
      detail: { type: 'string', description: 'Asset Id', optional: true },
      errors: {
        type: 'array',
        description: 'Errors',
        optional: true,
        items: {
          type: 'object',
          description: 'Plane V2 Errorsitem',
          properties: {
            field: { type: 'string', description: 'Asset Id', optional: true },
            code: { type: 'string', description: 'Asset Id', optional: true },
            message: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
    },
  },
}

const RESULTS0A57A3_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Results',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Resultsitem',
    properties: {
      index: { type: 'number', description: 'Access', optional: true },
      result: { type: 'string', description: 'Asset Id', optional: true },
      id: { type: 'string', description: 'Asset Id', optional: true },
      type: { type: 'string', description: 'Asset Id', optional: true },
      code: { type: 'string', description: 'Asset Id', optional: true },
      detail: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const IDC6BA9C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for the cycle.',
  optional: true,
}

const NAME55C8FE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Display name, unique within the project. Maximum 255 characters.',
  optional: true,
}

const DESCRIPTION1FAA98_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Free-form description of what the cycle covers.',
  optional: true,
}

const TIMEZONEC2812E_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    "The IANA time zone the cycle's dates are interpreted in, for example `America/New_York` or `UTC`. This is what makes a cycle boundary land at local midnight rather than UTC midnight for a distributed team.",
  optional: true,
}

const OWNEDBYID907EBB_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The user who owns the cycle. Read-only — assigned by Plane and not settable through the API. Use it to filter cycles on list.',
  optional: true,
}

const SORTORDER50AD65_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
}

const LOGOPROPSB439A5_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
}

const CREATEDAT8A8D4F_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the cycle was created.',
  optional: true,
}

const CREATEDBYIDDE9D3F_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The user who created the cycle.',
  optional: true,
}

const LOGOPROPSA76DCB_OUTPUT: OutputProperty = {
  type: 'json',
  description:
    "JSON blob holding the cycle's icon configuration, as written by Plane clients. Passed through unchanged.",
  optional: true,
  nullable: true,
}

const ESTIMATEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related estimate.',
  optional: true,
}

const KEYAAE3A0_OUTPUT: OutputProperty = { type: 'number', description: 'The key.', optional: true }

const VALUEF92DA1_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The value.',
  optional: true,
}

export const PLANEV2ESTIMATEPOINTS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Estimate- Points',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    estimate_id: { ...ESTIMATEID_OUTPUT, description: 'The related estimate.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    key: { ...KEYAAE3A0_OUTPUT, description: 'The key.' },
    value: { ...VALUEF92DA1_OUTPUT, description: 'The value.' },
  },
}

const DATA735E56_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Estimate- Points',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      estimate_id: { type: 'string', description: 'The related estimate.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      key: { type: 'number', description: 'The key.', optional: true },
      value: { type: 'string', description: 'The value.', optional: true },
    },
  },
}

const LASTUSED35601D_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether last used.',
  optional: true,
}

const TYPED8BD3A_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The type.',
  optional: true,
}

const AUTOREMOVE_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether auto remove.',
  optional: true,
}

const DEFAULTWORKSPACEROLESLUG_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The default workspace role slug.',
  optional: true,
}

const GROUPATTRIBUTEKEY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The group attribute key.',
  optional: true,
}

const ISENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether the rule is switched on.',
  optional: true,
}

const SYNCOFFLINE_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether sync offline.',
  optional: true,
}

const SYNCONLOGIN_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether sync on login.',
  optional: true,
}

const DATA73F281_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Group- Sync',
    properties: {
      auto_remove: { type: 'boolean', description: 'Whether auto remove.', optional: true },
      default_workspace_role_slug: {
        type: 'string',
        description: 'The default workspace role slug.',
        optional: true,
      },
      group_attribute_key: {
        type: 'string',
        description: 'The group attribute key.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_enabled: {
        type: 'boolean',
        description: 'Whether the rule is switched on.',
        optional: true,
      },
      sync_offline: { type: 'boolean', description: 'Whether sync offline.', optional: true },
      sync_on_login: { type: 'boolean', description: 'Whether sync on login.', optional: true },
      all_projects: { type: 'boolean', description: 'Has Pages', optional: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
      idp_group_name: { type: 'string', description: 'Asset Id', optional: true },
      project_id: { type: 'string', description: 'Asset Id', optional: true },
      role_slug: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DATA3412D8_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Group- Sync',
    properties: {
      auto_remove: { type: 'boolean', description: 'Whether auto remove.', optional: true },
      default_workspace_role_slug: {
        type: 'string',
        description: 'The default workspace role slug.',
        optional: true,
      },
      group_attribute_key: {
        type: 'string',
        description: 'The group attribute key.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_enabled: {
        type: 'boolean',
        description: 'Whether the rule is switched on.',
        optional: true,
      },
      sync_offline: { type: 'boolean', description: 'Whether sync offline.', optional: true },
      sync_on_login: { type: 'boolean', description: 'Whether sync on login.', optional: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
      idp_group_name: { type: 'string', description: 'Asset Id', optional: true },
      role_slug: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const COLOR3938EE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
  optional: true,
}

const DATA75CBC7_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Initiative- Labels',
    properties: {
      color: {
        type: 'string',
        description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
    },
  },
}

const LABELIDS7D9FA4_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated labels.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const LEADID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related lead.',
  optional: true,
}

const PROJECTIDSA92388_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated projects.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const STARTDATE43E866_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Planned start date, as `YYYY-MM-DD`.',
  optional: true,
}

const DUPLICATETOID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related duplicate to.',
  optional: true,
}

const INTAKEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related intake.',
  optional: true,
}

const PRIORITY0D388C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Urgency of the work item.',
  optional: true,
}

const STATEIDDDFC84_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related state.',
  optional: true,
}

const WORKITEMID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related work item.',
  optional: true,
}

const DATA4EDEAE_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Intake- Work- Items',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      duplicate_to_id: { type: 'string', description: 'The related duplicate to.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      intake_id: { type: 'string', description: 'The related intake.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      priority: { type: 'string', description: 'Urgency of the work item.', optional: true },
      snoozed_till: { type: 'string', description: 'The snoozed till.', optional: true },
      source: { type: 'string', description: 'The source.', optional: true },
      source_email: { type: 'string', description: 'The source email.', optional: true },
      state_id: { type: 'string', description: 'The related state.', optional: true },
      status: { type: 'number', description: 'The status.', optional: true },
      work_item_id: { type: 'string', description: 'The related work item.', optional: true },
    },
  },
}

const ACCEPTED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether accepted.',
  optional: true,
}

const MESSAGE498389_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The message.',
  optional: true,
}

const RESPONDEDAT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The responded at.',
  optional: true,
}

const DATAEB406F_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Invitations',
    properties: {
      accepted: { type: 'boolean', description: 'Whether accepted.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      email: { type: 'string', description: 'Email address.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      message: { type: 'string', description: 'The message.', optional: true },
      responded_at: { type: 'string', description: 'The responded at.', optional: true },
      role: { type: 'string', description: 'Role to grant.', optional: true },
    },
  },
}

const ID018DCE_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    "Unique identifier for the label. This is the value you send in a work item's `label_ids`.",
  optional: true,
}

const DESCRIPTION96165C_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Free-form note about what the label is for. Useful when a team needs a convention written down next to the tag.',
  optional: true,
}

const COLOR880284_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Hex color used wherever the label is rendered, for example `#e5484d`.',
  optional: true,
}

const SORTORDER8E4889_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
}

const CREATEDATA2B7A6_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the label was created.',
  optional: true,
}

export const PLANEV2LABELS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Labels',
  optional: true,
  properties: {
    id: {
      ...ID018DCE_OUTPUT,
      description:
        "Unique identifier for the label. This is the value you send in a work item's `label_ids`.",
    },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTION96165C_OUTPUT,
      description:
        'Free-form note about what the label is for. Useful when a team needs a convention written down next to the tag.',
    },
    color: {
      ...COLOR880284_OUTPUT,
      description: 'Hex color used wherever the label is rendered, for example `#e5484d`.',
    },
    sort_order: { ...SORTORDER8E4889_OUTPUT, description: 'Sort order' },
    parent_id: { ...CYCLE883343_OUTPUT, description: 'Parent id' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDATA2B7A6_OUTPUT, description: 'When the label was created.' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
  },
}

const DATA42995A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Labels',
    properties: {
      id: {
        type: 'string',
        description:
          "Unique identifier for the label. This is the value you send in a work item's `label_ids`.",
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Display name, unique within the project. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description:
          'Free-form note about what the label is for. Useful when a team needs a convention written down next to the tag.',
        optional: true,
      },
      color: {
        type: 'string',
        description: 'Hex color used wherever the label is rendered, for example `#e5484d`.',
        optional: true,
      },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      parent_id: {
        type: 'string',
        description:
          'The label this one nests under, letting you build groups such as an `Area` label with `Billing` and `Search` beneath it. `null` for a top-level label.',
        optional: true,
        nullable: true,
      },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the label was created.', optional: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

const IDDDD330_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the membership row — not for the user. The same person has one membership in the workspace and another in each project they belong to, so they have several `id` values but one `member_id`.',
  optional: true,
}

const MEMBERID_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The user this membership belongs to. This is the id that lines up with `created_by_id` on other objects, `assignee_ids` on work items, and `actor_id` in [audit logs](/api-reference/v2/audit-logs/overview). Join on `member_id`, never on `id`.',
  optional: true,
}

const ROLES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Roles',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Rolesitem',
    properties: {
      distinct_member_count: { type: 'number', description: 'Access', optional: true },
      is_system: { type: 'boolean', description: 'Has Pages', optional: true },
      level: { type: 'number', description: 'Access', optional: true },
      membership_count: { type: 'number', description: 'Access', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      role_id: { type: 'string', description: 'Asset Id', optional: true },
      slug: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DATA6057DF_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Members',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the membership row — not for the user. The same person has one membership in the workspace and another in each project they belong to, so they have several `id` values but one `member_id`.',
        optional: true,
      },
      member_id: {
        type: 'string',
        description:
          'The user this membership belongs to. This is the id that lines up with `created_by_id` on other objects, `assignee_ids` on work items, and `actor_id` in [audit logs](/api-reference/v2/audit-logs/overview). Join on `member_id`, never on `id`.',
        optional: true,
      },
      role: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      member: {
        type: 'object',
        description: 'Plane V2 Member',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          display_name: { type: 'string', description: 'Asset Id', optional: true },
          avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
          email: { type: 'string', description: 'Asset Id', optional: true },
        },
      },
    },
  },
}

const TARGETDATE7B0AB1_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Planned due date, as `YYYY-MM-DD`.',
  optional: true,
}

const TITLEF754B4_OUTPUT: OutputProperty = { type: 'string', description: 'Title.', optional: true }

export const PLANEV2MILESTONES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Milestones',
  optional: true,
  properties: {
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    target_date: { ...TARGETDATE7B0AB1_OUTPUT, description: 'Planned due date, as `YYYY-MM-DD`.' },
    title: { ...TITLEF754B4_OUTPUT, description: 'Title.' },
  },
}

const DATA7CF2D8_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Milestones',
    properties: {
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      target_date: {
        type: 'string',
        description: 'Planned due date, as `YYYY-MM-DD`.',
        optional: true,
      },
      title: { type: 'string', description: 'Title.', optional: true },
    },
  },
}

const IDA3C0E8_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for the module.',
  optional: true,
}

const DESCRIPTIONC3D3EB_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Plain-text summary of what the module covers.',
  optional: true,
}

const STATUS2FB7BA_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Where the module sits in its lifecycle. One of `backlog`, `planned`, `in-progress`, `paused`, `completed`, or `cancelled`.',
  optional: true,
}

const MEMBERIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'Project members assigned to the module. Read-only in v2 — module membership is not yet writable through the v2 API.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const ARCHIVEDATDD21A8_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the module was archived, or `null` for an active module.',
  optional: true,
  nullable: true,
}

const CREATEDATEAC330_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the module was created.',
  optional: true,
}

const CREATEDBYIDC85A02_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The user who created the module.',
  optional: true,
}

const MEMBERIDS840550_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'Project members assigned to the module. Read-only in v2 — module membership is not yet writable through the v2 API.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const SORTORDER6ECB16_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
}

const LOGOPROPSE3E3C2_OUTPUT: OutputProperty = {
  type: 'json',
  description:
    'Free-form JSON object holding the icon Plane renders for the module. `{}` when no icon is set.',
  optional: true,
  nullable: true,
}

const ISSYSTEM_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is system.',
  optional: true,
}

const NAMESPACE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The namespace.',
  optional: true,
}

const PERMISSIONS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'The permissions.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const SLUG_OUTPUT: OutputProperty = { type: 'string', description: 'The slug.', optional: true }

const SORTORDER5BF4DF_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Manual ordering weight. Lower sorts first.',
  optional: true,
}

export const PLANEV2PERMISSIONSCHEMES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Permission- Schemes',
  optional: true,
  properties: {
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_system: { ...ISSYSTEM_OUTPUT, description: 'Whether is system.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    namespace: { ...NAMESPACE_OUTPUT, description: 'The namespace.' },
    permissions: { ...PERMISSIONS_OUTPUT, description: 'The permissions.' },
    slug: { ...SLUG_OUTPUT, description: 'The slug.' },
    sort_order: {
      ...SORTORDER5BF4DF_OUTPUT,
      description: 'Manual ordering weight. Lower sorts first.',
    },
  },
}

const DATAFC3B83_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Permission- Schemes',
    properties: {
      description: { type: 'string', description: 'Free-form description.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_system: { type: 'boolean', description: 'Whether is system.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      namespace: { type: 'string', description: 'The namespace.', optional: true },
      permissions: {
        type: 'array',
        description: 'The permissions.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      slug: { type: 'string', description: 'The slug.', optional: true },
      sort_order: {
        type: 'number',
        description: 'Manual ordering weight. Lower sorts first.',
        optional: true,
      },
    },
  },
}

const ACTORID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related actor.',
  optional: true,
}

const AUTOMATIONEDGEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related automation edge.',
  optional: true,
}

const AUTOMATIONID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related automation.',
  optional: true,
}

const AUTOMATIONNODEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related automation node.',
  optional: true,
}

const AUTOMATIONRUNID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related automation run.',
  optional: true,
}

const AUTOMATIONSCOPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The automation scope.',
  optional: true,
}

const AUTOMATIONVERSIONID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related automation version.',
  optional: true,
}

const EPOCH0ECDBD_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'The epoch.',
  optional: true,
}

const FIELD956F5B_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The field.',
  optional: true,
}

const NEWIDENTIFIEREF5EA8_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The new identifier.',
  optional: true,
}

const NEWVALUE883A22_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The new value.',
  optional: true,
}

const NODEEXECUTIONID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related node execution.',
  optional: true,
}

const OLDIDENTIFIER58F8A4_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The old identifier.',
  optional: true,
}

const OLDVALUE91BC69_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The old value.',
  optional: true,
}

const VERBC42427_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The verb.',
  optional: true,
}

export const PLANEV2PROJECTAUTOMATIONS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCH0ECDBD_OUTPUT, description: 'The epoch.' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    execution_order: { ...ACCESS644595_OUTPUT, description: 'Execution order' },
    source_node_id: { ...ASSETID_OUTPUT, description: 'Source node id' },
    target_node_id: { ...ASSETID_OUTPUT, description: 'Target node id' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    version_id: { ...ASSETID_OUTPUT, description: 'Version id' },
  },
}

export const PLANEV2PROJECTAUTOMATIONSBFBFC7_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCH0ECDBD_OUTPUT, description: 'The epoch.' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
    config: { ...ID045D22_OUTPUT, description: 'Config' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    handler_name: { ...ASSETID_OUTPUT, description: 'Handler name' },
    is_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is enabled' },
    last_triggered_at: { ...ASSETID_OUTPUT, description: 'Last triggered at' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    next_scheduled_at: { ...ASSETID_OUTPUT, description: 'Next scheduled at' },
    node_type: { ...ID045D22_OUTPUT, description: 'Node type' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    version_id: { ...ASSETID_OUTPUT, description: 'Version id' },
  },
}

const PROJECTIDS76D572_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Project Ids',
  optional: true,
  items: { type: 'array', description: 'Default Value' },
}

export const PLANEV2PROJECTAUTOMATIONS88CD0D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCH0ECDBD_OUTPUT, description: 'The epoch.' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
    bot_user_id: { ...ASSETID_OUTPUT, description: 'Bot user id' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    current_version_id: { ...ASSETID_OUTPUT, description: 'Current version id' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    is_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is enabled' },
    is_global: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is global' },
    last_run_at: { ...ASSETID_OUTPUT, description: 'Last run at' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    project_ids: { ...PROJECTIDS76D572_OUTPUT, description: 'Project ids' },
    run_count: { ...ACCESS644595_OUTPUT, description: 'Run count' },
    scope: { ...ASSETID_OUTPUT, description: 'Scope' },
    status: { ...ASSETID_OUTPUT, description: 'Status' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

const EPOCHF145AB_OUTPUT: OutputProperty = { type: 'json', description: 'Epoch', optional: true }

export const PLANEV2PROJECTAUTOMATIONS5B2254_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCHF145AB_OUTPUT, description: 'Epoch' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
  },
}

const DATA762D1C_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'json', description: 'Epoch', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
    },
  },
}

const DATAB20D42_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'number', description: 'The epoch.', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      execution_order: { type: 'number', description: 'Access', optional: true },
      source_node_id: { type: 'string', description: 'Asset Id', optional: true },
      target_node_id: { type: 'string', description: 'Asset Id', optional: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
      version_id: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DATA7F9216_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'number', description: 'The epoch.', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      config: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      handler_name: { type: 'string', description: 'Asset Id', optional: true },
      is_enabled: { type: 'boolean', description: 'Has Pages', optional: true },
      last_triggered_at: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      next_scheduled_at: { type: 'string', description: 'Asset Id', optional: true },
      node_type: { type: 'json', description: 'Id', optional: true, nullable: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
      version_id: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DATA6BC005_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'number', description: 'The epoch.', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      bot_user_id: { type: 'string', description: 'Asset Id', optional: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      current_version_id: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      is_enabled: { type: 'boolean', description: 'Has Pages', optional: true },
      is_global: { type: 'boolean', description: 'Has Pages', optional: true },
      last_run_at: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      project_ids: {
        type: 'array',
        description: 'Project Ids',
        optional: true,
        items: { type: 'array', description: 'Default Value' },
      },
      run_count: { type: 'number', description: 'Access', optional: true },
      scope: { type: 'string', description: 'Asset Id', optional: true },
      status: { type: 'string', description: 'Asset Id', optional: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const ISLOCKEDCA86CF_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Prevents further edits to the content.',
  optional: true,
}

const PARENTID280851_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related parent.',
  optional: true,
}

const DISPLAYFILTERS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Saved display options — grouping, ordering and layout.',
  optional: true,
  nullable: true,
}

const DISPLAYPROPERTIES_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The display properties.',
  optional: true,
  nullable: true,
}

const FILTERS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Saved filter set, in the same shape the list endpoints accept.',
  optional: true,
  nullable: true,
}

const PQLFILTERS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The pql filters.',
  optional: true,
  nullable: true,
}

const QUERY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The query.',
  optional: true,
  nullable: true,
}

const ISPUBLISHED013D88_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is published.',
  optional: true,
}

const SHORTDESCRIPTION_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The short description.',
  optional: true,
}

const SHORTID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related short.',
  optional: true,
}

const TEMPLATEDATA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'The template data.',
  optional: true,
}

const TEMPLATETYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The template type.',
  optional: true,
}

export const PLANEV2PROJECTWORKITEMTEMPLATES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Work- Item- Templates',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_published: { ...ISPUBLISHED013D88_OUTPUT, description: 'Whether is published.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    short_description: { ...SHORTDESCRIPTION_OUTPUT, description: 'The short description.' },
    short_id: { ...SHORTID_OUTPUT, description: 'The related short.' },
    slug: { ...SLUG_OUTPUT, description: 'The slug.' },
    template_data: { ...TEMPLATEDATA_OUTPUT, description: 'The template data.' },
    template_type: { ...TEMPLATETYPE_OUTPUT, description: 'The template type.' },
  },
}

const DATABAA83A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Work- Item- Templates',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_published: { type: 'boolean', description: 'Whether is published.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      short_description: { type: 'string', description: 'The short description.', optional: true },
      short_id: { type: 'string', description: 'The related short.', optional: true },
      slug: { type: 'string', description: 'The slug.', optional: true },
      template_data: { type: 'json', description: 'The template data.', optional: true },
      template_type: { type: 'string', description: 'The template type.', optional: true },
    },
  },
}

const ARCHIVEIN875827_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'The archive in.',
  optional: true,
}

const CLOSEIN4103EE_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'The close in.',
  optional: true,
}

const COVERIMAGE1C99D0_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'URL of the cover image.',
  optional: true,
}

const COVERIMAGEURL4A1253_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The cover image url.',
  optional: true,
}

const CYCLEVIEW2B2A92_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether cycle view.',
  optional: true,
}

const DEFAULTASSIGNEEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related default assignee.',
  optional: true,
}

const DEFAULTSTATEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related default state.',
  optional: true,
}

const EMOJI40B5B7_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Emoji shown alongside the name.',
  optional: true,
}

const GUESTVIEWALLFEATURES786ECF_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether guest view all features.',
  optional: true,
}

const ICONPROP8D9DE6_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The icon prop.',
  optional: true,
  nullable: true,
}

const IDENTIFIER74E88F_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Short project key used to prefix work item numbers, for example `ENG` in `ENG-142`.',
  optional: true,
}

const INTAKEVIEWADF501_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether intake view.',
  optional: true,
}

const ISISSUETYPEENABLED0467A8_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is issue type enabled.',
  optional: true,
}

const ISTIMETRACKINGENABLEDC98808_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is time tracking enabled.',
  optional: true,
}

const ISSUEVIEWSVIEW9A6DA4_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether issue views view.',
  optional: true,
}

const MODULEVIEWFF7A9C_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether module view.',
  optional: true,
}

const NETWORKAB7E29_OUTPUT: OutputProperty = {
  type: 'number',
  description:
    'Project visibility: `0` is private to members, `2` is visible to the whole workspace.',
  optional: true,
}

const PAGEVIEW884451_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether page view.',
  optional: true,
}

const PROJECTLEADID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related project lead.',
  optional: true,
}

const TIMEZONE852348_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'IANA timezone name, for example `America/New_York`.',
  optional: true,
}

const COMMENTHTMLF4A8CB_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The comment html.',
  optional: true,
}

const COMMENTID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related comment.',
  optional: true,
}

const RELEASEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related release.',
  optional: true,
}

const DATAF71C33_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Release- Comments',
    properties: {
      comment_html: { type: 'string', description: 'The comment html.', optional: true },
      comment_id: { type: 'string', description: 'The related comment.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      edited_at: { type: 'string', description: 'The edited at.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_hidden: { type: 'boolean', description: 'Whether is hidden.', optional: true },
      is_resolved: { type: 'boolean', description: 'Whether is resolved.', optional: true },
      parent_id: { type: 'string', description: 'The related parent.', optional: true },
      release_id: { type: 'string', description: 'The related release.', optional: true },
    },
  },
}

const DATA1C20E4_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Release- Labels',
    properties: {
      color: {
        type: 'string',
        description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      sort_order: {
        type: 'number',
        description: 'Manual ordering weight. Lower sorts first.',
        optional: true,
      },
    },
  },
}

const URLC17248_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Target URL.',
  optional: true,
}

const DATA1F7F03_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Release- Links',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      metadata: { type: 'string', description: 'The metadata.', optional: true, nullable: true },
      release_id: { type: 'string', description: 'The related release.', optional: true },
      title: { type: 'string', description: 'Title.', optional: true },
      url: { type: 'string', description: 'Target URL.', optional: true },
    },
  },
}

const VERSION2A0489_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Version string, for example `1.4.0`.',
  optional: true,
}

const DATA202B62_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Release- Tags',
    properties: {
      commit_hash: { type: 'string', description: 'The commit hash.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      git_tag: { type: 'string', description: 'The git tag.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      version: {
        type: 'string',
        description: 'Version string, for example `1.4.0`.',
        optional: true,
      },
    },
  },
}

const DESCRIPTIONID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related description.',
  optional: true,
}

const ISLATEST2376D0_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is latest.',
  optional: true,
}

const ISPRERELEASE0A132B_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is prerelease.',
  optional: true,
}

const RELEASEDATE372B24_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The release date.',
  optional: true,
}

const STATUS56C139_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The status.',
  optional: true,
}

const TAGID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related tag.',
  optional: true,
}

const LABELIDS802308_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated labels.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const LEVEL320D43_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'The level.',
  optional: true,
}

const NAMESPACE02083C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The namespace.',
  optional: true,
  nullable: true,
}

export const PLANEV2ROLES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Roles',
  optional: true,
  properties: {
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_system: { ...ISSYSTEM_OUTPUT, description: 'Whether is system.' },
    level: { ...LEVEL320D43_OUTPUT, description: 'The level.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    namespace: { ...NAMESPACE02083C_OUTPUT, description: 'Namespace' },
    slug: { ...SLUG_OUTPUT, description: 'The slug.' },
    status: { ...STATUS56C139_OUTPUT, description: 'The status.' },
  },
}

const DATAC7747A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Roles',
    properties: {
      description: { type: 'string', description: 'Free-form description.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_system: { type: 'boolean', description: 'Whether is system.', optional: true },
      level: { type: 'number', description: 'The level.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      namespace: { type: 'string', description: 'The namespace.', optional: true, nullable: true },
      slug: { type: 'string', description: 'The slug.', optional: true },
      status: { type: 'string', description: 'The status.', optional: true },
    },
  },
}

const ID6ACB64_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for the state.',
  optional: true,
}

const DESCRIPTION5B24B0_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Free-form description of what the state means in this workflow.',
  optional: true,
}

const COLOR742473_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Hex color used wherever the state is rendered, for example `#3f76ff`.',
  optional: true,
}

const GROUPA33045_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The workflow group this state belongs to. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, or `triage`.',
  optional: true,
}

const SEQUENCE49DDCC_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sequence',
  optional: true,
}

const ISDEFAULT91F18A_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether new work items land in this state when no `state_id` is supplied. Exactly one state per project is the default.',
  optional: true,
}

const ISTRIAGE72BB4A_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    "Whether this is the project's triage state, used by intake. Read-only — a triage state is created and managed by Plane.",
  optional: true,
}

const CREATEDATCECA3C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the state was created.',
  optional: true,
}

const CREATEDBYID3BCA72_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The user who created the state.',
  optional: true,
}

export const PLANEV2STATES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 States',
  optional: true,
  properties: {
    id: { ...ID6ACB64_OUTPUT, description: 'Unique identifier for the state.' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTION5B24B0_OUTPUT,
      description: 'Free-form description of what the state means in this workflow.',
    },
    color: {
      ...COLOR742473_OUTPUT,
      description: 'Hex color used wherever the state is rendered, for example `#3f76ff`.',
    },
    group: {
      ...GROUPA33045_OUTPUT,
      description:
        'The workflow group this state belongs to. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, or `triage`.',
    },
    sequence: { ...SEQUENCE49DDCC_OUTPUT, description: 'Sequence' },
    is_default: {
      ...ISDEFAULT91F18A_OUTPUT,
      description:
        'Whether new work items land in this state when no `state_id` is supplied. Exactly one state per project is the default.',
    },
    is_triage: {
      ...ISTRIAGE72BB4A_OUTPUT,
      description:
        "Whether this is the project's triage state, used by intake. Read-only — a triage state is created and managed by Plane.",
    },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDATCECA3C_OUTPUT, description: 'When the state was created.' },
    created_by_id: { ...CREATEDBYID3BCA72_OUTPUT, description: 'The user who created the state.' },
  },
}

const DATA283BBF_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 States',
    properties: {
      id: { type: 'string', description: 'Unique identifier for the state.', optional: true },
      name: {
        type: 'string',
        description: 'Display name, unique within the project. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description: 'Free-form description of what the state means in this workflow.',
        optional: true,
      },
      color: {
        type: 'string',
        description: 'Hex color used wherever the state is rendered, for example `#3f76ff`.',
        optional: true,
      },
      group: {
        type: 'string',
        description:
          'The workflow group this state belongs to. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, or `triage`.',
        optional: true,
      },
      sequence: { type: 'json', description: 'Sequence', optional: true },
      is_default: {
        type: 'boolean',
        description:
          'Whether new work items land in this state when no `state_id` is supplied. Exactly one state per project is the default.',
        optional: true,
      },
      is_triage: {
        type: 'boolean',
        description:
          "Whether this is the project's triage state, used by intake. Read-only — a triage state is created and managed by Plane.",
        optional: true,
      },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the state was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the state.',
        optional: true,
      },
    },
  },
}

const OWNERID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related owner.',
  optional: true,
}

const DATADEC467_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Stickies',
    properties: {
      background_color: { type: 'string', description: 'The background color.', optional: true },
      color: {
        type: 'string',
        description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      description_stripped: {
        type: 'string',
        description: 'The description stripped.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      owner_id: { type: 'string', description: 'The related owner.', optional: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
    },
  },
}

const MEMBERIDS139E2A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated members.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const ASSETURL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The asset url.',
  optional: true,
}

const ATTRIBUTES2FF54B_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The attributes.',
  optional: true,
  nullable: true,
}

const CONTENTTYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The content type.',
  optional: true,
}

const ENTITYTYPE7582D6_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The entity type.',
  optional: true,
}

const ISUPLOADEDB45807_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether is uploaded.',
  optional: true,
}

const SIZE422D69_OUTPUT: OutputProperty = { type: 'json', description: 'Size', optional: true }

const USERID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related user.',
  optional: true,
}

export const PLANEV2USERASSETS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 User- Assets',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES2FF54B_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    entity_type: { ...ENTITYTYPE7582D6_OUTPUT, description: 'The entity type.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
    user_id: { ...USERID_OUTPUT, description: 'The related user.' },
  },
}

const DATA02BF8D_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 User- Assets',
    properties: {
      asset_url: { type: 'string', description: 'The asset url.', optional: true },
      attributes: {
        type: 'string',
        description: 'The attributes.',
        optional: true,
        nullable: true,
      },
      content_type: { type: 'string', description: 'The content type.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      entity_type: { type: 'string', description: 'The entity type.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_uploaded: { type: 'boolean', description: 'Whether is uploaded.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      size: { type: 'json', description: 'Size', optional: true },
      user_id: { type: 'string', description: 'The related user.', optional: true },
    },
  },
}

const DURATIONMS_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'The duration ms.',
  optional: true,
}

const ERRORMESSAGE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The error message.',
  optional: true,
}

const EVENTTYPE_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The event type.',
  optional: true,
}

const REQUESTBODY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The request body.',
  optional: true,
}

const REQUESTHEADERS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The request headers.',
  optional: true,
}

const REQUESTMETHOD_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The request method.',
  optional: true,
}

const RESPONSEBODY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The response body.',
  optional: true,
}

const RESPONSEHEADERS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The response headers.',
  optional: true,
}

const RESPONSESTATUS_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The response status.',
  optional: true,
}

const RETRYCOUNT_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'How many retrys are attached.',
  optional: true,
}

const STATUSTEXT_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The status text.',
  optional: true,
}

const WEBHOOKID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related webhook.',
  optional: true,
}

export const PLANEV2WEBHOOKLOGS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Webhook- Logs',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    duration_ms: { ...DURATIONMS_OUTPUT, description: 'The duration ms.' },
    error_message: { ...ERRORMESSAGE_OUTPUT, description: 'The error message.' },
    event_type: { ...EVENTTYPE_OUTPUT, description: 'The event type.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    request_body: { ...REQUESTBODY_OUTPUT, description: 'The request body.' },
    request_headers: { ...REQUESTHEADERS_OUTPUT, description: 'The request headers.' },
    request_method: { ...REQUESTMETHOD_OUTPUT, description: 'The request method.' },
    response_body: { ...RESPONSEBODY_OUTPUT, description: 'The response body.' },
    response_headers: { ...RESPONSEHEADERS_OUTPUT, description: 'The response headers.' },
    response_status: { ...RESPONSESTATUS_OUTPUT, description: 'The response status.' },
    retry_count: { ...RETRYCOUNT_OUTPUT, description: 'How many retrys are attached.' },
    status_text: { ...STATUSTEXT_OUTPUT, description: 'The status text.' },
    webhook_id: { ...WEBHOOKID_OUTPUT, description: 'The related webhook.' },
  },
}

const DATA5085A5_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Webhook- Logs',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      duration_ms: { type: 'number', description: 'The duration ms.', optional: true },
      error_message: { type: 'string', description: 'The error message.', optional: true },
      event_type: { type: 'string', description: 'The event type.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      request_body: { type: 'string', description: 'The request body.', optional: true },
      request_headers: { type: 'string', description: 'The request headers.', optional: true },
      request_method: { type: 'string', description: 'The request method.', optional: true },
      response_body: { type: 'string', description: 'The response body.', optional: true },
      response_headers: { type: 'string', description: 'The response headers.', optional: true },
      response_status: { type: 'string', description: 'The response status.', optional: true },
      retry_count: { type: 'number', description: 'How many retrys are attached.', optional: true },
      status_text: { type: 'string', description: 'The status text.', optional: true },
      webhook_id: { type: 'string', description: 'The related webhook.', optional: true },
    },
  },
}

const SCOPES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'The scopes.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

export const PLANEV2WEBHOOKS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Webhooks',
  optional: true,
  properties: {
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_active: { ...ISACTIVE8F30A3_OUTPUT, description: 'Whether the record is active.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    scopes: { ...SCOPES_OUTPUT, description: 'The scopes.' },
    url: { ...URLC17248_OUTPUT, description: 'Target URL.' },
    version: { ...VERSION2A0489_OUTPUT, description: 'Version string, for example `1.4.0`.' },
  },
}

const DATA956B74_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Webhooks',
    properties: {
      content_type: { type: 'string', description: 'The content type.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_active: { type: 'boolean', description: 'Whether the record is active.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      scopes: {
        type: 'array',
        description: 'The scopes.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      url: { type: 'string', description: 'Target URL.', optional: true },
      version: {
        type: 'string',
        description: 'Version string, for example `1.4.0`.',
        optional: true,
      },
    },
  },
}

const DURATIONCEC84D_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Time logged, in minutes.',
  optional: true,
}

const ISSUECOMMENTID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related issue comment.',
  optional: true,
}

const NEWIDENTIFIERID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related new identifier.',
  optional: true,
}

const OLDIDENTIFIERID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related old identifier.',
  optional: true,
}

export const PLANEV2WORKITEMATTACHMENTS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Attachments',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES2FF54B_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
  },
}

const DATAE25E41_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Attachments',
    properties: {
      asset_url: { type: 'string', description: 'The asset url.', optional: true },
      attributes: {
        type: 'string',
        description: 'The attributes.',
        optional: true,
        nullable: true,
      },
      content_type: { type: 'string', description: 'The content type.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_uploaded: { type: 'boolean', description: 'Whether is uploaded.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      size: { type: 'json', description: 'Size', optional: true },
      work_item_id: { type: 'string', description: 'The related work item.', optional: true },
    },
  },
}

const IDDDC529_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for the comment.',
  optional: true,
}

const WORKITEMIDA2FC32_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The work item this comment is attached to. Always matches the `work_item_id` in the request path.',
  optional: true,
}

const COMMENTHTML2D6EFC_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The comment body, as HTML. This is the field you write.',
  optional: true,
}

const COMMENTSTRIPPED14F41E_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The plain-text version of `comment_html`, derived server-side. It is what `?search=` matches, so markup never affects a search hit. Read-only — you never send it.',
  optional: true,
}

const ACCESSC9A263_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Visibility of the comment. One of `INTERNAL` or `EXTERNAL`. `INTERNAL` keeps the comment inside the project team; `EXTERNAL` marks it as visible outside the team, for example on a published project.',
  optional: true,
}

const CREATEDAT899C85_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the comment was created.',
  optional: true,
}

const DATA8C69BA_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Links',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      metadata: { type: 'string', description: 'The metadata.', optional: true, nullable: true },
      title: { type: 'string', description: 'Title.', optional: true },
      url: { type: 'string', description: 'Target URL.', optional: true },
      work_item_id: { type: 'string', description: 'The related work item.', optional: true },
    },
  },
}

const ID064459_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the property. This is the id you pass when attaching the property to a type or managing its options.',
  optional: true,
}

const NAME160A8C_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The machine-readable slug for the property, derived by Plane. Read-only — it is not a create or update body field. Use it when you need a stable key in your own storage.',
  optional: true,
}

const DISPLAYNAME049711_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The human-readable label shown wherever the property is rendered. This is the field you **write** on create and update. Maximum 255 characters.',
  optional: true,
}

const DESCRIPTIONA4AEE3_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Free-form explanation of what the field is for. Surfaced as helper text next to the field.',
  optional: true,
}

const PROPERTYTYPED8DF30_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'What kind of data the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. See the [property type reference](#property-type-reference) below.',
  optional: true,
}

const ISMULTI384CDD_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the property accepts more than one value. A multi-select severity list, a set of assignable reviewers, several linked work items.',
  optional: true,
}

const ISREQUIREDCA803A_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether a value must be present. Turning this on for an existing property affects work items edited from then on — it does not retroactively fill in the blanks.',
  optional: true,
}

const ISACTIVE2FD6EB_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the property is currently offered. Deactivating is the reversible alternative to deleting: the definition and its recorded values stay, the field stops being offered on new edits.',
  optional: true,
}

const DEFAULTVALUEAE4C66_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The value applied when none is supplied. Always an array, even for a single-valued property — a decimal that defaults to `3` is `["3"]`, not `3`.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const OPTIONS4C14D1_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'For `OPTION` properties, the resolved list of choices. Each entry is a property option object with its own `id`, `name`, `is_default`, and `sort_order`. Manage them through [Property options](/api-reference/v2/work-item-property-options/list-property-options), or define them inline when you [create the property](/api-reference/v2/work-item-properties/create-work-item-property).',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true },
      sort_order: { type: 'number', description: 'Access', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

const SETTINGS850707_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
}

const VALIDATIONRULES5A366B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Validation Rules',
  optional: true,
}

const LOGOPROPS495565_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
}

const CREATEDAT1A7DFD_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the property was created.',
  optional: true,
}

export const PLANEV2WORKITEMPROPERTIES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Properties',
  optional: true,
  properties: {
    id: {
      ...ID064459_OUTPUT,
      description:
        'Unique identifier for the property. This is the id you pass when attaching the property to a type or managing its options.',
    },
    name: {
      ...NAME160A8C_OUTPUT,
      description:
        'The machine-readable slug for the property, derived by Plane. Read-only — it is not a create or update body field. Use it when you need a stable key in your own storage.',
    },
    display_name: {
      ...DISPLAYNAME049711_OUTPUT,
      description:
        'The human-readable label shown wherever the property is rendered. This is the field you **write** on create and update. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTIONA4AEE3_OUTPUT,
      description:
        'Free-form explanation of what the field is for. Surfaced as helper text next to the field.',
    },
    property_type: {
      ...PROPERTYTYPED8DF30_OUTPUT,
      description:
        'What kind of data the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. See the [property type reference](#property-type-reference) below.',
    },
    relation_type: { ...CYCLE883343_OUTPUT, description: 'Relation type' },
    is_multi: {
      ...ISMULTI384CDD_OUTPUT,
      description:
        'Whether the property accepts more than one value. A multi-select severity list, a set of assignable reviewers, several linked work items.',
    },
    is_required: {
      ...ISREQUIREDCA803A_OUTPUT,
      description:
        'Whether a value must be present. Turning this on for an existing property affects work items edited from then on — it does not retroactively fill in the blanks.',
    },
    is_active: {
      ...ISACTIVE2FD6EB_OUTPUT,
      description:
        'Whether the property is currently offered. Deactivating is the reversible alternative to deleting: the definition and its recorded values stay, the field stops being offered on new edits.',
    },
    default_value: {
      ...DEFAULTVALUEAE4C66_OUTPUT,
      description:
        'The value applied when none is supplied. Always an array, even for a single-valued property — a decimal that defaults to `3` is `["3"]`, not `3`.',
    },
    options: {
      ...OPTIONS4C14D1_OUTPUT,
      description:
        'For `OPTION` properties, the resolved list of choices. Each entry is a property option object with its own `id`, `name`, `is_default`, and `sort_order`. Manage them through [Property options](/api-reference/v2/work-item-property-options/list-property-options), or define them inline when you [create the property](/api-reference/v2/work-item-properties/create-work-item-property).',
    },
    settings: { ...SETTINGS850707_OUTPUT, description: 'Settings' },
    validation_rules: { ...VALIDATIONRULES5A366B_OUTPUT, description: 'Validation rules' },
    logo_props: { ...LOGOPROPS495565_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1A7DFD_OUTPUT, description: 'When the property was created.' },
  },
}

const DATA6FD798_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Properties',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the property. This is the id you pass when attaching the property to a type or managing its options.',
        optional: true,
      },
      name: {
        type: 'string',
        description:
          'The machine-readable slug for the property, derived by Plane. Read-only — it is not a create or update body field. Use it when you need a stable key in your own storage.',
        optional: true,
      },
      display_name: {
        type: 'string',
        description:
          'The human-readable label shown wherever the property is rendered. This is the field you **write** on create and update. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description:
          'Free-form explanation of what the field is for. Surfaced as helper text next to the field.',
        optional: true,
      },
      property_type: {
        type: 'string',
        description:
          'What kind of data the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. See the [property type reference](#property-type-reference) below.',
        optional: true,
      },
      relation_type: {
        type: 'string',
        description:
          'What a `RELATION` property points at. One of `ISSUE`, `USER`, `RELEASE`, or `RICH_TEXT`. `null` for every other property type.',
        optional: true,
        nullable: true,
      },
      is_multi: {
        type: 'boolean',
        description:
          'Whether the property accepts more than one value. A multi-select severity list, a set of assignable reviewers, several linked work items.',
        optional: true,
      },
      is_required: {
        type: 'boolean',
        description:
          'Whether a value must be present. Turning this on for an existing property affects work items edited from then on — it does not retroactively fill in the blanks.',
        optional: true,
      },
      is_active: {
        type: 'boolean',
        description:
          'Whether the property is currently offered. Deactivating is the reversible alternative to deleting: the definition and its recorded values stay, the field stops being offered on new edits.',
        optional: true,
      },
      default_value: {
        type: 'array',
        description:
          'The value applied when none is supplied. Always an array, even for a single-valued property — a decimal that defaults to `3` is `["3"]`, not `3`.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      options: {
        type: 'array',
        description:
          'For `OPTION` properties, the resolved list of choices. Each entry is a property option object with its own `id`, `name`, `is_default`, and `sort_order`. Manage them through [Property options](/api-reference/v2/work-item-property-options/list-property-options), or define them inline when you [create the property](/api-reference/v2/work-item-properties/create-work-item-property).',
        optional: true,
        items: {
          type: 'object',
          description: 'Plane V2 Optionsitem',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            description: { type: 'string', description: 'Asset Id', optional: true },
            is_default: { type: 'boolean', description: 'Has Pages', optional: true },
            sort_order: { type: 'number', description: 'Access', optional: true },
            external_id: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
            external_source: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
          },
        },
      },
      settings: { type: 'json', description: 'Settings', optional: true },
      validation_rules: { type: 'json', description: 'Validation Rules', optional: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the property was created.', optional: true },
    },
  },
}

const OPTIONS7065D6_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'For `OPTION` properties, the resolved list of choices. Each entry is a property option object with its own `id`, `name`, `is_default`, and `sort_order`. Manage them through [Property options](/api-reference/v2/work-item-property-options/list-property-options), or define them inline when you [create the property](/api-reference/v2/work-item-properties/create-work-item-property).',
  optional: true,
  items: { type: 'json', description: 'Logo Props' },
}

export const PLANEV2WORKITEMPROPERTIESA758D8_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Properties',
  optional: true,
  properties: {
    id: {
      ...ID064459_OUTPUT,
      description:
        'Unique identifier for the property. This is the id you pass when attaching the property to a type or managing its options.',
    },
    name: {
      ...NAME160A8C_OUTPUT,
      description:
        'The machine-readable slug for the property, derived by Plane. Read-only — it is not a create or update body field. Use it when you need a stable key in your own storage.',
    },
    display_name: {
      ...DISPLAYNAME049711_OUTPUT,
      description:
        'The human-readable label shown wherever the property is rendered. This is the field you **write** on create and update. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTIONA4AEE3_OUTPUT,
      description:
        'Free-form explanation of what the field is for. Surfaced as helper text next to the field.',
    },
    property_type: {
      ...PROPERTYTYPED8DF30_OUTPUT,
      description:
        'What kind of data the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. See the [property type reference](#property-type-reference) below.',
    },
    relation_type: { ...CYCLE883343_OUTPUT, description: 'Relation type' },
    is_multi: {
      ...ISMULTI384CDD_OUTPUT,
      description:
        'Whether the property accepts more than one value. A multi-select severity list, a set of assignable reviewers, several linked work items.',
    },
    is_required: {
      ...ISREQUIREDCA803A_OUTPUT,
      description:
        'Whether a value must be present. Turning this on for an existing property affects work items edited from then on — it does not retroactively fill in the blanks.',
    },
    is_active: {
      ...ISACTIVE2FD6EB_OUTPUT,
      description:
        'Whether the property is currently offered. Deactivating is the reversible alternative to deleting: the definition and its recorded values stay, the field stops being offered on new edits.',
    },
    default_value: {
      ...DEFAULTVALUEAE4C66_OUTPUT,
      description:
        'The value applied when none is supplied. Always an array, even for a single-valued property — a decimal that defaults to `3` is `["3"]`, not `3`.',
    },
    options: {
      ...OPTIONS7065D6_OUTPUT,
      description:
        'For `OPTION` properties, the resolved list of choices. Each entry is a property option object with its own `id`, `name`, `is_default`, and `sort_order`. Manage them through [Property options](/api-reference/v2/work-item-property-options/list-property-options), or define them inline when you [create the property](/api-reference/v2/work-item-properties/create-work-item-property).',
    },
    settings: { ...SETTINGS850707_OUTPUT, description: 'Settings' },
    validation_rules: { ...VALIDATIONRULES5A366B_OUTPUT, description: 'Validation rules' },
    logo_props: { ...LOGOPROPS495565_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1A7DFD_OUTPUT, description: 'When the property was created.' },
  },
}

const IDA47990_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Unique identifier for the context.',
  optional: true,
}

const NAME798D5E_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Display name, unique among the contexts of this property. Maximum 255 characters.',
  optional: true,
}

const ISREQUIREDA7B30D_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    "Whether the property must be filled in inside this scope. Overrides the property's own `is_required`.",
  optional: true,
}

const ISMULTI43F4E4_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    "Whether the property accepts several values inside this scope. Overrides the property's own `is_multi`.",
  optional: true,
}

const ISDEFAULTD933ED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    '`true` on the context Plane seeded with the property. It is a marker only — precedence is decided by the scope flags, not by this field.',
  optional: true,
}

const DEFAULTVALUE89F953_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'Values applied when a work item in this scope has nothing set. For `OPTION` properties, options in this context flagged `is_default` take precedence over this array.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const SETTINGS1F98F7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
}

const SORTORDER3F92A1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
}

const APPLIESTOALLPROJECTS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'When `true`, the context covers every project in the workspace and `project_ids` is empty. When `false`, `project_ids` is the exact list of projects covered.',
  optional: true,
}

const APPLIESTOALLWORKITEMTYPES_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'When `true`, the context covers every work item type and `issue_type_ids` is empty. When `false`, `issue_type_ids` is the exact list of types covered.',
  optional: true,
}

const CREATEDAT55504E_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the context was created.',
  optional: true,
}

const PROJECTIDS2BDF86_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The ids of the projects this context covers. Empty when `applies_to_all_projects` is `true` — read the flag before reading this list.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const ISSUETYPEIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The ids of the work item types this context covers. Empty when `applies_to_all_work_item_types` is `true`.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const OPTIONS614FA5_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The choices this context offers for an `OPTION` property. Each entry has `id`, `name`, `is_default`, and `sort_order`. Options belong to a context, not to the property, so two contexts on the same property can offer different lists.',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true },
      sort_order: { type: 'number', description: 'Access', optional: true },
    },
  },
}

export const PLANEV2WORKITEMPROPERTYCONTEXTS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Property- Contexts',
  optional: true,
  properties: {
    id: { ...IDA47990_OUTPUT, description: 'Unique identifier for the context.' },
    name: {
      ...NAME798D5E_OUTPUT,
      description:
        'Display name, unique among the contexts of this property. Maximum 255 characters.',
    },
    is_required: {
      ...ISREQUIREDA7B30D_OUTPUT,
      description:
        "Whether the property must be filled in inside this scope. Overrides the property's own `is_required`.",
    },
    is_multi: {
      ...ISMULTI43F4E4_OUTPUT,
      description:
        "Whether the property accepts several values inside this scope. Overrides the property's own `is_multi`.",
    },
    is_default: {
      ...ISDEFAULTD933ED_OUTPUT,
      description:
        '`true` on the context Plane seeded with the property. It is a marker only — precedence is decided by the scope flags, not by this field.',
    },
    default_value: {
      ...DEFAULTVALUE89F953_OUTPUT,
      description:
        'Values applied when a work item in this scope has nothing set. For `OPTION` properties, options in this context flagged `is_default` take precedence over this array.',
    },
    settings: { ...SETTINGS1F98F7_OUTPUT, description: 'Settings' },
    sort_order: { ...SORTORDER3F92A1_OUTPUT, description: 'Sort order' },
    applies_to_all_projects: {
      ...APPLIESTOALLPROJECTS_OUTPUT,
      description:
        'When `true`, the context covers every project in the workspace and `project_ids` is empty. When `false`, `project_ids` is the exact list of projects covered.',
    },
    applies_to_all_work_item_types: {
      ...APPLIESTOALLWORKITEMTYPES_OUTPUT,
      description:
        'When `true`, the context covers every work item type and `issue_type_ids` is empty. When `false`, `issue_type_ids` is the exact list of types covered.',
    },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT55504E_OUTPUT, description: 'When the context was created.' },
    project_ids: {
      ...PROJECTIDS2BDF86_OUTPUT,
      description:
        'The ids of the projects this context covers. Empty when `applies_to_all_projects` is `true` — read the flag before reading this list.',
    },
    issue_type_ids: {
      ...ISSUETYPEIDS_OUTPUT,
      description:
        'The ids of the work item types this context covers. Empty when `applies_to_all_work_item_types` is `true`.',
    },
    options: {
      ...OPTIONS614FA5_OUTPUT,
      description:
        'The choices this context offers for an `OPTION` property. Each entry has `id`, `name`, `is_default`, and `sort_order`. Options belong to a context, not to the property, so two contexts on the same property can offer different lists.',
    },
  },
}

const DATA62C3E9_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Property- Contexts',
    properties: {
      id: { type: 'string', description: 'Unique identifier for the context.', optional: true },
      name: {
        type: 'string',
        description:
          'Display name, unique among the contexts of this property. Maximum 255 characters.',
        optional: true,
      },
      is_required: {
        type: 'boolean',
        description:
          "Whether the property must be filled in inside this scope. Overrides the property's own `is_required`.",
        optional: true,
      },
      is_multi: {
        type: 'boolean',
        description:
          "Whether the property accepts several values inside this scope. Overrides the property's own `is_multi`.",
        optional: true,
      },
      is_default: {
        type: 'boolean',
        description:
          '`true` on the context Plane seeded with the property. It is a marker only — precedence is decided by the scope flags, not by this field.',
        optional: true,
      },
      default_value: {
        type: 'array',
        description:
          'Values applied when a work item in this scope has nothing set. For `OPTION` properties, options in this context flagged `is_default` take precedence over this array.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      settings: { type: 'json', description: 'Settings', optional: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      applies_to_all_projects: {
        type: 'boolean',
        description:
          'When `true`, the context covers every project in the workspace and `project_ids` is empty. When `false`, `project_ids` is the exact list of projects covered.',
        optional: true,
      },
      applies_to_all_work_item_types: {
        type: 'boolean',
        description:
          'When `true`, the context covers every work item type and `issue_type_ids` is empty. When `false`, `issue_type_ids` is the exact list of types covered.',
        optional: true,
      },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the context was created.', optional: true },
      project_ids: {
        type: 'array',
        description:
          'The ids of the projects this context covers. Empty when `applies_to_all_projects` is `true` — read the flag before reading this list.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      issue_type_ids: {
        type: 'array',
        description:
          'The ids of the work item types this context covers. Empty when `applies_to_all_work_item_types` is `true`.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      options: {
        type: 'array',
        description:
          'The choices this context offers for an `OPTION` property. Each entry has `id`, `name`, `is_default`, and `sort_order`. Options belong to a context, not to the property, so two contexts on the same property can offer different lists.',
        optional: true,
        items: {
          type: 'object',
          description: 'Plane V2 Optionsitem',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            is_default: { type: 'boolean', description: 'Has Pages', optional: true },
            sort_order: { type: 'number', description: 'Access', optional: true },
          },
        },
      },
    },
  },
}

const NAME85421B_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The label shown in the picker, for example `Critical`. Maximum 255 characters.',
  optional: true,
}

const DATA313B27_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Property- Options',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the option. This is the value stored on a work item when someone picks this choice, so treat it as the stable handle and `name` as the label.',
        optional: true,
      },
      name: {
        type: 'string',
        description:
          'The label shown in the picker, for example `Critical`. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description:
          "Free-form explanation of what the option means. Useful when a choice needs a definition that a one-word label can't carry.",
        optional: true,
      },
      is_default: {
        type: 'boolean',
        description:
          'Whether this option is preselected when a work item is created without an explicit value for the property.',
        optional: true,
      },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

const IDA6F76C_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the property. This is the id you send to attach it, and the `pk` you delete to detach it.',
  optional: true,
}

const NAMEAFAB81_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Machine-readable name, slugified by Plane from `display_name`. Use `id` for lookups — `name` follows the label.',
  optional: true,
}

const DISPLAYNAME58548F_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The label shown on the work item form.',
  optional: true,
}

const PROPERTYTYPE7CF2B6_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. This is the field to branch on when you build an input or parse a value.',
  optional: true,
}

const ISREQUIRED70D220_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether a value must be supplied on work items of a type that exposes this property.',
  optional: true,
}

const ISMULTI1E30E9_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether the property holds several values instead of one.',
  optional: true,
}

const ISACTIVEDF34FA_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the property is currently enabled. This lives on the property, not on the link — deactivating affects every type the property is attached to, while detaching affects only one type.',
  optional: true,
}

const DEFAULTVALUEB60AD4_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'Values applied when a work item is created without an explicit value for this property.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const SETTINGSE31826_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
}

const VALIDATIONRULES78F33A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Validation Rules',
  optional: true,
}

const LOGOPROPS5DC883_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
}

const OPTIONSF3E53F_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'For an `OPTION` property, its selectable options inline — each with `id`, `name`, `description`, `is_default`, `sort_order`, `external_id`, and `external_source`. An empty array for every other `property_type`. Manage them with [Property options](/api-reference/v2/work-item-property-options/overview).',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true },
      sort_order: { type: 'number', description: 'Access', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

export const PLANEV2WORKITEMTYPEPROPERTIES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Type- Properties',
  optional: true,
  properties: {
    id: {
      ...IDA6F76C_OUTPUT,
      description:
        'Unique identifier for the property. This is the id you send to attach it, and the `pk` you delete to detach it.',
    },
    name: {
      ...NAMEAFAB81_OUTPUT,
      description:
        'Machine-readable name, slugified by Plane from `display_name`. Use `id` for lookups — `name` follows the label.',
    },
    display_name: {
      ...DISPLAYNAME58548F_OUTPUT,
      description: 'The label shown on the work item form.',
    },
    description: { ...CYCLE883343_OUTPUT, description: 'Description' },
    property_type: {
      ...PROPERTYTYPE7CF2B6_OUTPUT,
      description:
        'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. This is the field to branch on when you build an input or parse a value.',
    },
    relation_type: { ...CYCLE883343_OUTPUT, description: 'Relation type' },
    is_required: {
      ...ISREQUIRED70D220_OUTPUT,
      description:
        'Whether a value must be supplied on work items of a type that exposes this property.',
    },
    is_multi: {
      ...ISMULTI1E30E9_OUTPUT,
      description: 'Whether the property holds several values instead of one.',
    },
    is_active: {
      ...ISACTIVEDF34FA_OUTPUT,
      description:
        'Whether the property is currently enabled. This lives on the property, not on the link — deactivating affects every type the property is attached to, while detaching affects only one type.',
    },
    default_value: {
      ...DEFAULTVALUEB60AD4_OUTPUT,
      description:
        'Values applied when a work item is created without an explicit value for this property.',
    },
    settings: { ...SETTINGSE31826_OUTPUT, description: 'Settings' },
    validation_rules: { ...VALIDATIONRULES78F33A_OUTPUT, description: 'Validation rules' },
    logo_props: { ...LOGOPROPS5DC883_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1A7DFD_OUTPUT, description: 'When the property was created.' },
    options: {
      ...OPTIONSF3E53F_OUTPUT,
      description:
        'For an `OPTION` property, its selectable options inline — each with `id`, `name`, `description`, `is_default`, `sort_order`, `external_id`, and `external_source`. An empty array for every other `property_type`. Manage them with [Property options](/api-reference/v2/work-item-property-options/overview).',
    },
  },
}

const DATAD55667_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Type- Properties',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the property. This is the id you send to attach it, and the `pk` you delete to detach it.',
        optional: true,
      },
      name: {
        type: 'string',
        description:
          'Machine-readable name, slugified by Plane from `display_name`. Use `id` for lookups — `name` follows the label.',
        optional: true,
      },
      display_name: {
        type: 'string',
        description: 'The label shown on the work item form.',
        optional: true,
      },
      description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      property_type: {
        type: 'string',
        description:
          'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. This is the field to branch on when you build an input or parse a value.',
        optional: true,
      },
      relation_type: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      is_required: {
        type: 'boolean',
        description:
          'Whether a value must be supplied on work items of a type that exposes this property.',
        optional: true,
      },
      is_multi: {
        type: 'boolean',
        description: 'Whether the property holds several values instead of one.',
        optional: true,
      },
      is_active: {
        type: 'boolean',
        description:
          'Whether the property is currently enabled. This lives on the property, not on the link — deactivating affects every type the property is attached to, while detaching affects only one type.',
        optional: true,
      },
      default_value: {
        type: 'array',
        description:
          'Values applied when a work item is created without an explicit value for this property.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      settings: { type: 'json', description: 'Settings', optional: true },
      validation_rules: { type: 'json', description: 'Validation Rules', optional: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the property was created.', optional: true },
      options: {
        type: 'array',
        description:
          'For an `OPTION` property, its selectable options inline — each with `id`, `name`, `description`, `is_default`, `sort_order`, `external_id`, and `external_source`. An empty array for every other `property_type`. Manage them with [Property options](/api-reference/v2/work-item-property-options/overview).',
        optional: true,
        items: {
          type: 'object',
          description: 'Plane V2 Optionsitem',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            description: { type: 'string', description: 'Asset Id', optional: true },
            is_default: { type: 'boolean', description: 'Has Pages', optional: true },
            sort_order: { type: 'number', description: 'Access', optional: true },
            external_id: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
            external_source: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
          },
        },
      },
    },
  },
}

const ID9503BB_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the type. This is the value you send as `type_id` when creating a work item, and the `{type_id}` in the type-properties paths.',
  optional: true,
}

const NAME75D552_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Display name, for example `Bug`. Maximum 255 characters.',
  optional: true,
}

const DESCRIPTION0CAF0F_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Free-form explanation of when this type should be used. Worth filling in — an integration or agent reading the [schema endpoint](/api-reference/v2/work-item-types/get-work-item-type-schema) sees this text as `type_description` and uses it to choose between types.',
  optional: true,
}

const ISACTIVE8A5EC5_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the type can be assigned to new work items. Deactivating a type hides it from pickers without deleting it or touching the work items that already use it.',
  optional: true,
}

const ISDEFAULT13E882_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether new work items land on this type when no `type_id` is supplied. Exactly one type per project holds the flag. It is not writable through create or update — move it with [Mark a work item type as default](/api-reference/v2/work-item-types/mark-default-work-item-type).',
  optional: true,
}

const ISEPICBB1A89_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    "Whether this is the project's epic type. Read-only — epics are provisioned by Plane, not authored through this endpoint.",
  optional: true,
}

const LEVELCA2598_OUTPUT: OutputProperty = { type: 'json', description: 'Level', optional: true }

const LOGOPROPSE15605_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
}

const CREATEDATF6A685_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the type was created.',
  optional: true,
}

export const PLANEV2WORKITEMTYPES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Types',
  optional: true,
  properties: {
    id: {
      ...ID9503BB_OUTPUT,
      description:
        'Unique identifier for the type. This is the value you send as `type_id` when creating a work item, and the `{type_id}` in the type-properties paths.',
    },
    name: {
      ...NAME75D552_OUTPUT,
      description: 'Display name, for example `Bug`. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTION0CAF0F_OUTPUT,
      description:
        'Free-form explanation of when this type should be used. Worth filling in — an integration or agent reading the [schema endpoint](/api-reference/v2/work-item-types/get-work-item-type-schema) sees this text as `type_description` and uses it to choose between types.',
    },
    is_active: {
      ...ISACTIVE8A5EC5_OUTPUT,
      description:
        'Whether the type can be assigned to new work items. Deactivating a type hides it from pickers without deleting it or touching the work items that already use it.',
    },
    is_default: {
      ...ISDEFAULT13E882_OUTPUT,
      description:
        'Whether new work items land on this type when no `type_id` is supplied. Exactly one type per project holds the flag. It is not writable through create or update — move it with [Mark a work item type as default](/api-reference/v2/work-item-types/mark-default-work-item-type).',
    },
    is_epic: {
      ...ISEPICBB1A89_OUTPUT,
      description:
        "Whether this is the project's epic type. Read-only — epics are provisioned by Plane, not authored through this endpoint.",
    },
    level: { ...LEVELCA2598_OUTPUT, description: 'Level' },
    logo_props: { ...LOGOPROPSE15605_OUTPUT, description: 'Logo props' },
    created_at: { ...CREATEDATF6A685_OUTPUT, description: 'When the type was created.' },
  },
}

const PLANEV2ICON_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Icon',
  optional: true,
  properties: {
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    background_color: { ...ASSETID_OUTPUT, description: 'Background color' },
  },
}

const PLANEV2TYPELOGOPROPS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Type Logo Props',
  optional: true,
  properties: {
    in_use: { ...ASSETID_OUTPUT, description: 'In use' },
    icon: { ...PLANEV2ICON_OUTPUT, description: 'Icon' },
  },
}

const PLANEV2NAME_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Name',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    max_length: { ...ACCESS644595_OUTPUT, description: 'Max length' },
  },
}

const PLANEV2DESCRIPTIONHTML_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Description Html',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
  },
}

const OPTIONS58CC7C_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Options',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      value: { type: 'string', description: 'Asset Id', optional: true },
      label: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const PLANEV2PRIORITY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Priority',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    default: { ...ASSETID_OUTPUT, description: 'Default' },
    options: { ...OPTIONS58CC7C_OUTPUT, description: 'Options' },
  },
}

const OPTIONS09AB48_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Options',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      color: { type: 'string', description: 'Asset Id', optional: true },
      group: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const PLANEV2STATEID_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 State Id',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    options: { ...OPTIONS09AB48_OUTPUT, description: 'Options' },
  },
}

const OPTIONSF9BF03_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Options',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      display_name: { type: 'string', description: 'Asset Id', optional: true },
      email: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const PLANEV2ASSIGNEEIDS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Assignee Ids',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    is_multi: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is multi' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    options: { ...OPTIONSF9BF03_OUTPUT, description: 'Options' },
  },
}

const OPTIONSCE8924_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Options',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      color: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const PLANEV2LABELIDS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Label Ids',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    is_multi: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is multi' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    options: { ...OPTIONSCE8924_OUTPUT, description: 'Options' },
  },
}

const PLANEV2STARTDATE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Start Date',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    format: { ...ASSETID_OUTPUT, description: 'Format' },
  },
}

const PLANEV2TARGETDATE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Target Date',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
    format: { ...ASSETID_OUTPUT, description: 'Format' },
  },
}

const PLANEV2PARENTID_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Parent Id',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    required: { ...HASPAGES8E2BC3_OUTPUT, description: 'Required' },
  },
}

const PLANEV2FIELDS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Fields',
  optional: true,
  properties: {
    name: { ...PLANEV2NAME_OUTPUT, description: 'Name' },
    description_html: { ...PLANEV2DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    priority: { ...PLANEV2PRIORITY_OUTPUT, description: 'Priority' },
    state_id: { ...PLANEV2STATEID_OUTPUT, description: 'State id' },
    assignee_ids: { ...PLANEV2ASSIGNEEIDS_OUTPUT, description: 'Assignee ids' },
    label_ids: { ...PLANEV2LABELIDS_OUTPUT, description: 'Label ids' },
    start_date: { ...PLANEV2STARTDATE_OUTPUT, description: 'Start date' },
    target_date: { ...PLANEV2TARGETDATE_OUTPUT, description: 'Target date' },
    parent_id: { ...PLANEV2PARENTID_OUTPUT, description: 'Parent id' },
  },
}

const DATA1BA868_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Types',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the type. This is the value you send as `type_id` when creating a work item, and the `{type_id}` in the type-properties paths.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Display name, for example `Bug`. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description:
          'Free-form explanation of when this type should be used. Worth filling in — an integration or agent reading the [schema endpoint](/api-reference/v2/work-item-types/get-work-item-type-schema) sees this text as `type_description` and uses it to choose between types.',
        optional: true,
      },
      is_active: {
        type: 'boolean',
        description:
          'Whether the type can be assigned to new work items. Deactivating a type hides it from pickers without deleting it or touching the work items that already use it.',
        optional: true,
      },
      is_default: {
        type: 'boolean',
        description:
          'Whether new work items land on this type when no `type_id` is supplied. Exactly one type per project holds the flag. It is not writable through create or update — move it with [Mark a work item type as default](/api-reference/v2/work-item-types/mark-default-work-item-type).',
        optional: true,
      },
      is_epic: {
        type: 'boolean',
        description:
          "Whether this is the project's epic type. Read-only — epics are provisioned by Plane, not authored through this endpoint.",
        optional: true,
      },
      level: { type: 'json', description: 'Level', optional: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true },
      created_at: { type: 'string', description: 'When the type was created.', optional: true },
    },
  },
}

const LOGGEDBYID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related logged by.',
  optional: true,
}

const UPDATEDAT579FB8_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the record last changed.',
  optional: true,
}

const IDB23E78_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
  optional: true,
}

const NAME6F7B53_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Title of the work item. Maximum 255 characters.',
  optional: true,
}

const IDENTIFIER4F4557_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
  optional: true,
}

const SEQUENCEIDFB3D8D_OUTPUT: OutputProperty = {
  type: 'number',
  description: "The work item's number within its project. Assigned by Plane and never reused.",
  optional: true,
}

const PRIORITYDCA6CE_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
  optional: true,
}

const STATEID55C66B_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The workflow state the work item is currently in.',
  optional: true,
}

const ASSIGNEEIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'User ids assigned to the work item. Empty array when unassigned.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const LABELIDS958CBC_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Label ids applied to the work item. Empty array when unlabeled.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const PARENTIDE65D55_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
  optional: true,
  nullable: true,
}

const ISDRAFT88B48C_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
  optional: true,
}

const CREATEDAT083E6E_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the work item was created.',
  optional: true,
}

const CUSTOMFIELDS9C1322_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const ARCHIVEDAT90ED0E_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'When the work item was archived, or `null` if it is active. See [Archiving](#archiving-and-deleting).',
  optional: true,
  nullable: true,
}

const ASSIGNEESE6F198_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Assignees',
  optional: true,
  items: {
    type: 'object',
    description: 'Assignees Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      display_name: { type: 'string', description: 'Asset Id', optional: true },
      avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      email: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const LABELSAFCC9F_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Labels',
  optional: true,
  items: {
    type: 'object',
    description: 'Labels Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      color: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const PARENTC31FEB_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Parent',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    sequence_id: { type: 'number', description: 'Access', optional: true },
  },
  nullable: true,
}

const STATEF1F313_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'State',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    color: { type: 'string', description: 'Asset Id', optional: true },
    group: { type: 'string', description: 'Asset Id', optional: true },
  },
  nullable: true,
}

const TYPEF949C2_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Type',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    logo_props: { type: 'json', description: 'Logo Props', optional: true },
    is_epic: { type: 'boolean', description: 'Has Pages', optional: true },
  },
  nullable: true,
}

const SEQUENCEID3A1EAC_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sequence Id',
  optional: true,
}

const ASSIGNEEIDS2DE275_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'User ids assigned to the work item. Empty array when unassigned.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const LABELIDS16374A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Label ids applied to the work item. Empty array when unlabeled.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

const ALLOWISSUECREATION_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether allow issue creation.',
  optional: true,
}

const WORKFLOWID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related workflow.',
  optional: true,
}

export const PLANEV2WORKFLOWSTATES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workflow- States',
  optional: true,
  properties: {
    allow_issue_creation: {
      ...ALLOWISSUECREATION_OUTPUT,
      description: 'Whether allow issue creation.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_default: {
      ...ISDEFAULT779508_OUTPUT,
      description:
        'Make this the default for its parent. Setting it clears the flag on the previous default.',
    },
    state_id: { ...STATEIDDDFC84_OUTPUT, description: 'The related state.' },
    type: { ...TYPED8BD3A_OUTPUT, description: 'The type.' },
    workflow_id: { ...WORKFLOWID_OUTPUT, description: 'The related workflow.' },
  },
}

const DATAA8C811_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workflow- States',
    properties: {
      allow_issue_creation: {
        type: 'boolean',
        description: 'Whether allow issue creation.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_default: {
        type: 'boolean',
        description:
          'Make this the default for its parent. Setting it clears the flag on the previous default.',
        optional: true,
      },
      state_id: { type: 'string', description: 'The related state.', optional: true },
      type: { type: 'string', description: 'The type.', optional: true },
      workflow_id: { type: 'string', description: 'The related workflow.', optional: true },
    },
  },
}

const REJECTIONSTATEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related rejection state.',
  optional: true,
}

const REQUIREDAPPROVALS_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'How many approvals a transition needs before it may run.',
  optional: true,
}

const TRANSITIONSTATEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related transition state.',
  optional: true,
}

const WORKFLOWSTATEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related workflow state.',
  optional: true,
}

export const PLANEV2WORKFLOWTRANSITIONS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workflow- Transitions',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    member_ids: { ...MEMBERIDS139E2A_OUTPUT, description: 'Ids of the associated members.' },
    rejection_state_id: { ...REJECTIONSTATEID_OUTPUT, description: 'The related rejection state.' },
    required_approvals: {
      ...REQUIREDAPPROVALS_OUTPUT,
      description: 'How many approvals a transition needs before it may run.',
    },
    transition_state_id: {
      ...TRANSITIONSTATEID_OUTPUT,
      description: 'The related transition state.',
    },
    workflow_state_id: { ...WORKFLOWSTATEID_OUTPUT, description: 'The related workflow state.' },
  },
}

const DATA76A8FD_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workflow- Transitions',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      member_ids: {
        type: 'array',
        description: 'Ids of the associated members.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      rejection_state_id: {
        type: 'string',
        description: 'The related rejection state.',
        optional: true,
      },
      required_approvals: {
        type: 'number',
        description: 'How many approvals a transition needs before it may run.',
        optional: true,
      },
      transition_state_id: {
        type: 'string',
        description: 'The related transition state.',
        optional: true,
      },
      workflow_state_id: {
        type: 'string',
        description: 'The related workflow state.',
        optional: true,
      },
    },
  },
}

const WORKITEMTYPEIDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Ids of the associated work item types.',
  optional: true,
  items: { type: 'json', description: 'Page Ids Item' },
}

export const PLANEV2WORKFLOWS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workflows',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_active: { ...ISACTIVE8F30A3_OUTPUT, description: 'Whether the record is active.' },
    is_default: {
      ...ISDEFAULT779508_OUTPUT,
      description:
        'Make this the default for its parent. Setting it clears the flag on the previous default.',
    },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    work_item_type_ids: {
      ...WORKITEMTYPEIDS_OUTPUT,
      description: 'Ids of the associated work item types.',
    },
  },
}

const DATA88DC10_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workflows',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_active: { type: 'boolean', description: 'Whether the record is active.', optional: true },
      is_default: {
        type: 'boolean',
        description:
          'Make this the default for its parent. Setting it clears the flag on the previous default.',
        optional: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      work_item_type_ids: {
        type: 'array',
        description: 'Ids of the associated work item types.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
    },
  },
}

export const PLANEV2WORKSPACEASSETS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Assets',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES2FF54B_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    entity_type: { ...ENTITYTYPE7582D6_OUTPUT, description: 'The entity type.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
  },
}

const DATAB73DB2_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Assets',
    properties: {
      asset_url: { type: 'string', description: 'The asset url.', optional: true },
      attributes: {
        type: 'string',
        description: 'The attributes.',
        optional: true,
        nullable: true,
      },
      content_type: { type: 'string', description: 'The content type.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      entity_type: { type: 'string', description: 'The entity type.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_uploaded: { type: 'boolean', description: 'Whether is uploaded.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      size: { type: 'json', description: 'Size', optional: true },
    },
  },
}

export const PLANEV2WORKSPACEAUTOMATIONS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCH0ECDBD_OUTPUT, description: 'The epoch.' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    execution_order: { ...ACCESS644595_OUTPUT, description: 'Execution order' },
    source_node_id: { ...ASSETID_OUTPUT, description: 'Source node id' },
    target_node_id: { ...ASSETID_OUTPUT, description: 'Target node id' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    version_id: { ...ASSETID_OUTPUT, description: 'Version id' },
  },
}

export const PLANEV2WORKSPACEAUTOMATIONS96AC73_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCH0ECDBD_OUTPUT, description: 'The epoch.' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
    config: { ...ID045D22_OUTPUT, description: 'Config' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    handler_name: { ...ASSETID_OUTPUT, description: 'Handler name' },
    is_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is enabled' },
    last_triggered_at: { ...ASSETID_OUTPUT, description: 'Last triggered at' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    next_scheduled_at: { ...ASSETID_OUTPUT, description: 'Next scheduled at' },
    node_type: { ...ID045D22_OUTPUT, description: 'Node type' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    version_id: { ...ASSETID_OUTPUT, description: 'Version id' },
  },
}

export const PLANEV2WORKSPACEAUTOMATIONS86A400_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCH0ECDBD_OUTPUT, description: 'The epoch.' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
    bot_user_id: { ...ASSETID_OUTPUT, description: 'Bot user id' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    current_version_id: { ...ASSETID_OUTPUT, description: 'Current version id' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    is_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is enabled' },
    is_global: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is global' },
    last_run_at: { ...ASSETID_OUTPUT, description: 'Last run at' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    project_ids: { ...PROJECTIDS76D572_OUTPUT, description: 'Project ids' },
    run_count: { ...ACCESS644595_OUTPUT, description: 'Run count' },
    scope: { ...ASSETID_OUTPUT, description: 'Scope' },
    status: { ...ASSETID_OUTPUT, description: 'Status' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2WORKSPACEAUTOMATIONSA3E54D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Automations',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    automation_edge_id: { ...AUTOMATIONEDGEID_OUTPUT, description: 'The related automation edge.' },
    automation_id: { ...AUTOMATIONID_OUTPUT, description: 'The related automation.' },
    automation_node_id: { ...AUTOMATIONNODEID_OUTPUT, description: 'The related automation node.' },
    automation_run_id: { ...AUTOMATIONRUNID_OUTPUT, description: 'The related automation run.' },
    automation_scope: { ...AUTOMATIONSCOPE_OUTPUT, description: 'The automation scope.' },
    automation_version_id: {
      ...AUTOMATIONVERSIONID_OUTPUT,
      description: 'The related automation version.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    epoch: { ...EPOCHF145AB_OUTPUT, description: 'Epoch' },
    field: { ...FIELD956F5B_OUTPUT, description: 'The field.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    new_identifier: { ...NEWIDENTIFIEREF5EA8_OUTPUT, description: 'The new identifier.' },
    new_value: { ...NEWVALUE883A22_OUTPUT, description: 'The new value.' },
    node_execution_id: { ...NODEEXECUTIONID_OUTPUT, description: 'The related node execution.' },
    old_identifier: { ...OLDIDENTIFIER58F8A4_OUTPUT, description: 'The old identifier.' },
    old_value: { ...OLDVALUE91BC69_OUTPUT, description: 'The old value.' },
    verb: { ...VERBC42427_OUTPUT, description: 'The verb.' },
  },
}

const DATA92A59E_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'json', description: 'Epoch', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
    },
  },
}

const DATAEDFCAE_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'number', description: 'The epoch.', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      execution_order: { type: 'number', description: 'Access', optional: true },
      source_node_id: { type: 'string', description: 'Asset Id', optional: true },
      target_node_id: { type: 'string', description: 'Asset Id', optional: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
      version_id: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DATA23F884_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'number', description: 'The epoch.', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      config: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      handler_name: { type: 'string', description: 'Asset Id', optional: true },
      is_enabled: { type: 'boolean', description: 'Has Pages', optional: true },
      last_triggered_at: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      next_scheduled_at: { type: 'string', description: 'Asset Id', optional: true },
      node_type: { type: 'json', description: 'Id', optional: true, nullable: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
      version_id: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const DATA307069_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Automations',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      automation_edge_id: {
        type: 'string',
        description: 'The related automation edge.',
        optional: true,
      },
      automation_id: { type: 'string', description: 'The related automation.', optional: true },
      automation_node_id: {
        type: 'string',
        description: 'The related automation node.',
        optional: true,
      },
      automation_run_id: {
        type: 'string',
        description: 'The related automation run.',
        optional: true,
      },
      automation_scope: { type: 'string', description: 'The automation scope.', optional: true },
      automation_version_id: {
        type: 'string',
        description: 'The related automation version.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      epoch: { type: 'number', description: 'The epoch.', optional: true },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      new_identifier: { type: 'string', description: 'The new identifier.', optional: true },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      node_execution_id: {
        type: 'string',
        description: 'The related node execution.',
        optional: true,
      },
      old_identifier: { type: 'string', description: 'The old identifier.', optional: true },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      bot_user_id: { type: 'string', description: 'Asset Id', optional: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      current_version_id: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      is_enabled: { type: 'boolean', description: 'Has Pages', optional: true },
      is_global: { type: 'boolean', description: 'Has Pages', optional: true },
      last_run_at: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      project_ids: {
        type: 'array',
        description: 'Project Ids',
        optional: true,
        items: { type: 'array', description: 'Default Value' },
      },
      run_count: { type: 'number', description: 'Access', optional: true },
      scope: { type: 'string', description: 'Asset Id', optional: true },
      status: { type: 'string', description: 'Asset Id', optional: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const IDDE4ACB_OUTPUT: OutputProperty = {
  type: 'string',
  description: "Unique identifier for the workspace's feature record.",
  optional: true,
}

const ISWORKITEMTYPESENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether work item types are managed at the **workspace** level. `true` means workspace mode — types and properties are defined once for the workspace and imported into projects. `false` means project mode — each project owns its own types. This is the field to read before any type or property write. See [Work item type modes](/api-reference/v2/work-item-type-modes).',
  optional: true,
}

const WORKITEMTYPEDEFAULTLEVEL_OUTPUT: OutputProperty = {
  type: 'number',
  description:
    'The default level applied to work item types in this workspace. The schema constrains it to an integer and declares no enum, so treat any value as legal and leave it as returned unless you are deliberately changing type levels.',
  optional: true,
}

const ISWORKITEMHIERARCHYENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether work items can be nested into a parent and child hierarchy in this workspace.',
  optional: true,
}

const ISPROJECTGROUPINGENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether projects can be organized into groups in the workspace.',
  optional: true,
}

const ISTEAMSENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether teamspaces are available. Teamspaces have their own endpoints under the `teamspaces:*` scopes.',
  optional: true,
}

const ISWIKIENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether the workspace-level wiki is available, behind the `wiki.pages:*` scopes.',
  optional: true,
}

const ISINITIATIVEENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether initiatives — the layer that groups projects and epics toward a larger outcome — are available.',
  optional: true,
}

const ISCUSTOMERENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether customers and customer requests are available, behind the `customers:*` scopes.',
  optional: true,
}

const ISRELEASEENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether releases are available, behind the `releases:*` scopes.',
  optional: true,
}

const ISSTATEDURATIONENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether Plane records how long work items spend in each state.',
  optional: true,
}

const ISPIENABLED_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: "Whether Pi, Plane's AI assistant, is available in the workspace.",
  optional: true,
}

const CREATEDAT15F92D_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'When the feature record was created.',
  optional: true,
}

const ID48A7C1_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    "Unique identifier for the property. This is the id you use in a context's payload and when attaching the property to a workspace work item type.",
  optional: true,
}

const NAME7AF2FF_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Read-only companion to `display_name`. You never set it directly.',
  optional: true,
}

const DISPLAYNAME6BC0BD_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'The label shown wherever the property is rendered. This is the field you write. Maximum 255 characters.',
  optional: true,
}

const PROPERTYTYPEDF003B_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. This is the one decision worth getting right up front — it determines what the other fields mean.',
  optional: true,
}

const ISREQUIRED0A4AE5_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether a value must be supplied for this property.',
  optional: true,
}

const ISMULTI9EF865_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Whether the property accepts more than one value.',
  optional: true,
}

const ISACTIVE76D2F2_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the property is in use. Set it to `false` to retire a property without deleting it.',
  optional: true,
}

const DEFAULTVALUE2B7EA7_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The value applied when none is supplied. Always an array, even when `is_multi` is `false`.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
}

const OPTIONSC1B74C_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The choices for an `OPTION` property. Read-only on this object — manage the list through [Property options](/api-reference/v2/workspace-work-item-property-options/overview), or seed it at create time with the write-only `options` body field.',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true },
      sort_order: { type: 'number', description: 'Access', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

const SETTINGS78B010_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
}

const VALIDATIONRULES5F1BF4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Validation Rules',
  optional: true,
}

const LOGOPROPS912598_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
}

export const PLANEV2WORKSPACEWORKITEMPROPERTIES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Work- Item- Properties',
  optional: true,
  properties: {
    id: {
      ...ID48A7C1_OUTPUT,
      description:
        "Unique identifier for the property. This is the id you use in a context's payload and when attaching the property to a workspace work item type.",
    },
    name: {
      ...NAME7AF2FF_OUTPUT,
      description: 'Read-only companion to `display_name`. You never set it directly.',
    },
    display_name: {
      ...DISPLAYNAME6BC0BD_OUTPUT,
      description:
        'The label shown wherever the property is rendered. This is the field you write. Maximum 255 characters.',
    },
    description: { ...CYCLE883343_OUTPUT, description: 'Description' },
    property_type: {
      ...PROPERTYTYPEDF003B_OUTPUT,
      description:
        'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. This is the one decision worth getting right up front — it determines what the other fields mean.',
    },
    relation_type: { ...CYCLE883343_OUTPUT, description: 'Relation type' },
    is_required: {
      ...ISREQUIRED0A4AE5_OUTPUT,
      description: 'Whether a value must be supplied for this property.',
    },
    is_multi: {
      ...ISMULTI9EF865_OUTPUT,
      description: 'Whether the property accepts more than one value.',
    },
    is_active: {
      ...ISACTIVE76D2F2_OUTPUT,
      description:
        'Whether the property is in use. Set it to `false` to retire a property without deleting it.',
    },
    default_value: {
      ...DEFAULTVALUE2B7EA7_OUTPUT,
      description:
        'The value applied when none is supplied. Always an array, even when `is_multi` is `false`.',
    },
    options: {
      ...OPTIONSC1B74C_OUTPUT,
      description:
        'The choices for an `OPTION` property. Read-only on this object — manage the list through [Property options](/api-reference/v2/workspace-work-item-property-options/overview), or seed it at create time with the write-only `options` body field.',
    },
    settings: { ...SETTINGS78B010_OUTPUT, description: 'Settings' },
    validation_rules: { ...VALIDATIONRULES5F1BF4_OUTPUT, description: 'Validation rules' },
    logo_props: { ...LOGOPROPS912598_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1A7DFD_OUTPUT, description: 'When the property was created.' },
  },
}

const DATAC76CC1_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Work- Item- Properties',
    properties: {
      id: {
        type: 'string',
        description:
          "Unique identifier for the property. This is the id you use in a context's payload and when attaching the property to a workspace work item type.",
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Read-only companion to `display_name`. You never set it directly.',
        optional: true,
      },
      display_name: {
        type: 'string',
        description:
          'The label shown wherever the property is rendered. This is the field you write. Maximum 255 characters.',
        optional: true,
      },
      description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      property_type: {
        type: 'string',
        description:
          'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. This is the one decision worth getting right up front — it determines what the other fields mean.',
        optional: true,
      },
      relation_type: {
        type: 'string',
        description:
          'For a `RELATION` property, what the property points at. One of `ISSUE`, `USER`, `RELEASE`, or `RICH_TEXT`. `null` for every other property type.',
        optional: true,
        nullable: true,
      },
      is_required: {
        type: 'boolean',
        description: 'Whether a value must be supplied for this property.',
        optional: true,
      },
      is_multi: {
        type: 'boolean',
        description: 'Whether the property accepts more than one value.',
        optional: true,
      },
      is_active: {
        type: 'boolean',
        description:
          'Whether the property is in use. Set it to `false` to retire a property without deleting it.',
        optional: true,
      },
      default_value: {
        type: 'array',
        description:
          'The value applied when none is supplied. Always an array, even when `is_multi` is `false`.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      options: {
        type: 'array',
        description:
          'The choices for an `OPTION` property. Read-only on this object — manage the list through [Property options](/api-reference/v2/workspace-work-item-property-options/overview), or seed it at create time with the write-only `options` body field.',
        optional: true,
        items: {
          type: 'object',
          description: 'Plane V2 Optionsitem',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            description: { type: 'string', description: 'Asset Id', optional: true },
            is_default: { type: 'boolean', description: 'Has Pages', optional: true },
            sort_order: { type: 'number', description: 'Access', optional: true },
            external_id: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
            external_source: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
          },
        },
      },
      settings: { type: 'json', description: 'Settings', optional: true },
      validation_rules: { type: 'json', description: 'Validation Rules', optional: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the property was created.', optional: true },
    },
  },
}

const ID2E1BEA_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the option. This is the value you store when you set the property on a work item, so treat it as the stable handle — `name` is only a label.',
  optional: true,
}

const NAME1B19B2_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The choice as it is displayed. Maximum 255 characters.',
  optional: true,
}

const DESCRIPTIONA7BFC7_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Free-form text explaining when to pick this choice.',
  optional: true,
}

const ISDEFAULT69D320_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    "Whether this is the property's default choice. At most one option per property can carry it.",
  optional: true,
}

const SORTORDERB58F19_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
}

export const PLANEV2WORKSPACEWORKITEMPROPERTYOPTIONS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Work- Item- Property- Options',
  optional: true,
  properties: {
    id: {
      ...ID2E1BEA_OUTPUT,
      description:
        'Unique identifier for the option. This is the value you store when you set the property on a work item, so treat it as the stable handle — `name` is only a label.',
    },
    name: {
      ...NAME1B19B2_OUTPUT,
      description: 'The choice as it is displayed. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTIONA7BFC7_OUTPUT,
      description: 'Free-form text explaining when to pick this choice.',
    },
    is_default: {
      ...ISDEFAULT69D320_OUTPUT,
      description:
        "Whether this is the property's default choice. At most one option per property can carry it.",
    },
    sort_order: { ...SORTORDERB58F19_OUTPUT, description: 'Sort order' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
  },
}

const DATAEEE2F9_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Work- Item- Property- Options',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the option. This is the value you store when you set the property on a work item, so treat it as the stable handle — `name` is only a label.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'The choice as it is displayed. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description: 'Free-form text explaining when to pick this choice.',
        optional: true,
      },
      is_default: {
        type: 'boolean',
        description:
          "Whether this is the property's default choice. At most one option per property can carry it.",
        optional: true,
      },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

export const PLANEV2WORKSPACEWORKITEMTEMPLATES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Work- Item- Templates',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_published: { ...ISPUBLISHED013D88_OUTPUT, description: 'Whether is published.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    short_description: { ...SHORTDESCRIPTION_OUTPUT, description: 'The short description.' },
    short_id: { ...SHORTID_OUTPUT, description: 'The related short.' },
    slug: { ...SLUG_OUTPUT, description: 'The slug.' },
    template_data: { ...TEMPLATEDATA_OUTPUT, description: 'The template data.' },
    template_type: { ...TEMPLATETYPE_OUTPUT, description: 'The template type.' },
  },
}

const DATA99D8D4_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Work- Item- Templates',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_published: { type: 'boolean', description: 'Whether is published.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      short_description: { type: 'string', description: 'The short description.', optional: true },
      short_id: { type: 'string', description: 'The related short.', optional: true },
      slug: { type: 'string', description: 'The slug.', optional: true },
      template_data: { type: 'json', description: 'The template data.', optional: true },
      template_type: { type: 'string', description: 'The template type.', optional: true },
    },
  },
}

const IDC46B46_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the property. This is the id you send in `properties` to attach it, and the `pk` you use to detach it.',
  optional: true,
}

const DISPLAYNAMEF547F2_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The label shown wherever the property is rendered.',
  optional: true,
}

const PROPERTYTYPED17D25_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`.',
  optional: true,
}

const ISACTIVE324D93_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the property is in use. A property can be retired by setting this to `false` on the catalog resource, without deleting it.',
  optional: true,
}

const OPTIONSDFDC65_OUTPUT: OutputProperty = {
  type: 'array',
  description:
    'The choices for an `OPTION` property. Manage them through [Property options](/api-reference/v2/workspace-work-item-property-options/overview).',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Optionsitem',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true },
      sort_order: { type: 'number', description: 'Access', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

export const PLANEV2WORKSPACEWORKITEMTYPEPROPERTIES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Work- Item- Type- Properties',
  optional: true,
  properties: {
    id: {
      ...IDC46B46_OUTPUT,
      description:
        'Unique identifier for the property. This is the id you send in `properties` to attach it, and the `pk` you use to detach it.',
    },
    name: {
      ...NAME7AF2FF_OUTPUT,
      description: 'Read-only companion to `display_name`. You never set it directly.',
    },
    display_name: {
      ...DISPLAYNAMEF547F2_OUTPUT,
      description: 'The label shown wherever the property is rendered.',
    },
    description: { ...CYCLE883343_OUTPUT, description: 'Description' },
    property_type: {
      ...PROPERTYTYPED17D25_OUTPUT,
      description:
        'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`.',
    },
    relation_type: { ...CYCLE883343_OUTPUT, description: 'Relation type' },
    is_required: {
      ...ISREQUIRED0A4AE5_OUTPUT,
      description: 'Whether a value must be supplied for this property.',
    },
    is_multi: {
      ...ISMULTI9EF865_OUTPUT,
      description: 'Whether the property accepts more than one value.',
    },
    is_active: {
      ...ISACTIVE324D93_OUTPUT,
      description:
        'Whether the property is in use. A property can be retired by setting this to `false` on the catalog resource, without deleting it.',
    },
    default_value: {
      ...DEFAULTVALUE2B7EA7_OUTPUT,
      description:
        'The value applied when none is supplied. Always an array, even when `is_multi` is `false`.',
    },
    options: {
      ...OPTIONSDFDC65_OUTPUT,
      description:
        'The choices for an `OPTION` property. Manage them through [Property options](/api-reference/v2/workspace-work-item-property-options/overview).',
    },
    settings: { ...SETTINGS78B010_OUTPUT, description: 'Settings' },
    validation_rules: { ...VALIDATIONRULES5F1BF4_OUTPUT, description: 'Validation rules' },
    logo_props: { ...LOGOPROPS912598_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1A7DFD_OUTPUT, description: 'When the property was created.' },
  },
}

const DATA6A7B72_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Work- Item- Type- Properties',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the property. This is the id you send in `properties` to attach it, and the `pk` you use to detach it.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Read-only companion to `display_name`. You never set it directly.',
        optional: true,
      },
      display_name: {
        type: 'string',
        description: 'The label shown wherever the property is rendered.',
        optional: true,
      },
      description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      property_type: {
        type: 'string',
        description:
          'What kind of value the property holds. One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`.',
        optional: true,
      },
      relation_type: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      is_required: {
        type: 'boolean',
        description: 'Whether a value must be supplied for this property.',
        optional: true,
      },
      is_multi: {
        type: 'boolean',
        description: 'Whether the property accepts more than one value.',
        optional: true,
      },
      is_active: {
        type: 'boolean',
        description:
          'Whether the property is in use. A property can be retired by setting this to `false` on the catalog resource, without deleting it.',
        optional: true,
      },
      default_value: {
        type: 'array',
        description:
          'The value applied when none is supplied. Always an array, even when `is_multi` is `false`.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      options: {
        type: 'array',
        description:
          'The choices for an `OPTION` property. Manage them through [Property options](/api-reference/v2/workspace-work-item-property-options/overview).',
        optional: true,
        items: {
          type: 'object',
          description: 'Plane V2 Optionsitem',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            description: { type: 'string', description: 'Asset Id', optional: true },
            is_default: { type: 'boolean', description: 'Has Pages', optional: true },
            sort_order: { type: 'number', description: 'Access', optional: true },
            external_id: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
            external_source: {
              type: 'string',
              description: 'Asset Id',
              optional: true,
              nullable: true,
            },
          },
        },
      },
      settings: { type: 'json', description: 'Settings', optional: true },
      validation_rules: { type: 'json', description: 'Validation Rules', optional: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the property was created.', optional: true },
    },
  },
}

const ID24B1A1_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Unique identifier for the type. This is the id you send as `type_id` on a work item, and the id you pass when importing types into a project.',
  optional: true,
}

const DESCRIPTION3EB07B_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'What this type is for. Shown next to the type wherever it is picked in Plane, so it is worth writing for the people choosing, not for your integration.',
  optional: true,
}

const ISACTIVE08ED6E_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the type can currently be selected. Deactivating a type retires it from pickers without deleting it or touching the work items already using it.',
  optional: true,
}

const ISDEFAULTF90A34_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    "Whether this is the workspace's default type. Read-only on create and update — change it with [Mark a type as default](/api-reference/v2/workspace-work-item-types/mark-default-workspace-work-item-type).",
  optional: true,
}

const ISEPIC22392B_OUTPUT: OutputProperty = {
  type: 'boolean',
  description:
    'Whether the type is an epic type. Read-only, and there is no body parameter for it: every type you create through this API is a standard work item type.',
  optional: true,
}

const LEVEL679529_OUTPUT: OutputProperty = { type: 'json', description: 'Level', optional: true }

const LOGOPROPSBBF5E7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
}

export const PLANEV2WORKSPACEWORKITEMTYPES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Work- Item- Types',
  optional: true,
  properties: {
    id: {
      ...ID24B1A1_OUTPUT,
      description:
        'Unique identifier for the type. This is the id you send as `type_id` on a work item, and the id you pass when importing types into a project.',
    },
    name: {
      ...NAME75D552_OUTPUT,
      description: 'Display name, for example `Bug`. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTION3EB07B_OUTPUT,
      description:
        'What this type is for. Shown next to the type wherever it is picked in Plane, so it is worth writing for the people choosing, not for your integration.',
    },
    is_active: {
      ...ISACTIVE08ED6E_OUTPUT,
      description:
        'Whether the type can currently be selected. Deactivating a type retires it from pickers without deleting it or touching the work items already using it.',
    },
    is_default: {
      ...ISDEFAULTF90A34_OUTPUT,
      description:
        "Whether this is the workspace's default type. Read-only on create and update — change it with [Mark a type as default](/api-reference/v2/workspace-work-item-types/mark-default-workspace-work-item-type).",
    },
    is_epic: {
      ...ISEPIC22392B_OUTPUT,
      description:
        'Whether the type is an epic type. Read-only, and there is no body parameter for it: every type you create through this API is a standard work item type.',
    },
    level: { ...LEVEL679529_OUTPUT, description: 'Level' },
    logo_props: { ...LOGOPROPSBBF5E7_OUTPUT, description: 'Logo props' },
    created_at: { ...CREATEDATF6A685_OUTPUT, description: 'When the type was created.' },
  },
}

const DATA74C95E_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Work- Item- Types',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the type. This is the id you send as `type_id` on a work item, and the id you pass when importing types into a project.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Display name, for example `Bug`. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description:
          'What this type is for. Shown next to the type wherever it is picked in Plane, so it is worth writing for the people choosing, not for your integration.',
        optional: true,
      },
      is_active: {
        type: 'boolean',
        description:
          'Whether the type can currently be selected. Deactivating a type retires it from pickers without deleting it or touching the work items already using it.',
        optional: true,
      },
      is_default: {
        type: 'boolean',
        description:
          "Whether this is the workspace's default type. Read-only on create and update — change it with [Mark a type as default](/api-reference/v2/workspace-work-item-types/mark-default-workspace-work-item-type).",
        optional: true,
      },
      is_epic: {
        type: 'boolean',
        description:
          'Whether the type is an epic type. Read-only, and there is no body parameter for it: every type you create through this API is a standard work item type.',
        optional: true,
      },
      level: { type: 'json', description: 'Level', optional: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true },
      created_at: { type: 'string', description: 'When the type was created.', optional: true },
    },
  },
}

const OWNEDBY4BE915_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ACCESS09C752_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Access',
  optional: true,
  nullable: true,
}

const VIEWPROPS8D74F6_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'View Props',
  optional: true,
  nullable: true,
}

const CONTENTBD2CA8_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Content',
  optional: true,
  items: {
    type: 'object',
    description: 'Content Item',
    properties: {
      type: { type: 'string', description: 'Asset Id', optional: true },
      attrs: {
        type: 'object',
        description: 'Attrs',
        optional: true,
        properties: {
          id: { type: 'json', description: 'Id', optional: true, nullable: true },
          textAlign: { type: 'json', description: 'Id', optional: true, nullable: true },
          aiSuggestion: { type: 'json', description: 'Id', optional: true, nullable: true },
        },
      },
      content: {
        type: 'array',
        description: 'Content',
        optional: true,
        items: {
          type: 'object',
          description: 'Content Item',
          properties: {
            text: { type: 'string', description: 'Asset Id', optional: true },
            type: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
    },
  },
}

const DESCRIPTIONJSON0B33AD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Description Json',
  optional: true,
  properties: {
    type: { ...ASSETID_OUTPUT, description: 'Type' },
    content: { ...CONTENTBD2CA8_OUTPUT, description: 'Content' },
  },
}

export const PLANEPAGECONTENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    owned_by: { ...OWNEDBY4BE915_OUTPUT, description: 'Owned by' },
    anchor: { ...ANCHOR_OUTPUT, description: 'Anchor' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    projects: { ...PROJECTS_OUTPUT, description: 'Projects' },
    access: { ...ACCESS09C752_OUTPUT, description: 'Access' },
    is_locked: { ...ISLOCKED_OUTPUT, description: 'Is locked' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    parent_id: { ...PARENTID_OUTPUT, description: 'Parent id' },
    collection_id: { ...COLLECTIONID_OUTPUT, description: 'Collection id' },
    page_collection_id: { ...PAGECOLLECTIONID_OUTPUT, description: 'Page collection id' },
    color: { ...ASSETID_OUTPUT, description: 'Color' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ID045D22_OUTPUT, description: 'Updated by' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    external_id: { ...ID045D22_OUTPUT, description: 'External id' },
    external_source: { ...ID045D22_OUTPUT, description: 'External source' },
    description_json: { ...DESCRIPTIONJSON0B33AD_OUTPUT, description: 'Description json' },
  },
}

const ASSIGNEESA64957_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Assignees',
  optional: true,
}

const LABELS3303C8_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Labels',
  optional: true,
  items: {
    type: 'json',
    description: 'Labels Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      deleted_by: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
      deleted_at: { type: 'json', description: 'Id', optional: true, nullable: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      color: { type: 'string', description: 'Asset Id', optional: true },
      sort_order: { type: 'number', description: 'Sort Order', optional: true },
      external_source: { type: 'json', description: 'Id', optional: true, nullable: true },
      external_id: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_by: { type: 'string', description: 'Asset Id', optional: true },
      updated_by: { type: 'json', description: 'Id', optional: true, nullable: true },
      workspace: { type: 'string', description: 'Asset Id', optional: true },
      project: { type: 'string', description: 'Asset Id', optional: true },
      parent: { type: 'json', description: 'Id', optional: true, nullable: true },
    },
  },
}

const PARENT6F1635_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

export const LABELB4435F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Label model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

const LABELS283EDF_OUTPUT: OutputProperty = { type: 'json', description: 'Labels', optional: true }

const SEQUENCEID6A702B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sequence  Id',
  optional: true,
  nullable: true,
}

const PROJECT30AA14_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Project',
  optional: true,
  nullable: true,
}

const STATE7452D8_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'State',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    group: { type: 'string', description: 'Group', optional: true, nullable: true },
  },
  nullable: true,
}

const ESTIMATEPOINT1C3278_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const CYCLEID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PRIORITYRANK_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

export const PLANEWORKITEMCONTENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Detailed work item with expanded relationships.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    assignees: { ...ASSIGNEESA64957_OUTPUT, description: 'Assignees' },
    labels: { ...LABELS283EDF_OUTPUT, description: 'Labels' },
    type_id: { ...TYPEID_OUTPUT, description: 'Type id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    point: { ...POINT_OUTPUT, description: 'Point' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    priority: { ...PRIORITY7C079D_OUTPUT, description: 'Priority' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    target_date: { ...TARGETDATE_OUTPUT, description: 'Target date' },
    sequence_id: { ...SEQUENCEID6A702B_OUTPUT, description: 'Sequence id' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    completed_at: { ...COMPLETEDAT_OUTPUT, description: 'Completed at' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    is_draft: { ...ISDRAFT_OUTPUT, description: 'Is draft' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT30AA14_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    state: { ...STATE7452D8_OUTPUT, description: 'State' },
    estimate_point: { ...ESTIMATEPOINT1C3278_OUTPUT, description: 'Estimate point' },
    type: { ...TYPE_OUTPUT, description: 'Type' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
    cycle_id: { ...CYCLEID_OUTPUT, description: 'Cycle id' },
    created_via: { ...ID045D22_OUTPUT, description: 'Created via' },
    updated_via: { ...ID045D22_OUTPUT, description: 'Updated via' },
    last_activity_at: { ...ASSETID_OUTPUT, description: 'Last activity at' },
    min_assignee_first_name: { ...CYCLEID_OUTPUT, description: 'Min assignee first name' },
    min_label_name: { ...CYCLEID_OUTPUT, description: 'Min label name' },
    min_module_name: { ...CYCLEID_OUTPUT, description: 'Min module name' },
    priority_rank: { ...PRIORITYRANK_OUTPUT, description: 'Priority rank' },
    state_group: { ...CYCLE883343_OUTPUT, description: 'State group' },
  },
}

export const PLANEV2V2PUBLISHARTIFACTRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Publish Artifactresult',
  optional: true,
  properties: {
    anchor: { ...ASSETID_OUTPUT, description: 'Anchor' },
    is_active: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is active' },
  },
}

export const PLANEV2V2LISTAUDITLOGSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Audit Logsresult',
  optional: true,
  properties: {
    data: { ...DATA_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2GETCURRENTUSERRESULTBFF3BF_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Current Userresult',
  optional: true,
  properties: {
    id: { ...CYCLE883343_OUTPUT, description: 'Id' },
    email: { ...CYCLE883343_OUTPUT, description: 'Email' },
    display_name: { ...CYCLE883343_OUTPUT, description: 'Display name' },
    principal_kind: { ...ASSETID_OUTPUT, description: 'Principal kind' },
    scopes: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Scopes' },
    first_name: { ...FIRSTNAME_OUTPUT, description: 'First name' },
    last_name: { ...LASTNAME_OUTPUT, description: 'Last name' },
    avatar: { ...AVATAR_OUTPUT, description: 'Avatar' },
    avatar_url: { ...AVATARURL_OUTPUT, description: 'Avatar URL' },
  },
}

const ACCESSB23B23_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Access',
  optional: true,
  nullable: true,
}

const CREATEDAT88654E_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

const ID835E8A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const ISDEFAULTD71AA4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Default',
  optional: true,
  nullable: true,
}

const ISGLOBAL3C2449_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Global',
  optional: true,
  nullable: true,
}

const LOGOPROPS5B72A8_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const NAME8B7867_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Name',
  optional: true,
  nullable: true,
}

const OWNEDBYIDEDAA1A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Owned By Id',
  optional: true,
  nullable: true,
}

const SORTORDER9643A4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

const CURRENTUSERACCESSDDFA7D_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access level of a member within a collection.',
  optional: true,
  nullable: true,
}

export const PLANEV2COLLECTIONS2745F2_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Collections',
  optional: true,
  properties: {
    access: { ...ACCESSB23B23_OUTPUT, description: 'Access' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_default: { ...ISDEFAULTD71AA4_OUTPUT, description: 'Is default' },
    is_global: { ...ISGLOBAL3C2449_OUTPUT, description: 'Is global' },
    logo_props: { ...LOGOPROPS5B72A8_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    owned_by_id: { ...OWNEDBYIDEDAA1A_OUTPUT, description: 'Owned by id' },
    page_ids: { ...PAGEIDS_OUTPUT, description: 'Ids of the associated pages.' },
    sort_order: { ...SORTORDER9643A4_OUTPUT, description: 'Sort order' },
    owned_by: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Owned by' },
    current_user_access: { ...CURRENTUSERACCESSDDFA7D_OUTPUT, description: 'Current user access' },
    has_pages: { ...HASPAGES_OUTPUT, description: 'Has pages' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
  },
}

const MEMBER374E5A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Assignees Item',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    display_name: { type: 'string', description: 'Asset Id', optional: true },
    avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    email: { type: 'string', description: 'Asset Id', optional: true },
  },
  nullable: true,
}

export const PLANEV2COLLECTIONS02F138_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Collections',
  optional: true,
  properties: {
    access: { ...ACCESS97D6DB_OUTPUT, description: 'Who can see this.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_default: {
      ...ISDEFAULT779508_OUTPUT,
      description:
        'Make this the default for its parent. Setting it clears the flag on the previous default.',
    },
    is_global: {
      ...ISGLOBAL48E7DF_OUTPUT,
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    logo_props: {
      ...LOGOPROPSB599B9_OUTPUT,
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    page_ids: { ...PAGEIDSD23A08_OUTPUT, description: 'Ids of the associated pages.' },
    sort_order: {
      ...SORTORDER7C3A9E_OUTPUT,
      description: 'Manual ordering weight. Lower sorts first.',
    },
    collection_id: { ...ASSETID_OUTPUT, description: 'Collection id' },
    member_id: { ...ASSETID_OUTPUT, description: 'Member id' },
    source: { ...ASSETID_OUTPUT, description: 'Source' },
    member: { ...MEMBER374E5A_OUTPUT, description: 'Member' },
  },
}

const MEMBER19062F_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const ACCESS386F79_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access level of a member within a collection.',
  optional: true,
  nullable: true,
}

export const COLLECTIONMEMBERA1654F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Collection membership record.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    collection: { ...COLLECTION_OUTPUT, description: 'Collection' },
    member: { ...MEMBER19062F_OUTPUT, description: 'Member' },
    access: { ...ACCESS386F79_OUTPUT, description: 'Access' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
  },
}

const DATAF9C0E0_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Collections',
    properties: {
      access: { type: 'number', description: 'Who can see this.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_default: {
        type: 'boolean',
        description:
          'Make this the default for its parent. Setting it clears the flag on the previous default.',
        optional: true,
      },
      is_global: {
        type: 'boolean',
        description: 'Whether this lives at the workspace level rather than inside a project.',
        optional: true,
      },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      owned_by_id: { type: 'string', description: 'The related owned by.', optional: true },
      page_ids: {
        type: 'array',
        description: 'Ids of the associated pages.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      owned_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTCOLLECTIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Collectionsresult',
  optional: true,
  properties: {
    data: { ...DATAF9C0E0_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const ACCESSC33C22_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access level of a collection.',
  optional: true,
  nullable: true,
}

const CURRENTUSERACCESS56FA2A_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Access level of a member within a collection.',
  optional: true,
  nullable: true,
}

export const COLLECTIONAEC678_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Collection model (a folder that groups workspace pages).',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    owned_by_id: { ...OWNEDBYID_OUTPUT, description: 'Owned by id' },
    access: { ...ACCESSC33C22_OUTPUT, description: 'Access' },
    current_user_access: { ...CURRENTUSERACCESS56FA2A_OUTPUT, description: 'Current user access' },
    has_pages: { ...HASPAGES_OUTPUT, description: 'Has pages' },
    is_default: { ...ISDEFAULT_OUTPUT, description: 'Is default' },
    is_global: { ...ISGLOBAL_OUTPUT, description: 'Is global' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
  },
}

export const PLANEV2V2MANAGECOLLECTIONMEMBERSRESULT8B24A1_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Collection Membersresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
    id: { ...ID_OUTPUT, description: 'Id' },
    collection: { ...COLLECTION_OUTPUT, description: 'Collection' },
    member: { ...MEMBER19062F_OUTPUT, description: 'Member' },
    access: { ...CURRENTUSERACCESSDDFA7D_OUTPUT, description: 'Access' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
  },
}

export const PLANEV2V2MANAGECOLLECTIONPAGESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Collection Pagesresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

export const COLLECTIONPAGED68582_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Flat page-collection membership record, returned by the move/reorder endpoint.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    collection: { ...COLLECTION_OUTPUT, description: 'Collection' },
    page: { ...PAGE_OUTPUT, description: 'Page' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
  },
}

const DEFAULTVALUE20E6A2_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'The default value.',
  optional: true,
  items: { type: 'string', description: 'Asset Id' },
  nullable: true,
}

const DESCRIPTION16907B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const ISACTIVE453A5B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Active',
  optional: true,
  nullable: true,
}

const ISMULTI05BA07_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Multi',
  optional: true,
  nullable: true,
}

const ISREQUIRED905EE1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Required',
  optional: true,
  nullable: true,
}

const OPTIONS860B5A_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'The options.',
  optional: true,
  items: {
    type: 'json',
    description: 'Options Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      name: { type: 'string', description: 'Name', optional: true },
      sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
      description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      is_active: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      property: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      parent: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
  nullable: true,
}

const RELATIONTYPEC72486_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Relation Type',
  optional: true,
  nullable: true,
}

const SETTINGS3253A1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
  properties: {
    display_format: { type: 'string', description: 'Display  Format', optional: true },
  },
  nullable: true,
}

const VALIDATIONRULES502845_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Validation Rules',
  optional: true,
  nullable: true,
}

export const PLANEV2CUSTOMERPROPERTIES2DC1F6_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Customer- Properties',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    default_value: { ...DEFAULTVALUE20E6A2_OUTPUT, description: 'Default value' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    display_name: { ...DISPLAYNAME940D5D_OUTPUT, description: 'The display name.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_active: { ...ISACTIVE453A5B_OUTPUT, description: 'Is active' },
    is_multi: { ...ISMULTI05BA07_OUTPUT, description: 'Is multi' },
    is_required: { ...ISREQUIRED905EE1_OUTPUT, description: 'Is required' },
    logo_props: { ...LOGOPROPS5B72A8_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    options: { ...OPTIONS860B5A_OUTPUT, description: 'Options' },
    property_type: { ...PROPERTYTYPE80786B_OUTPUT, description: 'The property type.' },
    relation_type: { ...RELATIONTYPEC72486_OUTPUT, description: 'Relation type' },
    settings: { ...SETTINGS3253A1_OUTPUT, description: 'Settings' },
    sort_order: { ...SORTORDER9643A4_OUTPUT, description: 'Sort order' },
    validation_rules: { ...VALIDATIONRULES502845_OUTPUT, description: 'Validation rules' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
  },
}

export const PLANEV2V2LISTCUSTOMERPROPERTIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Customer Propertiesresult',
  optional: true,
  properties: {
    data: { ...DATA029D9C_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const RELATIONTYPEC3FAD1_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Customer relation types -- a customer property can relate to a work item or a user.',
  optional: true,
  nullable: true,
}

const SETTINGSDD9594_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Settings',
  optional: true,
  properties: {
    display_format: { type: 'string', description: 'Display  Format', optional: true },
  },
  nullable: true,
}

const OPTIONSEE239B_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Options',
  optional: true,
  items: {
    type: 'object',
    description: 'Customer property option model (values of an OPTION property).',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      name: { type: 'string', description: 'Name', optional: true },
      sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
      description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      is_active: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
      is_default: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      property: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      parent: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
  nullable: true,
}

export const CUSTOMERPROPERTY195984_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Customer property model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    display_name: { ...DISPLAYNAMED4D29D_OUTPUT, description: 'Display name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    property_type: { ...CUSTOMERPROPERTYTYPE_OUTPUT, description: 'Property type' },
    relation_type: { ...RELATIONTYPEC3FAD1_OUTPUT, description: 'Relation type' },
    is_required: { ...ISREQUIRED_OUTPUT, description: 'Is required' },
    default_value: { ...DEFAULTVALUE_OUTPUT, description: 'Default value' },
    settings: { ...SETTINGSDD9594_OUTPUT, description: 'Settings' },
    is_active: { ...ISACTIVE_OUTPUT, description: 'Is active' },
    is_multi: { ...ISMULTI_OUTPUT, description: 'Is multi' },
    validation_rules: { ...VALIDATIONRULES_OUTPUT, description: 'Validation rules' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    options: { ...OPTIONSEE239B_OUTPUT, description: 'Options' },
  },
}

export const LISTCUSTOMERPROPERTYVALUESRESULT_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'List Customer Property Values Result',
  optional: true,
  properties: { detail: { type: 'string', description: 'Asset Id', optional: true } },
}

const DESCRIPTION32D9D3_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const DESCRIPTIONHTML605EC1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description Html',
  optional: true,
  nullable: true,
}

const LINK42216B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Link',
  optional: true,
  nullable: true,
}

export const PLANEV2CUSTOMERREQUESTS7999A5_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Customer- Requests',
  optional: true,
  properties: {
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    customer_id: { ...CUSTOMERID_OUTPUT, description: 'The related customer.' },
    description: { ...DESCRIPTION32D9D3_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    link: { ...LINK42216B_OUTPUT, description: 'Link' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    work_item_ids: { ...WORKITEMIDS_OUTPUT, description: 'Work item ids' },
    attachment_count: { ...ATTACHMENTCOUNT_OUTPUT, description: 'Attachment count' },
    description_stripped: { ...ASSETID_OUTPUT, description: 'Description stripped' },
    email: { ...ASSETID_OUTPUT, description: 'Email' },
    website_url: { ...ASSETID_OUTPUT, description: 'Website url' },
    logo_props: { ...ASSETID_OUTPUT, description: 'Logo props' },
    domain: { ...ASSETID_OUTPUT, description: 'Domain' },
    employees: { ...ACCESS644595_OUTPUT, description: 'Employees' },
    stage: { ...ASSETID_OUTPUT, description: 'Stage' },
    contract_status: { ...ASSETID_OUTPUT, description: 'Contract status' },
    revenue: { ...ASSETID_OUTPUT, description: 'Revenue' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
    logo_asset: { ...ASSETID_OUTPUT, description: 'Logo asset' },
  },
}

export const PLANEV2V2LISTCUSTOMERREQUESTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Customer Requestsresult',
  optional: true,
  properties: {
    data: { ...DATA22ACEC_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const CUSTOMERE0E1ED_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Customer model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    customer_request_count: {
      ...CUSTOMERREQUESTCOUNT_OUTPUT,
      description: 'Customer request count',
    },
    logo_url: { ...LOGOURL_OUTPUT, description: 'Logo url' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION2C8FE8_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    email: { ...EMAIL_OUTPUT, description: 'Email' },
    website_url: { ...WEBSITEURL_OUTPUT, description: 'Website url' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    domain: { ...DOMAIN_OUTPUT, description: 'Domain' },
    employees: { ...EMPLOYEES_OUTPUT, description: 'Employees' },
    stage: { ...STAGE_OUTPUT, description: 'Stage' },
    contract_status: { ...CONTRACTSTATUS_OUTPUT, description: 'Contract status' },
    revenue: { ...REVENUE_OUTPUT, description: 'Revenue' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    logo_asset: { ...LOGOASSET_OUTPUT, description: 'Logo asset' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
  },
}

const CONTRACTSTATUS90B0CE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Contract Status',
  optional: true,
  nullable: true,
}

const CUSTOMERREQUESTCOUNT02FBFB_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Customer Request Count',
  optional: true,
  nullable: true,
}

const DOMAIN3634C5_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Domain',
  optional: true,
  nullable: true,
}

const EMAIL0F5291_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Email',
  optional: true,
  nullable: true,
}

const EMPLOYEES5D28B5_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Employees',
  optional: true,
  nullable: true,
}

const LOGOURL952136_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Url',
  optional: true,
  nullable: true,
}

const REVENUE05F1C2_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Revenue',
  optional: true,
  nullable: true,
}

const STAGEA8C578_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Stage',
  optional: true,
  nullable: true,
}

const WEBSITEURL798B3A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Website Url',
  optional: true,
  nullable: true,
}

export const PLANEV2CUSTOMERS8E07C4_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Customers',
  optional: true,
  properties: {
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    contract_status: { ...CONTRACTSTATUS90B0CE_OUTPUT, description: 'Contract status' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    customer_request_count: {
      ...CUSTOMERREQUESTCOUNT02FBFB_OUTPUT,
      description: 'Customer request count',
    },
    description: { ...DESCRIPTION32D9D3_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    domain: { ...DOMAIN3634C5_OUTPUT, description: 'Domain' },
    email: { ...EMAIL0F5291_OUTPUT, description: 'Email' },
    employees: { ...EMPLOYEES5D28B5_OUTPUT, description: 'Employees' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    logo_asset_id: { ...LOGOASSETID_OUTPUT, description: 'The related logo asset.' },
    logo_props: { ...LOGOPROPS5B72A8_OUTPUT, description: 'Logo props' },
    logo_url: { ...LOGOURL952136_OUTPUT, description: 'Logo url' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    revenue: { ...REVENUE05F1C2_OUTPUT, description: 'Revenue' },
    stage: { ...STAGEA8C578_OUTPUT, description: 'Stage' },
    website_url: { ...WEBSITEURL798B3A_OUTPUT, description: 'Website url' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    logo_asset: { ...LOGOASSET_OUTPUT, description: 'Logo asset' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
  },
}

export const PLANEV2V2LISTCUSTOMERSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Customersresult',
  optional: true,
  properties: {
    data: { ...DATADDAF7A_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2MANAGECUSTOMERWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Customer Work Itemsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

export const PLANEV2V2BULKCREATECYCLESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Cyclesresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETECYCLESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Cyclesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATECYCLESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Cyclesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

const TOTALISSUESF869CF_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Total  Issues',
  optional: true,
  nullable: true,
}

const CANCELLEDISSUES7D6F65_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Cancelled  Issues',
  optional: true,
  nullable: true,
}

const COMPLETEDISSUESEE96DF_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Completed  Issues',
  optional: true,
  nullable: true,
}

const STARTEDISSUESD50ECE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Started  Issues',
  optional: true,
  nullable: true,
}

const UNSTARTEDISSUES906046_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Unstarted  Issues',
  optional: true,
  nullable: true,
}

const BACKLOGISSUESA57784_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Backlog  Issues',
  optional: true,
  nullable: true,
}

const PROGRESSSNAPSHOTDFBB25_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Progress  Snapshot',
  optional: true,
  nullable: true,
}

const VERSION4B055B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Version',
  optional: true,
  nullable: true,
}

export const CYCLE857A4C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Cycle model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    total_issues: { ...TOTALISSUESF869CF_OUTPUT, description: 'Total issues' },
    cancelled_issues: { ...CANCELLEDISSUES7D6F65_OUTPUT, description: 'Cancelled issues' },
    completed_issues: { ...COMPLETEDISSUESEE96DF_OUTPUT, description: 'Completed issues' },
    started_issues: { ...STARTEDISSUESD50ECE_OUTPUT, description: 'Started issues' },
    unstarted_issues: { ...UNSTARTEDISSUES906046_OUTPUT, description: 'Unstarted issues' },
    backlog_issues: { ...BACKLOGISSUESA57784_OUTPUT, description: 'Backlog issues' },
    total_estimates: { ...TOTALESTIMATES_OUTPUT, description: 'Total estimates' },
    completed_estimates: { ...COMPLETEDESTIMATES_OUTPUT, description: 'Completed estimates' },
    started_estimates: { ...STARTEDESTIMATES_OUTPUT, description: 'Started estimates' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    end_date: { ...ENDDATE_OUTPUT, description: 'End date' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    progress_snapshot: { ...PROGRESSSNAPSHOTDFBB25_OUTPUT, description: 'Progress snapshot' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    timezone: { ...TIMEZONE_OUTPUT, description: 'Timezone' },
    version: { ...VERSION4B055B_OUTPUT, description: 'Version' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    owned_by: { ...OWNEDBY4BE915_OUTPUT, description: 'Owned by' },
    status: { ...ASSETID_OUTPUT, description: 'Status' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

const IDB26C2B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONF5EFB4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const TIMEZONEA90EED_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Timezone',
  optional: true,
  nullable: true,
}

const SORTORDERF32603_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

const CREATEDAT9BD04E_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

const OWNEDBY18E538_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Owned By',
  optional: true,
  nullable: true,
}

export const PLANEV2CYCLES6D6772_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Cycles',
  optional: true,
  properties: {
    id: { ...IDB26C2B_OUTPUT, description: 'Id' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: { ...DESCRIPTIONF5EFB4_OUTPUT, description: 'Description' },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    end_date: { ...CYCLE883343_OUTPUT, description: 'End date' },
    timezone: { ...TIMEZONEA90EED_OUTPUT, description: 'Timezone' },
    owned_by_id: {
      ...OWNEDBYID907EBB_OUTPUT,
      description:
        'The user who owns the cycle. Read-only — assigned by Plane and not settable through the API. Use it to filter cycles on list.',
    },
    sort_order: { ...SORTORDERF32603_OUTPUT, description: 'Sort order' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT9BD04E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYIDDE9D3F_OUTPUT, description: 'The user who created the cycle.' },
    owned_by: { ...OWNEDBY18E538_OUTPUT, description: 'Owned by' },
    total_issues: { ...TOTALISSUESF869CF_OUTPUT, description: 'Total issues' },
    cancelled_issues: { ...CANCELLEDISSUES7D6F65_OUTPUT, description: 'Cancelled issues' },
    completed_issues: { ...COMPLETEDISSUESEE96DF_OUTPUT, description: 'Completed issues' },
    started_issues: { ...STARTEDISSUESD50ECE_OUTPUT, description: 'Started issues' },
    unstarted_issues: { ...UNSTARTEDISSUES906046_OUTPUT, description: 'Unstarted issues' },
    backlog_issues: { ...BACKLOGISSUESA57784_OUTPUT, description: 'Backlog issues' },
    total_estimates: { ...TOTALESTIMATES_OUTPUT, description: 'Total estimates' },
    completed_estimates: { ...COMPLETEDESTIMATES_OUTPUT, description: 'Completed estimates' },
    started_estimates: { ...STARTEDESTIMATES_OUTPUT, description: 'Started estimates' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    progress_snapshot: { ...PROGRESSSNAPSHOTDFBB25_OUTPUT, description: 'Progress snapshot' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    version: { ...VERSION4B055B_OUTPUT, description: 'Version' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    status: { ...ASSETID_OUTPUT, description: 'Status' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

const DATA046E2E_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Cycles',
    properties: {
      id: { type: 'string', description: 'Unique identifier for the cycle.', optional: true },
      name: {
        type: 'string',
        description: 'Display name, unique within the project. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description: 'Free-form description of what the cycle covers.',
        optional: true,
      },
      start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      end_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      timezone: {
        type: 'string',
        description:
          "The IANA time zone the cycle's dates are interpreted in, for example `America/New_York` or `UTC`. This is what makes a cycle boundary land at local midnight rather than UTC midnight for a distributed team.",
        optional: true,
      },
      owned_by_id: {
        type: 'string',
        description:
          'The user who owns the cycle. Read-only — assigned by Plane and not settable through the API. Use it to filter cycles on list.',
        optional: true,
      },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      logo_props: { type: 'json', description: 'View Props', optional: true, nullable: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the cycle was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the cycle.',
        optional: true,
      },
      owned_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTCYCLESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Cyclesresult',
  optional: true,
  properties: {
    data: { ...DATA046E2E_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2MANAGECYCLEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Cycle Work Itemsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

const SUBISSUESCOUNT160D64_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sub  Issues  Count',
  optional: true,
  nullable: true,
}

export const CYCLEWORKITEM52A223_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item in a cycle.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    sub_issues_count: { ...SUBISSUESCOUNT160D64_OUTPUT, description: 'Sub issues count' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    cycle: { ...CYCLE_OUTPUT, description: 'Cycle' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

export const PLANEV2V2TRANSFERCYCLEWORKITEMSRESULTDF206A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Transfer Cycle Work Itemsresult',
  optional: true,
  properties: {
    new_cycle_id: { ...ASSETID_OUTPUT, description: 'New cycle id' },
    message: { ...ASSETID_OUTPUT, description: 'Message' },
  },
}

export const PLANEV2CYCLESEE71CB_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Cycles',
  optional: true,
  properties: {
    id: { ...IDC6BA9C_OUTPUT, description: 'Unique identifier for the cycle.' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTION1FAA98_OUTPUT,
      description: 'Free-form description of what the cycle covers.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    end_date: { ...CYCLE883343_OUTPUT, description: 'End date' },
    timezone: {
      ...TIMEZONEC2812E_OUTPUT,
      description:
        "The IANA time zone the cycle's dates are interpreted in, for example `America/New_York` or `UTC`. This is what makes a cycle boundary land at local midnight rather than UTC midnight for a distributed team.",
    },
    owned_by_id: {
      ...OWNEDBYID907EBB_OUTPUT,
      description:
        'The user who owns the cycle. Read-only — assigned by Plane and not settable through the API. Use it to filter cycles on list.',
    },
    sort_order: { ...SORTORDER50AD65_OUTPUT, description: 'Sort order' },
    logo_props: { ...LOGOPROPSA76DCB_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT8A8D4F_OUTPUT, description: 'When the cycle was created.' },
    created_by_id: { ...CREATEDBYIDDE9D3F_OUTPUT, description: 'The user who created the cycle.' },
    owned_by: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Owned by' },
  },
}

export const PLANEV2V2BULKCREATEESTIMATEPOINTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Estimate Pointsresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETEESTIMATEPOINTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Estimate Pointsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATEESTIMATEPOINTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Estimate Pointsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2LISTESTIMATEPOINTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Estimate Pointsresult',
  optional: true,
  properties: {
    data: { ...DATA735E56_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const ESTIMATEPOINTBB0EE0_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Estimate point response model.\n\nRepresents an individual value within an estimate scale\n(e.g., "1", "2", "3" for story points).',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    estimate: { ...ESTIMATE_OUTPUT, description: 'Estimate' },
    key: { ...KEY_OUTPUT, description: 'Key' },
    value: { ...VALUE_OUTPUT, description: 'Value' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

const KEY8C96A1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Key',
  optional: true,
  nullable: true,
}

export const PLANEV2ESTIMATEPOINTSB9F075_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Estimate- Points',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    estimate_id: { ...ESTIMATEID_OUTPUT, description: 'The related estimate.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    key: { ...KEY8C96A1_OUTPUT, description: 'Key' },
    value: { ...VALUEF92DA1_OUTPUT, description: 'The value.' },
    estimate: { ...ESTIMATE_OUTPUT, description: 'Estimate' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

export const PLANEV2V2BULKCREATEESTIMATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Estimatesresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETEESTIMATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Estimatesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATEESTIMATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Estimatesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

const POINTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Points',
  optional: true,
  items: { type: 'json', description: 'Logo Props' },
}

export const PLANEV2ESTIMATESB76797_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Estimates',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    last_used: { ...LASTUSED35601D_OUTPUT, description: 'Whether last used.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    type: { ...TYPED8BD3A_OUTPUT, description: 'The type.' },
    points: { ...POINTS_OUTPUT, description: 'Points' },
  },
}

const LASTUSED6251DE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Last Used',
  optional: true,
  nullable: true,
}

const TYPE33A486_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Type',
  optional: true,
  nullable: true,
}

export const PLANEV2ESTIMATES78FED1_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Estimates',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    last_used: { ...LASTUSED6251DE_OUTPUT, description: 'Last used' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    type: { ...TYPE33A486_OUTPUT, description: 'Type' },
    points: { ...POINTS_OUTPUT, description: 'Points' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

const DATA92F00E_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Estimates',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      last_used: { type: 'boolean', description: 'Whether last used.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      type: { type: 'string', description: 'The type.', optional: true },
      points: {
        type: 'array',
        description: 'Points',
        optional: true,
        items: { type: 'json', description: 'Logo Props' },
      },
    },
  },
}

export const PLANEV2V2LISTESTIMATESRESULTFDA80B_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Estimatesresult',
  optional: true,
  properties: {
    data: { ...DATA92F00E_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    type: { ...TYPE0858AE_OUTPUT, description: 'Type' },
    last_used: { ...LASTUSED_OUTPUT, description: 'Last used' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

export const PLANEV2GROUPSYNC21AF09_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Group- Sync',
  optional: true,
  properties: {
    auto_remove: { ...AUTOREMOVE_OUTPUT, description: 'Whether auto remove.' },
    default_workspace_role_slug: {
      ...DEFAULTWORKSPACEROLESLUG_OUTPUT,
      description: 'The default workspace role slug.',
    },
    group_attribute_key: { ...GROUPATTRIBUTEKEY_OUTPUT, description: 'The group attribute key.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_enabled: { ...ISENABLED_OUTPUT, description: 'Whether the rule is switched on.' },
    sync_offline: { ...SYNCOFFLINE_OUTPUT, description: 'Whether sync offline.' },
    sync_on_login: { ...SYNCONLOGIN_OUTPUT, description: 'Whether sync on login.' },
    all_projects: { ...HASPAGES8E2BC3_OUTPUT, description: 'All projects' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    idp_group_name: { ...ASSETID_OUTPUT, description: 'Idp group name' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    role_slug: { ...ASSETID_OUTPUT, description: 'Role slug' },
    project: { ...ASSETID_OUTPUT, description: 'Project' },
    role: { ...ASSETID_OUTPUT, description: 'Role' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2GROUPSYNC997FE5_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Group- Sync',
  optional: true,
  properties: {
    auto_remove: { ...AUTOREMOVE_OUTPUT, description: 'Whether auto remove.' },
    default_workspace_role_slug: {
      ...DEFAULTWORKSPACEROLESLUG_OUTPUT,
      description: 'The default workspace role slug.',
    },
    group_attribute_key: { ...GROUPATTRIBUTEKEY_OUTPUT, description: 'The group attribute key.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_enabled: { ...ISENABLED_OUTPUT, description: 'Whether the rule is switched on.' },
    sync_offline: { ...SYNCOFFLINE_OUTPUT, description: 'Whether sync offline.' },
    sync_on_login: { ...SYNCONLOGIN_OUTPUT, description: 'Whether sync on login.' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    idp_group_name: { ...ASSETID_OUTPUT, description: 'Idp group name' },
    role_slug: { ...ASSETID_OUTPUT, description: 'Role slug' },
    role: { ...ASSETID_OUTPUT, description: 'Role' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2GROUPSYNC460C90_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Group- Sync',
  optional: true,
  properties: {
    auto_remove: { ...AUTOREMOVE_OUTPUT, description: 'Whether auto remove.' },
    default_workspace_role_slug: {
      ...DEFAULTWORKSPACEROLESLUG_OUTPUT,
      description: 'The default workspace role slug.',
    },
    group_attribute_key: { ...GROUPATTRIBUTEKEY_OUTPUT, description: 'The group attribute key.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_enabled: { ...ISENABLED_OUTPUT, description: 'Whether the rule is switched on.' },
    sync_offline: { ...SYNCOFFLINE_OUTPUT, description: 'Whether sync offline.' },
    sync_on_login: { ...SYNCONLOGIN_OUTPUT, description: 'Whether sync on login.' },
    default_workspace_role: { ...ASSETID_OUTPUT, description: 'Default workspace role' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2V2LISTPROJECTMAPPINGSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Mappingsresult',
  optional: true,
  properties: {
    data: { ...DATA73F281_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANELISTPROJECTMAPPINGSRESULTITEM51E494_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane List Project Mappings Result Item',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    idp_group_name: { ...ASSETID_OUTPUT, description: 'Idp group name' },
    project: { ...CYCLE883343_OUTPUT, description: 'Project' },
    all_projects: { ...HASPAGES8E2BC3_OUTPUT, description: 'All projects' },
    role: { ...ASSETID_OUTPUT, description: 'Role' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2V2LISTWORKSPACEMAPPINGSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Mappingsresult',
  optional: true,
  properties: {
    data: { ...DATA3412D8_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const INITIATIVELABEL4C6FAC_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Initiative label model.',
  optional: true,
  properties: {
    id: { ...IDE04262_OUTPUT, description: 'Id' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
  },
}

const COLOR7410A0_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Color',
  optional: true,
  nullable: true,
}

export const PLANEV2INITIATIVELABELSC1E575_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Initiative- Labels',
  optional: true,
  properties: {
    color: { ...COLOR7410A0_OUTPUT, description: 'Color' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    sort_order: { ...SORTORDER9643A4_OUTPUT, description: 'Sort order' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
  },
}

export const PLANEV2V2LISTINITIATIVELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Initiative Labelsresult',
  optional: true,
  properties: {
    data: { ...DATA75CBC7_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const INITIATIVELABELF98CDB_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Initiative label model.',
  optional: true,
  properties: {
    id: { ...IDE04262_OUTPUT, description: 'Id' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    grouped_by: { ...ASSETID_OUTPUT, description: 'Grouped by' },
    sub_grouped_by: { ...ASSETID_OUTPUT, description: 'Sub grouped by' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...ASSETID_OUTPUT, description: 'Next cursor' },
    prev_cursor: { ...ASSETID_OUTPUT, description: 'Prev cursor' },
    next_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Next page results' },
    prev_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Prev page results' },
    count: { ...ACCESS644595_OUTPUT, description: 'Count' },
    total_pages: { ...ACCESS644595_OUTPUT, description: 'Total pages' },
    total_results: { ...ACCESS644595_OUTPUT, description: 'Total results' },
    extra_stats: { ...EXTRASTATS_OUTPUT, description: 'Extra stats (nullable provider value).' },
    results: { ...RESULTS_OUTPUT, description: 'Results' },
  },
}

const ENDDATED4326F_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'End Date',
  optional: true,
  nullable: true,
}

const LOGOPROPSCC3180_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const STARTDATE33D50A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Start Date',
  optional: true,
  nullable: true,
}

const STATE299552_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'State',
  optional: true,
  nullable: true,
}

export const PLANEV2INITIATIVES26C543_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Initiatives',
  optional: true,
  properties: {
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    end_date: { ...ENDDATED4326F_OUTPUT, description: 'End date' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    label_ids: { ...LABELIDS7D9FA4_OUTPUT, description: 'Ids of the associated labels.' },
    lead_id: { ...LEADID_OUTPUT, description: 'The related lead.' },
    logo_props: { ...LOGOPROPSCC3180_OUTPUT, description: 'Logo props' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    project_ids: { ...PROJECTIDSA92388_OUTPUT, description: 'Ids of the associated projects.' },
    start_date: { ...STARTDATE33D50A_OUTPUT, description: 'Start date' },
    state: { ...STATE299552_OUTPUT, description: 'State' },
    lead: { ...OWNEDBY18E538_OUTPUT, description: 'Lead' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
  },
}

const DATA25980B_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Initiatives',
    properties: {
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      end_date: { type: 'string', description: 'End date, as `YYYY-MM-DD`.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      label_ids: {
        type: 'array',
        description: 'Ids of the associated labels.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      lead_id: { type: 'string', description: 'The related lead.', optional: true },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      project_ids: {
        type: 'array',
        description: 'Ids of the associated projects.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      start_date: {
        type: 'string',
        description: 'Planned start date, as `YYYY-MM-DD`.',
        optional: true,
      },
      state: { type: 'string', description: 'The state.', optional: true },
      lead: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTINITIATIVESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Initiativesresult',
  optional: true,
  properties: {
    data: { ...DATA25980B_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const STATED27BE2_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Initiative state enumeration.',
  optional: true,
  nullable: true,
}

export const INITIATIVEF4AA07_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Initiative model.',
  optional: true,
  properties: {
    id: { ...IDE04262_OUTPUT, description: 'Id' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    end_date: { ...ENDDATE_OUTPUT, description: 'End date' },
    logo_props: { ...LOGOPROPSF7FCCC_OUTPUT, description: 'Logo props' },
    state: { ...STATED27BE2_OUTPUT, description: 'State' },
    lead: { ...LEAD_OUTPUT, description: 'Lead' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    grouped_by: { ...ASSETID_OUTPUT, description: 'Grouped by' },
    sub_grouped_by: { ...ASSETID_OUTPUT, description: 'Sub grouped by' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...ASSETID_OUTPUT, description: 'Next cursor' },
    prev_cursor: { ...ASSETID_OUTPUT, description: 'Prev cursor' },
    next_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Next page results' },
    prev_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Prev page results' },
    count: { ...ACCESS644595_OUTPUT, description: 'Count' },
    total_pages: { ...ACCESS644595_OUTPUT, description: 'Total pages' },
    total_results: { ...ACCESS644595_OUTPUT, description: 'Total results' },
    extra_stats: { ...EXTRASTATS_OUTPUT, description: 'Extra stats (nullable provider value).' },
    results: { ...RESULTS_OUTPUT, description: 'Results' },
  },
}

export const PLANEV2V2MANAGEINITIATIVELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Initiative Labelsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

export const PLANEV2V2MANAGEINITIATIVEPROJECTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Initiative Projectsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

const DEFAULTASSIGNEE13325E_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const PROJECTLEADAF8C35_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

export const PROJECT51FEA9_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Project model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    total_members: { ...TOTALMEMBERS_OUTPUT, description: 'Total members' },
    total_cycles: { ...TOTALCYCLES_OUTPUT, description: 'Total cycles' },
    total_modules: { ...TOTALMODULES_OUTPUT, description: 'Total modules' },
    is_member: { ...ISMEMBER_OUTPUT, description: 'Is member' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    member_role: { ...MEMBERROLE_OUTPUT, description: 'Member role' },
    is_deployed: { ...ISDEPLOYED_OUTPUT, description: 'Is deployed' },
    cover_image_url: { ...COVERIMAGEURL_OUTPUT, description: 'Cover image url' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    description_text: { ...DESCRIPTIONTEXT_OUTPUT, description: 'Description text' },
    description_html: { ...DESCRIPTIONHTMLFA4901_OUTPUT, description: 'Description html' },
    network: { ...NETWORK_OUTPUT, description: 'Network' },
    identifier: { ...IDENTIFIER_OUTPUT, description: 'Identifier' },
    emoji: { ...EMOJI_OUTPUT, description: 'Emoji' },
    icon_prop: { ...ICONPROP_OUTPUT, description: 'Icon prop' },
    module_view: { ...MODULEVIEW_OUTPUT, description: 'Module view' },
    cycle_view: { ...CYCLEVIEW_OUTPUT, description: 'Cycle view' },
    issue_views_view: { ...ISSUEVIEWSVIEW_OUTPUT, description: 'Issue views view' },
    page_view: { ...PAGEVIEW_OUTPUT, description: 'Page view' },
    intake_view: { ...INTAKEVIEW_OUTPUT, description: 'Intake view' },
    is_time_tracking_enabled: {
      ...ISTIMETRACKINGENABLED_OUTPUT,
      description: 'Is time tracking enabled',
    },
    is_issue_type_enabled: { ...ISISSUETYPEENABLED_OUTPUT, description: 'Is issue type enabled' },
    guest_view_all_features: {
      ...GUESTVIEWALLFEATURES_OUTPUT,
      description: 'Guest view all features',
    },
    cover_image: { ...COVERIMAGE_OUTPUT, description: 'Cover image' },
    archive_in: { ...ARCHIVEIN_OUTPUT, description: 'Archive in' },
    close_in: { ...CLOSEIN_OUTPUT, description: 'Close in' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    timezone: { ...TIMEZONE7677DD_OUTPUT, description: 'Timezone' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    default_assignee: { ...DEFAULTASSIGNEE13325E_OUTPUT, description: 'Default assignee' },
    project_lead: { ...PROJECTLEADAF8C35_OUTPUT, description: 'Project lead' },
    cover_image_asset: { ...COVERIMAGEASSET_OUTPUT, description: 'Cover image asset' },
    estimate: { ...ESTIMATE_OUTPUT, description: 'Estimate' },
    default_state: { ...DEFAULTSTATE_OUTPUT, description: 'Default state' },
  },
}

export const PLANEV2V2MANAGEINITIATIVEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Initiative Work Itemsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

const SNOOZEDTILL2B3739_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Snoozed Till',
  optional: true,
  nullable: true,
}

const SOURCE0190A9_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Source',
  optional: true,
  nullable: true,
}

const SOURCEEMAIL6368DE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Source Email',
  optional: true,
  nullable: true,
}

const STATUS9CAF13_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Status',
  optional: true,
  nullable: true,
}

const ISSUEDETAILC259BF_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Expanded work item with nested objects.',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    cycle: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    module: {
      type: 'object',
      description: 'Lite module information.',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        name: { type: 'string', description: 'Name', optional: true },
        description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        description_text: {
          type: 'json',
          description: 'Logo Props',
          optional: true,
          nullable: true,
        },
        description_html: {
          type: 'json',
          description: 'Logo Props',
          optional: true,
          nullable: true,
        },
        start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        status: { type: 'string', description: 'Status', optional: true, nullable: true },
        view_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
        sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
        external_source: {
          type: 'string',
          description: 'Asset Id',
          optional: true,
          nullable: true,
        },
        external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
        created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        project: { type: 'string', description: 'Project', optional: true },
        workspace: { type: 'string', description: 'Workspace', optional: true },
        lead: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        members: {
          type: 'array',
          description: 'Default Value',
          optional: true,
          items: { type: 'string', description: 'Asset Id' },
          nullable: true,
        },
      },
      nullable: true,
    },
    labels: { type: 'json', description: 'Labels', optional: true, nullable: true },
    assignees: { type: 'json', description: 'Assignees', optional: true, nullable: true },
    state: {
      type: 'object',
      description: 'Lite state information.',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        group: { type: 'string', description: 'Group', optional: true, nullable: true },
      },
      nullable: true,
    },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    point: { type: 'number', description: 'Access', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    description_html: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description_stripped: {
      type: 'string',
      description: 'Asset Id',
      optional: true,
      nullable: true,
    },
    description_binary: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    priority: { type: 'string', description: 'Priority', optional: true, nullable: true },
    start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    sequence_id: { type: 'number', description: 'Access', optional: true, nullable: true },
    sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
    completed_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    is_draft: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    project: { type: 'json', description: 'Project', optional: true, nullable: true },
    workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    parent: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    estimate_point: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    type: { type: 'json', description: 'Type', optional: true, nullable: true },
  },
  nullable: true,
}

const PROJECT3F9722_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Project',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    total_members: { type: 'number', description: 'Access', optional: true, nullable: true },
    total_cycles: { type: 'number', description: 'Access', optional: true, nullable: true },
    total_modules: { type: 'number', description: 'Access', optional: true, nullable: true },
    is_member: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
    member_role: { type: 'number', description: 'Access', optional: true, nullable: true },
    is_deployed: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    cover_image_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Name', optional: true },
    description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description_text: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    description_html: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    network: { type: 'number', description: 'Access', optional: true, nullable: true },
    identifier: { type: 'string', description: 'Identifier', optional: true },
    emoji: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    icon_prop: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    module_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    cycle_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    issue_views_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    page_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    intake_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    is_time_tracking_enabled: {
      type: 'boolean',
      description: 'Has Pages',
      optional: true,
      nullable: true,
    },
    is_issue_type_enabled: {
      type: 'boolean',
      description: 'Has Pages',
      optional: true,
      nullable: true,
    },
    guest_view_all_features: {
      type: 'boolean',
      description: 'Has Pages',
      optional: true,
      nullable: true,
    },
    cover_image: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    archive_in: { type: 'number', description: 'Access', optional: true, nullable: true },
    close_in: { type: 'number', description: 'Access', optional: true, nullable: true },
    logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    timezone: { type: 'string', description: 'Timezone', optional: true, nullable: true },
    external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    default_assignee: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    project_lead: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    cover_image_asset: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    estimate: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    default_state: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
  },
  nullable: true,
}

export const PLANEV2INTAKEWORKITEMSD605CE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Intake- Work- Items',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    duplicate_to_id: { ...DUPLICATETOID_OUTPUT, description: 'The related duplicate to.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    intake_id: { ...INTAKEID_OUTPUT, description: 'The related intake.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    priority: { ...PRIORITY0D388C_OUTPUT, description: 'Urgency of the work item.' },
    snoozed_till: { ...SNOOZEDTILL2B3739_OUTPUT, description: 'Snoozed till' },
    source: { ...SOURCE0190A9_OUTPUT, description: 'Source' },
    source_email: { ...SOURCEEMAIL6368DE_OUTPUT, description: 'Source email' },
    state_id: { ...STATEIDDDFC84_OUTPUT, description: 'The related state.' },
    status: { ...STATUS9CAF13_OUTPUT, description: 'Status' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    issue_detail: { ...ISSUEDETAILC259BF_OUTPUT, description: 'Issue detail' },
    inbox: { ...INBOX_OUTPUT, description: 'Inbox' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    extra: { ...EXTRA_OUTPUT, description: 'Extra' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT3F9722_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    intake: { ...INTAKE_OUTPUT, description: 'Intake' },
    issue: { ...ISSUE4193E9_OUTPUT, description: 'Issue' },
    duplicate_to: { ...DUPLICATETO_OUTPUT, description: 'Duplicate to' },
  },
}

export const PLANEV2V2LISTINTAKEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Intake Work Itemsresult',
  optional: true,
  properties: {
    data: { ...DATA4EDEAE_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const ISSUEDETAIL3B057E_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Expanded work item with nested objects.',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    cycle: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    module: {
      type: 'object',
      description: 'Lite module information.',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        name: { type: 'string', description: 'Name', optional: true },
        description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        description_text: {
          type: 'json',
          description: 'Logo Props',
          optional: true,
          nullable: true,
        },
        description_html: {
          type: 'json',
          description: 'Logo Props',
          optional: true,
          nullable: true,
        },
        start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        status: { type: 'string', description: 'Status', optional: true, nullable: true },
        view_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
        sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
        external_source: {
          type: 'string',
          description: 'Asset Id',
          optional: true,
          nullable: true,
        },
        external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
        created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        project: { type: 'string', description: 'Project', optional: true },
        workspace: { type: 'string', description: 'Workspace', optional: true },
        lead: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        members: {
          type: 'array',
          description: 'Default Value',
          optional: true,
          items: { type: 'string', description: 'Asset Id' },
          nullable: true,
        },
      },
      nullable: true,
    },
    labels: { type: 'json', description: 'Labels', optional: true, nullable: true },
    assignees: { type: 'json', description: 'Assignees', optional: true, nullable: true },
    state: {
      type: 'object',
      description: 'Lite state information.',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        group: { type: 'string', description: 'Group', optional: true, nullable: true },
      },
      nullable: true,
    },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    point: { type: 'number', description: 'Access', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    description_html: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description_stripped: {
      type: 'string',
      description: 'Asset Id',
      optional: true,
      nullable: true,
    },
    description_binary: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    priority: { type: 'string', description: 'Priority', optional: true, nullable: true },
    start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    sequence_id: { type: 'number', description: 'Access', optional: true, nullable: true },
    sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
    completed_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    is_draft: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    project: { type: 'json', description: 'Project', optional: true, nullable: true },
    workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    parent: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    estimate_point: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    type: { type: 'json', description: 'Type', optional: true, nullable: true },
  },
  nullable: true,
}

const PROJECTF7EAD4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Project',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    total_members: { type: 'number', description: 'Access', optional: true, nullable: true },
    total_cycles: { type: 'number', description: 'Access', optional: true, nullable: true },
    total_modules: { type: 'number', description: 'Access', optional: true, nullable: true },
    is_member: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
    member_role: { type: 'number', description: 'Access', optional: true, nullable: true },
    is_deployed: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    cover_image_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Name', optional: true },
    description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description_text: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    description_html: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    network: { type: 'number', description: 'Access', optional: true, nullable: true },
    identifier: { type: 'string', description: 'Identifier', optional: true },
    emoji: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    icon_prop: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    module_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    cycle_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    issue_views_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    page_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    intake_view: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    is_time_tracking_enabled: {
      type: 'boolean',
      description: 'Has Pages',
      optional: true,
      nullable: true,
    },
    is_issue_type_enabled: {
      type: 'boolean',
      description: 'Has Pages',
      optional: true,
      nullable: true,
    },
    guest_view_all_features: {
      type: 'boolean',
      description: 'Has Pages',
      optional: true,
      nullable: true,
    },
    cover_image: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    archive_in: { type: 'number', description: 'Access', optional: true, nullable: true },
    close_in: { type: 'number', description: 'Access', optional: true, nullable: true },
    logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    timezone: { type: 'string', description: 'Timezone', optional: true, nullable: true },
    external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    default_assignee: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    project_lead: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    cover_image_asset: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    estimate: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    default_state: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
  },
  nullable: true,
}

export const INTAKEWORKITEM108B7F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intake work item model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    issue_detail: { ...ISSUEDETAIL3B057E_OUTPUT, description: 'Issue detail' },
    inbox: { ...INBOX_OUTPUT, description: 'Inbox' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    status: { ...STATUS60A688_OUTPUT, description: 'Status' },
    snoozed_till: { ...SNOOZEDTILL_OUTPUT, description: 'Snoozed till' },
    source: { ...SOURCE_OUTPUT, description: 'Source' },
    source_email: { ...SOURCEEMAIL_OUTPUT, description: 'Source email' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    extra: { ...EXTRA_OUTPUT, description: 'Extra' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECTF7EAD4_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    intake: { ...INTAKE_OUTPUT, description: 'Intake' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    duplicate_to: { ...DUPLICATETO_OUTPUT, description: 'Duplicate to' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
  },
}

export const PLANEV2V2BULKINVITATIONSRESULTITEM_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Invitationsresultitem',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    email: { ...ASSETID_OUTPUT, description: 'Email' },
    role: { ...ASSETID_OUTPUT, description: 'Role' },
    message: { ...ASSETID_OUTPUT, description: 'Message' },
    accepted: { ...HASPAGES8E2BC3_OUTPUT, description: 'Accepted' },
    responded_at: { ...CYCLE883343_OUTPUT, description: 'Responded at' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
  },
}

const ROLEEAE79D_OUTPUT: OutputProperty = { type: 'json', description: 'Role', optional: true }

export const PLANEV2INVITATIONSD40DEA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Invitations',
  optional: true,
  properties: {
    accepted: { ...ACCEPTED_OUTPUT, description: 'Whether accepted.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    email: { ...EMAIL0E37ED_OUTPUT, description: 'Email address.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    message: { ...MESSAGE498389_OUTPUT, description: 'The message.' },
    responded_at: { ...RESPONDEDAT_OUTPUT, description: 'The responded at.' },
    role: { ...ROLEEAE79D_OUTPUT, description: 'Role' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2V2LISTINVITATIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Invitationsresult',
  optional: true,
  properties: {
    data: { ...DATAEB406F_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2BULKCREATELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Labelsresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Labelsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Labelsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

const ID85F016_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const DESCRIPTION840A7F_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const COLORAC64F7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Color',
  optional: true,
  nullable: true,
}

const SORTORDER088338_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

const CREATEDAT1248FE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

export const PLANEV2LABELS8A1AE6_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Labels',
  optional: true,
  properties: {
    id: { ...ID85F016_OUTPUT, description: 'Id' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: { ...DESCRIPTION840A7F_OUTPUT, description: 'Description' },
    color: { ...COLORAC64F7_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER088338_OUTPUT, description: 'Sort order' },
    parent_id: { ...CYCLE883343_OUTPUT, description: 'Parent id' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1248FE_OUTPUT, description: 'Created at' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

export const PLANEV2V2LISTLABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Labelsresult',
  optional: true,
  properties: {
    data: { ...DATA42995A_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const ROLEE7EA40_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Role',
  optional: true,
  nullable: true,
}

const MEMBER3B010B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Member',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    display_name: { type: 'string', description: 'Asset Id', optional: true },
    avatar_url: { type: 'string', description: 'Asset Id', optional: true },
    email: { type: 'string', description: 'Asset Id', optional: true },
  },
}

export const PLANEV2MEMBERS0326B2_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Members',
  optional: true,
  properties: {
    id: {
      ...IDDDD330_OUTPUT,
      description:
        'Unique identifier for the membership row — not for the user. The same person has one membership in the workspace and another in each project they belong to, so they have several `id` values but one `member_id`.',
    },
    member_id: {
      ...MEMBERID_OUTPUT,
      description:
        'The user this membership belongs to. This is the id that lines up with `created_by_id` on other objects, `assignee_ids` on work items, and `actor_id` in [audit logs](/api-reference/v2/audit-logs/overview). Join on `member_id`, never on `id`.',
    },
    role: { ...ROLEE7EA40_OUTPUT, description: 'Role' },
    member: { ...MEMBER3B010B_OUTPUT, description: 'Member' },
  },
}

export const PLANEV2V2GETPROJECTROLEDISTRIBUTIONRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Project Role Distributionresult',
  optional: true,
  properties: {
    roles: { ...ROLES_OUTPUT, description: 'Roles' },
    total_distinct_members: { ...ACCESS644595_OUTPUT, description: 'Total distinct members' },
    total_memberships: { ...ACCESS644595_OUTPUT, description: 'Total memberships' },
  },
}

export const PLANEV2V2LISTPROJECTMEMBERSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Membersresult',
  optional: true,
  properties: {
    data: { ...DATA6057DF_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEMEMBERSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Membersresult',
  optional: true,
  properties: {
    data: { ...DATA6057DF_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2BULKCREATEMILESTONESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Milestonesresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETEMILESTONESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Milestonesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATEMILESTONESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Milestonesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

const TARGETDATE1D7269_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Target Date',
  optional: true,
  nullable: true,
}

export const PLANEV2MILESTONES9079DC_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Milestones',
  optional: true,
  properties: {
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    target_date: { ...TARGETDATE1D7269_OUTPUT, description: 'Target date' },
    title: { ...TITLEF754B4_OUTPUT, description: 'Title.' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
  },
}

export const PLANEV2V2LISTMILESTONESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Milestonesresult',
  optional: true,
  properties: {
    data: { ...DATA7CF2D8_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2MANAGEMILESTONEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Milestone Work Itemsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

export const PLANEV2V2BULKCREATEMODULESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Modulesresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETEMODULESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Modulesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATEMODULESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Modulesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const MODULEB27E64_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Module model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    total_issues: { ...TOTALISSUESF869CF_OUTPUT, description: 'Total issues' },
    cancelled_issues: { ...CANCELLEDISSUES7D6F65_OUTPUT, description: 'Cancelled issues' },
    completed_issues: { ...COMPLETEDISSUESEE96DF_OUTPUT, description: 'Completed issues' },
    started_issues: { ...STARTEDISSUESD50ECE_OUTPUT, description: 'Started issues' },
    unstarted_issues: { ...UNSTARTEDISSUES906046_OUTPUT, description: 'Unstarted issues' },
    backlog_issues: { ...BACKLOGISSUESA57784_OUTPUT, description: 'Backlog issues' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    description_text: { ...DESCRIPTIONTEXT_OUTPUT, description: 'Description text' },
    description_html: { ...DESCRIPTIONHTMLFA4901_OUTPUT, description: 'Description html' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    target_date: { ...TARGETDATE_OUTPUT, description: 'Target date' },
    status: { ...STATUS_OUTPUT, description: 'Status' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    lead: { ...LEAD_OUTPUT, description: 'Lead' },
    members: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Members' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

const ID492C8C_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const DESCRIPTION6B600D_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const STATUSE662A9_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Status',
  optional: true,
  nullable: true,
}

const SORTORDER762384_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

const CREATEDAT4B6D37_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

const MEMBERSC6E95C_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Members',
  optional: true,
  items: { type: 'json', description: 'Members Item' },
}

export const PLANEV2MODULES29B3C8_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Modules',
  optional: true,
  properties: {
    id: { ...ID492C8C_OUTPUT, description: 'Id' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: { ...DESCRIPTION6B600D_OUTPUT, description: 'Description' },
    status: { ...STATUSE662A9_OUTPUT, description: 'Status' },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    lead_id: { ...CYCLE883343_OUTPUT, description: 'Lead id' },
    member_ids: {
      ...MEMBERIDS_OUTPUT,
      description:
        'Project members assigned to the module. Read-only in v2 — module membership is not yet writable through the v2 API.',
    },
    sort_order: { ...SORTORDER762384_OUTPUT, description: 'Sort order' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    created_at: { ...CREATEDAT4B6D37_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYIDC85A02_OUTPUT, description: 'The user who created the module.' },
    lead: { ...OWNEDBY18E538_OUTPUT, description: 'Lead' },
    members: { ...MEMBERSC6E95C_OUTPUT, description: 'Members' },
    total_issues: { ...TOTALISSUESF869CF_OUTPUT, description: 'Total issues' },
    cancelled_issues: { ...CANCELLEDISSUES7D6F65_OUTPUT, description: 'Cancelled issues' },
    completed_issues: { ...COMPLETEDISSUESEE96DF_OUTPUT, description: 'Completed issues' },
    started_issues: { ...STARTEDISSUESD50ECE_OUTPUT, description: 'Started issues' },
    unstarted_issues: { ...UNSTARTEDISSUES906046_OUTPUT, description: 'Unstarted issues' },
    backlog_issues: { ...BACKLOGISSUESA57784_OUTPUT, description: 'Backlog issues' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    description_text: { ...DESCRIPTIONTEXT_OUTPUT, description: 'Description text' },
    description_html: { ...DESCRIPTIONHTMLFA4901_OUTPUT, description: 'Description html' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

const DATAC14C55_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Modules',
    properties: {
      id: { type: 'string', description: 'Unique identifier for the module.', optional: true },
      name: {
        type: 'string',
        description: 'Display name, unique within the project. Maximum 255 characters.',
        optional: true,
      },
      description: {
        type: 'string',
        description: 'Plain-text summary of what the module covers.',
        optional: true,
      },
      status: {
        type: 'string',
        description:
          'Where the module sits in its lifecycle. One of `backlog`, `planned`, `in-progress`, `paused`, `completed`, or `cancelled`.',
        optional: true,
      },
      start_date: {
        type: 'string',
        description: 'Date the module is scheduled to begin, as `YYYY-MM-DD`, or `null`.',
        optional: true,
        nullable: true,
      },
      target_date: {
        type: 'string',
        description: 'Date the module is expected to land, as `YYYY-MM-DD`, or `null`.',
        optional: true,
        nullable: true,
      },
      lead_id: {
        type: 'string',
        description: 'The project member accountable for the module, or `null`.',
        optional: true,
        nullable: true,
      },
      member_ids: {
        type: 'array',
        description:
          'Project members assigned to the module. Read-only in v2 — module membership is not yet writable through the v2 API.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      sort_order: {
        type: 'number',
        description: 'Ordering weight used when modules are listed. Lower values sort first.',
        optional: true,
      },
      logo_props: { type: 'json', description: 'View Props', optional: true, nullable: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      archived_at: {
        type: 'string',
        description: 'When the module was archived, or `null` for an active module.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the module was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the module.',
        optional: true,
      },
      lead: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      members: {
        type: 'array',
        description: 'Points',
        optional: true,
        items: { type: 'json', description: 'Logo Props' },
      },
    },
  },
}

export const PLANEV2V2LISTMODULESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Modulesresult',
  optional: true,
  properties: {
    data: { ...DATAC14C55_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2MANAGEMODULEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Module Work Itemsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

const ISSUE1D1D84_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Issue',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    cycle: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    module: {
      type: 'object',
      description: 'Lite module information.',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        name: { type: 'string', description: 'Name', optional: true },
        description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        description_text: {
          type: 'json',
          description: 'Logo Props',
          optional: true,
          nullable: true,
        },
        description_html: {
          type: 'json',
          description: 'Logo Props',
          optional: true,
          nullable: true,
        },
        start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        status: { type: 'string', description: 'Status', optional: true, nullable: true },
        view_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
        sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
        external_source: {
          type: 'string',
          description: 'Asset Id',
          optional: true,
          nullable: true,
        },
        external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
        created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        project: { type: 'string', description: 'Project', optional: true },
        workspace: { type: 'string', description: 'Workspace', optional: true },
        lead: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        members: {
          type: 'array',
          description: 'Default Value',
          optional: true,
          items: { type: 'string', description: 'Asset Id' },
          nullable: true,
        },
      },
      nullable: true,
    },
    labels: { type: 'json', description: 'Labels', optional: true, nullable: true },
    assignees: { type: 'json', description: 'Assignees', optional: true, nullable: true },
    state: {
      type: 'object',
      description: 'Lite state information.',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
        group: { type: 'string', description: 'Group', optional: true, nullable: true },
      },
      nullable: true,
    },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    point: { type: 'number', description: 'Access', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    description_html: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    description_stripped: {
      type: 'string',
      description: 'Asset Id',
      optional: true,
      nullable: true,
    },
    description_binary: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    priority: { type: 'string', description: 'Priority', optional: true, nullable: true },
    start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    sequence_id: { type: 'number', description: 'Access', optional: true, nullable: true },
    sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
    completed_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    archived_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    is_draft: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    project: { type: 'json', description: 'Project', optional: true, nullable: true },
    workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    parent: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    estimate_point: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    type: { type: 'json', description: 'Type', optional: true, nullable: true },
  },
}

export const MODULEWORKITEMA652D3_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item in a module.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    sub_issues_count: { ...SUBISSUESCOUNT160D64_OUTPUT, description: 'Sub issues count' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    module: { ...MODULE83515F_OUTPUT, description: 'Module' },
    issue: { ...ISSUE1D1D84_OUTPUT, description: 'Issue' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

export const PLANEV2MODULES0AD45C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Modules',
  optional: true,
  properties: {
    id: { ...IDA3C0E8_OUTPUT, description: 'Unique identifier for the module.' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: {
      ...DESCRIPTIONC3D3EB_OUTPUT,
      description: 'Plain-text summary of what the module covers.',
    },
    status: {
      ...STATUS2FB7BA_OUTPUT,
      description:
        'Where the module sits in its lifecycle. One of `backlog`, `planned`, `in-progress`, `paused`, `completed`, or `cancelled`.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    lead_id: { ...CYCLE883343_OUTPUT, description: 'Lead id' },
    member_ids: {
      ...MEMBERIDS840550_OUTPUT,
      description:
        'Project members assigned to the module. Read-only in v2 — module membership is not yet writable through the v2 API.',
    },
    sort_order: { ...SORTORDER6ECB16_OUTPUT, description: 'Sort order' },
    logo_props: { ...LOGOPROPSE3E3C2_OUTPUT, description: 'Logo props' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    archived_at: {
      ...ARCHIVEDATDD21A8_OUTPUT,
      description: 'When the module was archived, or `null` for an active module.',
    },
    created_at: { ...CREATEDATEAC330_OUTPUT, description: 'When the module was created.' },
    created_by_id: { ...CREATEDBYIDC85A02_OUTPUT, description: 'The user who created the module.' },
    lead: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Lead' },
    members: { ...POINTS_OUTPUT, description: 'Members' },
  },
}

export const PLANEV2V2LISTPERMISSIONSCHEMESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Permission Schemesresult',
  optional: true,
  properties: {
    data: { ...DATAFC3B83_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2GETPROJECTPERMISSIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Project Permissionsresult',
  optional: true,
  properties: {
    permission_grants: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Permission grants' },
    relation: { ...ASSETID_OUTPUT, description: 'Relation' },
  },
}

export const PLANEV2V2GETWORKSPACEPERMISSIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Workspace Permissionsresult',
  optional: true,
  properties: {
    permission_grants: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Permission grants' },
    relation: { ...ASSETID_OUTPUT, description: 'Relation' },
  },
}

export const PLANEV2V2LISTPROJECTAUTOMATIONACTIVITIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Automation Activitiesresult',
  optional: true,
  properties: {
    data: { ...DATA762D1C_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTPROJECTAUTOMATIONEDGESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Automation Edgesresult',
  optional: true,
  properties: {
    data: { ...DATAB20D42_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTPROJECTAUTOMATIONNODESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Automation Nodesresult',
  optional: true,
  properties: {
    data: { ...DATA7F9216_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTPROJECTAUTOMATIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Automationsresult',
  optional: true,
  properties: {
    data: { ...DATA6BC005_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2PROJECTREGENERATENODEWEBHOOKSECRETRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Project Regenerate Node Webhook Secretresult',
  optional: true,
  properties: { secret: { ...ASSETID_OUTPUT, description: 'Secret' } },
}

export const PLANEV2V2GETPROJECTFEATURESRESULT73A0EF_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Project Featuresresult',
  optional: true,
  properties: {
    is_automated_cycle_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is automated cycle enabled',
    },
    is_epic_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is epic enabled' },
    is_manually_start_end_cycles_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is manually start end cycles enabled',
    },
    is_milestone_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is milestone enabled' },
    is_parallel_cycles_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is parallel cycles enabled',
    },
    is_project_updates_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is project updates enabled',
    },
    is_workflow_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is workflow enabled' },
    epics: { ...EPICS_OUTPUT, description: 'Epics' },
    modules: { ...MODULES_OUTPUT, description: 'Modules' },
    cycles: { ...CYCLES_OUTPUT, description: 'Cycles' },
    views: { ...VIEWS_OUTPUT, description: 'Views' },
    pages: { ...PAGES_OUTPUT, description: 'Pages' },
    intakes: { ...INTAKES_OUTPUT, description: 'Intakes' },
    work_item_types: { ...WORKITEMTYPES_OUTPUT, description: 'Work item types' },
    workflows: { ...WORKFLOWS_OUTPUT, description: 'Workflows' },
    parallel_cycles: { ...PARALLELCYCLES_OUTPUT, description: 'Parallel cycles' },
    project_updates: { ...PROJECTUPDATES_OUTPUT, description: 'Project updates' },
  },
}

export const PLANEV2V2UPDATEPROJECTFEATURESRESULT8240B7_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Update Project Featuresresult',
  optional: true,
  properties: {
    is_automated_cycle_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is automated cycle enabled',
    },
    is_epic_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is epic enabled' },
    is_manually_start_end_cycles_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is manually start end cycles enabled',
    },
    is_milestone_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is milestone enabled' },
    is_parallel_cycles_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is parallel cycles enabled',
    },
    is_project_updates_enabled: {
      ...HASPAGES8E2BC3_OUTPUT,
      description: 'Is project updates enabled',
    },
    is_workflow_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is workflow enabled' },
    epics: { ...EPICS_OUTPUT, description: 'Epics' },
    modules: { ...MODULES_OUTPUT, description: 'Modules' },
    cycles: { ...CYCLES_OUTPUT, description: 'Cycles' },
    views: { ...VIEWS_OUTPUT, description: 'Views' },
    pages: { ...PAGES_OUTPUT, description: 'Pages' },
    intakes: { ...INTAKES_OUTPUT, description: 'Intakes' },
    work_item_types: { ...WORKITEMTYPES_OUTPUT, description: 'Work item types' },
    workflows: { ...WORKFLOWS_OUTPUT, description: 'Workflows' },
    parallel_cycles: { ...PARALLELCYCLES_OUTPUT, description: 'Parallel cycles' },
    project_updates: { ...PROJECTUPDATES_OUTPUT, description: 'Project updates' },
  },
}

const ACCESS5296B7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Access',
  optional: true,
  nullable: true,
}

const COLLECTIONID6C8C33_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Collection Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONSTRIPPED03385F_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description Stripped',
  optional: true,
  nullable: true,
}

const ISLOCKED7FD353_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Locked',
  optional: true,
  nullable: true,
}

const PARENTID66217A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Parent Id',
  optional: true,
  nullable: true,
}

export const PLANEV2PROJECTPAGES0DF14E_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Pages',
  optional: true,
  properties: {
    access: { ...ACCESS5296B7_OUTPUT, description: 'Access' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    collection_id: { ...COLLECTIONID6C8C33_OUTPUT, description: 'Collection id' },
    color: {
      ...COLOR3938EE_OUTPUT,
      description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
    },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    description_stripped: {
      ...DESCRIPTIONSTRIPPED03385F_OUTPUT,
      description: 'Description stripped',
    },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_global: {
      ...ISGLOBAL48E7DF_OUTPUT,
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    is_locked: { ...ISLOCKED7FD353_OUTPUT, description: 'Is locked' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    parent_id: { ...PARENTID66217A_OUTPUT, description: 'Parent id' },
    sort_order: { ...SORTORDERDDAA43_OUTPUT, description: 'Sort order' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    owned_by: { ...OWNEDBY18E538_OUTPUT, description: 'Owned by' },
    parent: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Parent' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    anchor: { ...ANCHOR_OUTPUT, description: 'Anchor' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    projects: { ...PROJECTS_OUTPUT, description: 'Projects' },
    page_collection_id: { ...PAGECOLLECTIONID_OUTPUT, description: 'Page collection id' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...CYCLE883343_OUTPUT, description: 'Updated by' },
    description_json: { ...DESCRIPTIONJSON0B33AD_OUTPUT, description: 'Description json' },
  },
}

export const PLANEV2PROJECTPAGES6B917A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Pages',
  optional: true,
  properties: {
    access: { ...ACCESS5296B7_OUTPUT, description: 'Access' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    collection_id: { ...COLLECTIONID6C8C33_OUTPUT, description: 'Collection id' },
    color: {
      ...COLOR3938EE_OUTPUT,
      description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
    },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    description_stripped: {
      ...DESCRIPTIONSTRIPPED03385F_OUTPUT,
      description: 'Description stripped',
    },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_global: {
      ...ISGLOBAL48E7DF_OUTPUT,
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    is_locked: { ...ISLOCKED7FD353_OUTPUT, description: 'Is locked' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    parent_id: { ...PARENTID66217A_OUTPUT, description: 'Parent id' },
    sort_order: { ...SORTORDERDDAA43_OUTPUT, description: 'Sort order' },
    view_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'View props' },
    owned_by: { ...OWNEDBY18E538_OUTPUT, description: 'Owned by' },
    parent: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Parent' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    anchor: { ...ANCHOR_OUTPUT, description: 'Anchor' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    projects: { ...PROJECTS_OUTPUT, description: 'Projects' },
    page_collection_id: { ...PAGECOLLECTIONID_OUTPUT, description: 'Page collection id' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ID045D22_OUTPUT, description: 'Updated by' },
    description_json: { ...DESCRIPTIONJSON0B33AD_OUTPUT, description: 'Description json' },
  },
}

const DATA546E02_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Pages',
    properties: {
      access: { type: 'number', description: 'Who can see this.', optional: true },
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      collection_id: {
        type: 'string',
        description: 'The related collection.',
        optional: true,
        nullable: true,
      },
      color: {
        type: 'string',
        description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      description_stripped: {
        type: 'string',
        description: 'The description stripped.',
        optional: true,
      },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_global: {
        type: 'boolean',
        description: 'Whether this lives at the workspace level rather than inside a project.',
        optional: true,
      },
      is_locked: {
        type: 'boolean',
        description: 'Prevents further edits to the content.',
        optional: true,
      },
      logo_props: { type: 'json', description: 'View Props', optional: true, nullable: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      owned_by_id: { type: 'string', description: 'The related owned by.', optional: true },
      parent_id: {
        type: 'string',
        description: 'The related parent.',
        optional: true,
        nullable: true,
      },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      view_props: { type: 'json', description: 'View Props', optional: true, nullable: true },
      owned_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      parent: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTPROJECTPAGESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Pagesresult',
  optional: true,
  properties: {
    data: { ...DATA546E02_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2PROJECTVIEWS116A1A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Views',
  optional: true,
  properties: {
    access: { ...ACCESS97D6DB_OUTPUT, description: 'Who can see this.' },
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    display_filters: { ...DISPLAYFILTERS_OUTPUT, description: 'Display filters' },
    display_properties: { ...DISPLAYPROPERTIES_OUTPUT, description: 'Display properties' },
    filters: { ...FILTERS_OUTPUT, description: 'Filters' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_locked: { ...ISLOCKEDCA86CF_OUTPUT, description: 'Prevents further edits to the content.' },
    logo_props: { ...LOGOPROPS06ABC6_OUTPUT, description: 'Logo props' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    pql_filters: { ...PQLFILTERS_OUTPUT, description: 'Pql filters' },
    query: { ...QUERY_OUTPUT, description: 'Query' },
    sort_order: { ...SORTORDERDDAA43_OUTPUT, description: 'Sort order' },
    owned_by: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Owned by' },
  },
}

const DATA35E294_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Project- Views',
    properties: {
      access: { type: 'number', description: 'Who can see this.', optional: true },
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      display_filters: {
        type: 'string',
        description: 'Saved display options — grouping, ordering and layout.',
        optional: true,
        nullable: true,
      },
      display_properties: {
        type: 'string',
        description: 'The display properties.',
        optional: true,
        nullable: true,
      },
      filters: {
        type: 'string',
        description: 'Saved filter set, in the same shape the list endpoints accept.',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_locked: {
        type: 'boolean',
        description: 'Prevents further edits to the content.',
        optional: true,
      },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      owned_by_id: { type: 'string', description: 'The related owned by.', optional: true },
      pql_filters: {
        type: 'string',
        description: 'The pql filters.',
        optional: true,
        nullable: true,
      },
      query: { type: 'string', description: 'The query.', optional: true, nullable: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      owned_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTPROJECTVIEWSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Viewsresult',
  optional: true,
  properties: {
    data: { ...DATA35E294_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTPROJECTWORKITEMTEMPLATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Project Work Item Templatesresult',
  optional: true,
  properties: {
    data: { ...DATABAA83A_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2PROJECTWORKITEMTEMPLATESA6462F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Project- Work- Item- Templates',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_published: { ...ISPUBLISHED013D88_OUTPUT, description: 'Whether is published.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    short_description: { ...SHORTDESCRIPTION_OUTPUT, description: 'The short description.' },
    short_id: { ...SHORTID_OUTPUT, description: 'The related short.' },
    slug: { ...SLUG_OUTPUT, description: 'The slug.' },
    template_data: { ...TEMPLATEDATA_OUTPUT, description: 'The template data.' },
    template_type: { ...TEMPLATETYPE_OUTPUT, description: 'The template type.' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    assignee_ids: { ...PROJECTIDS76D572_OUTPUT, description: 'Assignee ids' },
    custom_fields: { ...LOGOPROPSB439A5_OUTPUT, description: 'Custom fields' },
    cycle_id: { ...ASSETID_OUTPUT, description: 'Cycle id' },
    identifier: { ...ASSETID_OUTPUT, description: 'Identifier' },
    is_draft: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is draft' },
    label_ids: { ...PROJECTIDS76D572_OUTPUT, description: 'Label ids' },
    module_ids: { ...PROJECTIDS76D572_OUTPUT, description: 'Module ids' },
    parent_id: { ...ASSETID_OUTPUT, description: 'Parent id' },
    priority: { ...ASSETID_OUTPUT, description: 'Priority' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    sequence_id: { ...ASSETID_OUTPUT, description: 'Sequence id' },
    start_date: { ...ASSETID_OUTPUT, description: 'Start date' },
    state_id: { ...ASSETID_OUTPUT, description: 'State id' },
    target_date: { ...ASSETID_OUTPUT, description: 'Target date' },
    type_id: { ...ASSETID_OUTPUT, description: 'Type id' },
    assignees: { ...ASSIGNEESE6F198_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELSAFCC9F_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Parent' },
    state: { ...STATEF1F313_OUTPUT, description: 'State' },
    type: { ...TYPEF949C2_OUTPUT, description: 'Type' },
  },
}

export const PLANEV2V2BULKCREATEPROJECTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Projectsresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATEPROJECTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Projectsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

const DEFAULTASSIGNEEID053282_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related default assignee.',
  optional: true,
  nullable: true,
}

const DEFAULTSTATEIDD87CD6_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related default state.',
  optional: true,
  nullable: true,
}

const ESTIMATEID113377_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related estimate.',
  optional: true,
  nullable: true,
}

const PROJECTLEADIDD4DEA5_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'The related project lead.',
  optional: true,
  nullable: true,
}

const STARTDATE33401B_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Planned start date, as `YYYY-MM-DD`.',
  optional: true,
  nullable: true,
}

const TARGETDATE3E40FB_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Planned due date, as `YYYY-MM-DD`.',
  optional: true,
  nullable: true,
}

const TOTALMEMBERS8C880E_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Total  Members',
  optional: true,
  nullable: true,
}

const TOTALCYCLESB4C52C_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Total  Cycles',
  optional: true,
  nullable: true,
}

const TOTALMODULES622341_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Total  Modules',
  optional: true,
  nullable: true,
}

const MEMBERROLE94A311_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Member  Role',
  optional: true,
  nullable: true,
}

const DESCRIPTIONHTML6297F0_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description  Html',
  optional: true,
  nullable: true,
}

const NETWORKA4C6F8_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Network',
  optional: true,
  nullable: true,
}

const ARCHIVEINA22D77_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Archive  In',
  optional: true,
  nullable: true,
}

const CLOSEIN86AC39_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Close  In',
  optional: true,
  nullable: true,
}

export const PROJECT26B734_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Project model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    total_members: { ...TOTALMEMBERS8C880E_OUTPUT, description: 'Total members' },
    total_cycles: { ...TOTALCYCLESB4C52C_OUTPUT, description: 'Total cycles' },
    total_modules: { ...TOTALMODULES622341_OUTPUT, description: 'Total modules' },
    is_member: { ...ISMEMBER_OUTPUT, description: 'Is member' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    member_role: { ...MEMBERROLE94A311_OUTPUT, description: 'Member role' },
    is_deployed: { ...ISDEPLOYED_OUTPUT, description: 'Is deployed' },
    cover_image_url: { ...COVERIMAGEURL_OUTPUT, description: 'Cover image url' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    description_text: { ...DESCRIPTIONTEXT_OUTPUT, description: 'Description text' },
    description_html: { ...DESCRIPTIONHTML6297F0_OUTPUT, description: 'Description html' },
    network: { ...NETWORKA4C6F8_OUTPUT, description: 'Network' },
    identifier: { ...IDENTIFIER_OUTPUT, description: 'Identifier' },
    emoji: { ...EMOJI_OUTPUT, description: 'Emoji' },
    icon_prop: { ...ICONPROP_OUTPUT, description: 'Icon prop' },
    module_view: { ...MODULEVIEW_OUTPUT, description: 'Module view' },
    cycle_view: { ...CYCLEVIEW_OUTPUT, description: 'Cycle view' },
    issue_views_view: { ...ISSUEVIEWSVIEW_OUTPUT, description: 'Issue views view' },
    page_view: { ...PAGEVIEW_OUTPUT, description: 'Page view' },
    intake_view: { ...INTAKEVIEW_OUTPUT, description: 'Intake view' },
    is_time_tracking_enabled: {
      ...ISTIMETRACKINGENABLED_OUTPUT,
      description: 'Is time tracking enabled',
    },
    is_issue_type_enabled: { ...ISISSUETYPEENABLED_OUTPUT, description: 'Is issue type enabled' },
    guest_view_all_features: {
      ...GUESTVIEWALLFEATURES_OUTPUT,
      description: 'Guest view all features',
    },
    cover_image: { ...COVERIMAGE_OUTPUT, description: 'Cover image' },
    archive_in: { ...ARCHIVEINA22D77_OUTPUT, description: 'Archive in' },
    close_in: { ...CLOSEIN86AC39_OUTPUT, description: 'Close in' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    timezone: { ...TIMEZONE7677DD_OUTPUT, description: 'Timezone' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    default_assignee: { ...DEFAULTASSIGNEE13325E_OUTPUT, description: 'Default assignee' },
    project_lead: { ...PROJECTLEADAF8C35_OUTPUT, description: 'Project lead' },
    cover_image_asset: { ...COVERIMAGEASSET_OUTPUT, description: 'Cover image asset' },
    estimate: { ...ESTIMATE_OUTPUT, description: 'Estimate' },
    default_state: { ...DEFAULTSTATE_OUTPUT, description: 'Default state' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
    priority: { ...ASSETID_OUTPUT, description: 'Priority' },
    start_date: { ...ID045D22_OUTPUT, description: 'Start date' },
    target_date: { ...ID045D22_OUTPUT, description: 'Target date' },
    is_voting_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is voting enabled' },
    auto_reminder_days: { ...SORTORDERDDE3E5_OUTPUT, description: 'Auto reminder days' },
    state: { ...ASSETID_OUTPUT, description: 'State' },
  },
}

const ARCHIVEIN7FC1E5_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Archive In',
  optional: true,
  nullable: true,
}

const CLOSEIN282462_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Close In',
  optional: true,
  nullable: true,
}

const COVERIMAGE5A836D_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Cover Image',
  optional: true,
  nullable: true,
}

const COVERIMAGEURL859208_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Cover Image Url',
  optional: true,
  nullable: true,
}

const CYCLEVIEW4330ED_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Cycle View',
  optional: true,
  nullable: true,
}

const EMOJIFC2580_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Emoji',
  optional: true,
  nullable: true,
}

const GUESTVIEWALLFEATURESB22645_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Guest View All Features',
  optional: true,
  nullable: true,
}

const ICONPROPF95060_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Icon Prop',
  optional: true,
  nullable: true,
}

const INTAKEVIEWB5D6F1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Intake View',
  optional: true,
  nullable: true,
}

const ISISSUETYPEENABLED2CC661_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Issue Type Enabled',
  optional: true,
  nullable: true,
}

const ISTIMETRACKINGENABLEDB95246_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Time Tracking Enabled',
  optional: true,
  nullable: true,
}

const ISSUEVIEWSVIEW899C2A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Issue Views View',
  optional: true,
  nullable: true,
}

const MODULEVIEW385B9A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Module View',
  optional: true,
  nullable: true,
}

const NETWORK1A0ADB_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Network',
  optional: true,
  nullable: true,
}

const PAGEVIEWD0CD10_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Page View',
  optional: true,
  nullable: true,
}

const TIMEZONE35D490_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Timezone',
  optional: true,
  nullable: true,
}

export const PLANEV2PROJECTS80208C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Projects',
  optional: true,
  properties: {
    archive_in: { ...ARCHIVEIN7FC1E5_OUTPUT, description: 'Archive in' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    close_in: { ...CLOSEIN282462_OUTPUT, description: 'Close in' },
    cover_image: { ...COVERIMAGE5A836D_OUTPUT, description: 'Cover image' },
    cover_image_url: { ...COVERIMAGEURL859208_OUTPUT, description: 'Cover image url' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    cycle_view: { ...CYCLEVIEW4330ED_OUTPUT, description: 'Cycle view' },
    default_assignee_id: { ...DEFAULTASSIGNEEID053282_OUTPUT, description: 'Default assignee id' },
    default_state_id: { ...DEFAULTSTATEIDD87CD6_OUTPUT, description: 'Default state id' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    emoji: { ...EMOJIFC2580_OUTPUT, description: 'Emoji' },
    estimate_id: { ...ESTIMATEID113377_OUTPUT, description: 'Estimate id' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    guest_view_all_features: {
      ...GUESTVIEWALLFEATURESB22645_OUTPUT,
      description: 'Guest view all features',
    },
    icon_prop: { ...ICONPROPF95060_OUTPUT, description: 'Icon prop' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    identifier: {
      ...IDENTIFIER74E88F_OUTPUT,
      description:
        'Short project key used to prefix work item numbers, for example `ENG` in `ENG-142`.',
    },
    intake_view: { ...INTAKEVIEWB5D6F1_OUTPUT, description: 'Intake view' },
    is_issue_type_enabled: {
      ...ISISSUETYPEENABLED2CC661_OUTPUT,
      description: 'Is issue type enabled',
    },
    is_time_tracking_enabled: {
      ...ISTIMETRACKINGENABLEDB95246_OUTPUT,
      description: 'Is time tracking enabled',
    },
    issue_views_view: { ...ISSUEVIEWSVIEW899C2A_OUTPUT, description: 'Issue views view' },
    logo_props: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Logo props' },
    module_view: { ...MODULEVIEW385B9A_OUTPUT, description: 'Module view' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    network: { ...NETWORK1A0ADB_OUTPUT, description: 'Network' },
    page_view: { ...PAGEVIEWD0CD10_OUTPUT, description: 'Page view' },
    priority: { ...PRIORITY0D388C_OUTPUT, description: 'Urgency of the work item.' },
    project_lead_id: { ...PROJECTLEADIDD4DEA5_OUTPUT, description: 'Project lead id' },
    start_date: { ...STARTDATE33401B_OUTPUT, description: 'Start date' },
    state_id: { ...STATEIDDDFC84_OUTPUT, description: 'The related state.' },
    target_date: { ...TARGETDATE3E40FB_OUTPUT, description: 'Target date' },
    timezone: { ...TIMEZONE35D490_OUTPUT, description: 'Timezone' },
    default_assignee: { ...OWNEDBY18E538_OUTPUT, description: 'Default assignee' },
    project_lead: { ...OWNEDBY18E538_OUTPUT, description: 'Project lead' },
    total_members: { ...TOTALMEMBERS8C880E_OUTPUT, description: 'Total members' },
    total_cycles: { ...TOTALCYCLESB4C52C_OUTPUT, description: 'Total cycles' },
    total_modules: { ...TOTALMODULES622341_OUTPUT, description: 'Total modules' },
    is_member: { ...ISMEMBER_OUTPUT, description: 'Is member' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    member_role: { ...MEMBERROLE94A311_OUTPUT, description: 'Member role' },
    is_deployed: { ...ISDEPLOYED_OUTPUT, description: 'Is deployed' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    description_text: { ...DESCRIPTIONTEXT_OUTPUT, description: 'Description text' },
    description_html: { ...DESCRIPTIONHTML6297F0_OUTPUT, description: 'Description html' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    cover_image_asset: { ...COVERIMAGEASSET_OUTPUT, description: 'Cover image asset' },
    estimate: { ...ESTIMATE_OUTPUT, description: 'Estimate' },
    default_state: { ...DEFAULTSTATE_OUTPUT, description: 'Default state' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
    is_voting_enabled: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is voting enabled' },
    auto_reminder_days: { ...SORTORDERDDE3E5_OUTPUT, description: 'Auto reminder days' },
    state: { ...ASSETID_OUTPUT, description: 'State' },
  },
}

const COUNTS311075_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Counts',
  optional: true,
  properties: {
    members: { type: 'number', description: 'Sort Order', optional: true },
    states: { type: 'number', description: 'Sort Order', optional: true },
    labels: { type: 'number', description: 'Sort Order', optional: true },
    cycles: { type: 'number', description: 'Sort Order', optional: true },
    modules: { type: 'number', description: 'Sort Order', optional: true },
    issues: { type: 'number', description: 'Sort Order', optional: true },
    intakes: { type: 'number', description: 'Sort Order', optional: true },
    pages: { type: 'number', description: 'Sort Order', optional: true },
  },
}

export const PLANEV2V2GETPROJECTSUMMARYRESULT4F96BD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Project Summaryresult',
  optional: true,
  properties: {
    counts: { ...COUNTS311075_OUTPUT, description: 'Counts' },
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    identifier: { ...ASSETID_OUTPUT, description: 'Identifier' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
  },
}

const DATAD9F118_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Projects',
    properties: {
      archive_in: { type: 'number', description: 'The archive in.', optional: true },
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      close_in: { type: 'number', description: 'The close in.', optional: true },
      cover_image: {
        type: 'string',
        description: 'URL of the cover image.',
        optional: true,
        nullable: true,
      },
      cover_image_url: {
        type: 'string',
        description: 'The cover image url.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      cycle_view: { type: 'boolean', description: 'Whether cycle view.', optional: true },
      default_assignee_id: {
        type: 'string',
        description: 'The related default assignee.',
        optional: true,
        nullable: true,
      },
      default_state_id: {
        type: 'string',
        description: 'The related default state.',
        optional: true,
        nullable: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      emoji: {
        type: 'string',
        description: 'Emoji shown alongside the name.',
        optional: true,
        nullable: true,
      },
      estimate_id: {
        type: 'string',
        description: 'The related estimate.',
        optional: true,
        nullable: true,
      },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      guest_view_all_features: {
        type: 'boolean',
        description: 'Whether guest view all features.',
        optional: true,
      },
      icon_prop: { type: 'string', description: 'The icon prop.', optional: true, nullable: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      identifier: {
        type: 'string',
        description:
          'Short project key used to prefix work item numbers, for example `ENG` in `ENG-142`.',
        optional: true,
      },
      intake_view: { type: 'boolean', description: 'Whether intake view.', optional: true },
      is_issue_type_enabled: {
        type: 'boolean',
        description: 'Whether is issue type enabled.',
        optional: true,
      },
      is_time_tracking_enabled: {
        type: 'boolean',
        description: 'Whether is time tracking enabled.',
        optional: true,
      },
      issue_views_view: {
        type: 'boolean',
        description: 'Whether issue views view.',
        optional: true,
      },
      logo_props: { type: 'json', description: 'View Props', optional: true, nullable: true },
      module_view: { type: 'boolean', description: 'Whether module view.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      network: {
        type: 'number',
        description:
          'Project visibility: `0` is private to members, `2` is visible to the whole workspace.',
        optional: true,
      },
      page_view: { type: 'boolean', description: 'Whether page view.', optional: true },
      priority: { type: 'string', description: 'Urgency of the work item.', optional: true },
      project_lead_id: {
        type: 'string',
        description: 'The related project lead.',
        optional: true,
        nullable: true,
      },
      start_date: {
        type: 'string',
        description: 'Planned start date, as `YYYY-MM-DD`.',
        optional: true,
        nullable: true,
      },
      state_id: { type: 'string', description: 'The related state.', optional: true },
      target_date: {
        type: 'string',
        description: 'Planned due date, as `YYYY-MM-DD`.',
        optional: true,
        nullable: true,
      },
      timezone: {
        type: 'string',
        description: 'IANA timezone name, for example `America/New_York`.',
        optional: true,
      },
      default_assignee: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      project_lead: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTPROJECTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Projectsresult',
  optional: true,
  properties: {
    data: { ...DATAD9F118_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2PROJECTS30F866_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Projects',
  optional: true,
  properties: {
    archive_in: { ...ARCHIVEIN875827_OUTPUT, description: 'The archive in.' },
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    close_in: { ...CLOSEIN4103EE_OUTPUT, description: 'The close in.' },
    cover_image: { ...COVERIMAGE1C99D0_OUTPUT, description: 'URL of the cover image.' },
    cover_image_url: { ...COVERIMAGEURL4A1253_OUTPUT, description: 'The cover image url.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    cycle_view: { ...CYCLEVIEW2B2A92_OUTPUT, description: 'Whether cycle view.' },
    default_assignee_id: {
      ...DEFAULTASSIGNEEID_OUTPUT,
      description: 'The related default assignee.',
    },
    default_state_id: { ...DEFAULTSTATEID_OUTPUT, description: 'The related default state.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    emoji: { ...EMOJI40B5B7_OUTPUT, description: 'Emoji shown alongside the name.' },
    estimate_id: { ...ESTIMATEID_OUTPUT, description: 'The related estimate.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    guest_view_all_features: {
      ...GUESTVIEWALLFEATURES786ECF_OUTPUT,
      description: 'Whether guest view all features.',
    },
    icon_prop: { ...ICONPROP8D9DE6_OUTPUT, description: 'Icon prop' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    identifier: {
      ...IDENTIFIER74E88F_OUTPUT,
      description:
        'Short project key used to prefix work item numbers, for example `ENG` in `ENG-142`.',
    },
    intake_view: { ...INTAKEVIEWADF501_OUTPUT, description: 'Whether intake view.' },
    is_issue_type_enabled: {
      ...ISISSUETYPEENABLED0467A8_OUTPUT,
      description: 'Whether is issue type enabled.',
    },
    is_time_tracking_enabled: {
      ...ISTIMETRACKINGENABLEDC98808_OUTPUT,
      description: 'Whether is time tracking enabled.',
    },
    issue_views_view: { ...ISSUEVIEWSVIEW9A6DA4_OUTPUT, description: 'Whether issue views view.' },
    logo_props: { ...LOGOPROPS06ABC6_OUTPUT, description: 'Logo props' },
    module_view: { ...MODULEVIEWFF7A9C_OUTPUT, description: 'Whether module view.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    network: {
      ...NETWORKAB7E29_OUTPUT,
      description:
        'Project visibility: `0` is private to members, `2` is visible to the whole workspace.',
    },
    page_view: { ...PAGEVIEW884451_OUTPUT, description: 'Whether page view.' },
    priority: { ...PRIORITY0D388C_OUTPUT, description: 'Urgency of the work item.' },
    project_lead_id: { ...PROJECTLEADID_OUTPUT, description: 'The related project lead.' },
    start_date: { ...STARTDATE43E866_OUTPUT, description: 'Planned start date, as `YYYY-MM-DD`.' },
    state_id: { ...STATEIDDDFC84_OUTPUT, description: 'The related state.' },
    target_date: { ...TARGETDATE7B0AB1_OUTPUT, description: 'Planned due date, as `YYYY-MM-DD`.' },
    timezone: {
      ...TIMEZONE852348_OUTPUT,
      description: 'IANA timezone name, for example `America/New_York`.',
    },
    default_assignee: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Default assignee' },
    project_lead: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Project lead' },
  },
}

export const RELEASECOMMENT65D33F_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Release comment response model.\n\n`comment` is a nested object ({description_html, ...}). Write it with\n`comment_html`.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    comment: { ...COMMENTFBE0C5_OUTPUT, description: 'Comment' },
    is_hidden: { ...ISHIDDEN_OUTPUT, description: 'Is hidden' },
    is_resolved: { ...ISRESOLVED_OUTPUT, description: 'Is resolved' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    edited_at: { ...EDITEDAT_OUTPUT, description: 'Edited at' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    release: { ...RELEASE5C8689_OUTPUT, description: 'Release' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

const EDITEDAT365E47_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Edited At',
  optional: true,
  nullable: true,
}

const ISHIDDENF40267_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Hidden',
  optional: true,
  nullable: true,
}

const ISRESOLVED168438_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Resolved',
  optional: true,
  nullable: true,
}

export const PLANEV2RELEASECOMMENTS9A1F27_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Release- Comments',
  optional: true,
  properties: {
    comment_html: { ...COMMENTHTMLF4A8CB_OUTPUT, description: 'The comment html.' },
    comment_id: { ...COMMENTID_OUTPUT, description: 'The related comment.' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    edited_at: { ...EDITEDAT365E47_OUTPUT, description: 'Edited at' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_hidden: { ...ISHIDDENF40267_OUTPUT, description: 'Is hidden' },
    is_resolved: { ...ISRESOLVED168438_OUTPUT, description: 'Is resolved' },
    parent_id: { ...PARENTID280851_OUTPUT, description: 'The related parent.' },
    release_id: { ...RELEASEID_OUTPUT, description: 'The related release.' },
    comment: { ...COMMENTFBE0C5_OUTPUT, description: 'Comment' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    release: { ...RELEASE5C8689_OUTPUT, description: 'Release' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

export const PLANEV2V2LISTRELEASECOMMENTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Release Commentsresult',
  optional: true,
  properties: {
    data: { ...DATAF71C33_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const RELEASELABEL1B6179_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Release label response model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    project: { ...PROJECT24481A_OUTPUT, description: 'Project (nullable provider value).' },
  },
}

const SORTORDER818CA7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

export const PLANEV2RELEASELABELS0DF496_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Release- Labels',
  optional: true,
  properties: {
    color: { ...COLOR7410A0_OUTPUT, description: 'Color' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    sort_order: { ...SORTORDER818CA7_OUTPUT, description: 'Sort order' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    project: { ...PROJECT24481A_OUTPUT, description: 'Project (nullable provider value).' },
  },
}

export const PLANEV2V2LISTRELEASELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Release Labelsresult',
  optional: true,
  properties: {
    data: { ...DATA1C20E4_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const RELEASELINK8C1F1B_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Release link response model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    title: { ...TITLE_OUTPUT, description: 'Title' },
    url: { ...URLB58D03_OUTPUT, description: 'Url' },
    metadata: { ...METADATA_OUTPUT, description: 'Metadata' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    release: { ...RELEASE5C8689_OUTPUT, description: 'Release' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
  },
}

const METADATAF0A51F_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Metadata',
  optional: true,
  nullable: true,
}

const TITLED12A0D_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Title',
  optional: true,
  nullable: true,
}

const URL1B5397_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Url',
  optional: true,
  nullable: true,
}

export const PLANEV2RELEASELINKS259DD6_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Release- Links',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    metadata: { ...METADATAF0A51F_OUTPUT, description: 'Metadata' },
    release_id: { ...RELEASEID_OUTPUT, description: 'The related release.' },
    title: { ...TITLED12A0D_OUTPUT, description: 'Title' },
    url: { ...URL1B5397_OUTPUT, description: 'Url' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    release: { ...RELEASE5C8689_OUTPUT, description: 'Release' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
  },
}

export const PLANEV2V2LISTRELEASELINKSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Release Linksresult',
  optional: true,
  properties: {
    data: { ...DATA1F7F03_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const RELEASETAG5B2B5E_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Release tag response model.\n\nA tag is a version marker (version + optional git metadata), not a label.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    version: { ...VERSIONE55854_OUTPUT, description: 'Version' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    commit_hash: { ...COMMITHASH_OUTPUT, description: 'Commit hash' },
    git_tag: { ...GITTAG_OUTPUT, description: 'Git tag' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT24481A_OUTPUT, description: 'Project (nullable provider value).' },
  },
}

const COMMITHASHBD32CD_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Commit Hash',
  optional: true,
  nullable: true,
}

const GITTAGF6208D_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Git Tag',
  optional: true,
  nullable: true,
}

const VERSION3910B0_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Version',
  optional: true,
  nullable: true,
}

export const PLANEV2RELEASETAGSB985E4_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Release- Tags',
  optional: true,
  properties: {
    commit_hash: { ...COMMITHASHBD32CD_OUTPUT, description: 'Commit hash' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    git_tag: { ...GITTAGF6208D_OUTPUT, description: 'Git tag' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    version: { ...VERSION3910B0_OUTPUT, description: 'Version' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT24481A_OUTPUT, description: 'Project (nullable provider value).' },
  },
}

export const PLANEV2V2LISTRELEASETAGSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Release Tagsresult',
  optional: true,
  properties: {
    data: { ...DATA202B62_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const RELEASE55EE53_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Release response model.\n\n`description` is returned as a nested object ({description_html, description_json,\n...}), not a plain string. Write it with `description_html` / `description_json`\non create/update.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION2C8FE8_OUTPUT, description: 'Description' },
    status: { ...STATUS4B8517_OUTPUT, description: 'Status' },
    target_date: { ...TARGETDATE_OUTPUT, description: 'Target date' },
    release_date: { ...RELEASEDATE_OUTPUT, description: 'Release date' },
    lead: { ...LEAD_OUTPUT, description: 'Lead' },
    tag: { ...TAG_OUTPUT, description: 'Tag' },
    is_latest: { ...ISLATEST_OUTPUT, description: 'Is latest' },
    is_prerelease: { ...ISPRERELEASE_OUTPUT, description: 'Is prerelease' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    project: { ...PROJECT24481A_OUTPUT, description: 'Project (nullable provider value).' },
  },
}

const ISLATEST856672_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Latest',
  optional: true,
  nullable: true,
}

const ISPRERELEASED11216_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Prerelease',
  optional: true,
  nullable: true,
}

const RELEASEDATE82E1C5_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Release Date',
  optional: true,
  nullable: true,
}

const STATUSAF139B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Status',
  optional: true,
  nullable: true,
}

export const PLANEV2RELEASES2F1360_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Releases',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    description_id: { ...DESCRIPTIONID_OUTPUT, description: 'The related description.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_latest: { ...ISLATEST856672_OUTPUT, description: 'Is latest' },
    is_prerelease: { ...ISPRERELEASED11216_OUTPUT, description: 'Is prerelease' },
    label_ids: { ...LABELIDS7D9FA4_OUTPUT, description: 'Ids of the associated labels.' },
    lead_id: { ...LEADID_OUTPUT, description: 'The related lead.' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    release_date: { ...RELEASEDATE82E1C5_OUTPUT, description: 'Release date' },
    status: { ...STATUSAF139B_OUTPUT, description: 'Status' },
    tag_id: { ...TAGID_OUTPUT, description: 'The related tag.' },
    target_date: { ...TARGETDATE1D7269_OUTPUT, description: 'Target date' },
    lead: { ...OWNEDBY18E538_OUTPUT, description: 'Lead' },
    tag: { ...OWNEDBY18E538_OUTPUT, description: 'Tag' },
    description: { ...DESCRIPTION2C8FE8_OUTPUT, description: 'Description' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    project: { ...PROJECT24481A_OUTPUT, description: 'Project (nullable provider value).' },
  },
}

export const PLANEV2RELEASES6E73E7_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Releases',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: {
      ...DESCRIPTIONHTML92A7E9_OUTPUT,
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    description_id: { ...DESCRIPTIONID_OUTPUT, description: 'The related description.' },
    external_id: {
      ...EXTERNALIDBA2ED6_OUTPUT,
      description: "Your system's identifier for this record, for sync and import correlation.",
    },
    external_source: {
      ...EXTERNALSOURCEDF9B11_OUTPUT,
      description: 'The system `external_id` came from, for example `github` or `jira`.',
    },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_latest: { ...ISLATEST2376D0_OUTPUT, description: 'Whether is latest.' },
    is_prerelease: { ...ISPRERELEASE0A132B_OUTPUT, description: 'Whether is prerelease.' },
    label_ids: { ...LABELIDS802308_OUTPUT, description: 'Ids of the associated labels.' },
    lead_id: { ...LEADID_OUTPUT, description: 'The related lead.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    release_date: { ...RELEASEDATE372B24_OUTPUT, description: 'The release date.' },
    status: { ...STATUS56C139_OUTPUT, description: 'The status.' },
    tag_id: { ...TAGID_OUTPUT, description: 'The related tag.' },
    target_date: { ...TARGETDATE7B0AB1_OUTPUT, description: 'Planned due date, as `YYYY-MM-DD`.' },
    changelog_id: { ...ASSETID_OUTPUT, description: 'Changelog id' },
    description_json: { ...ID045D22_OUTPUT, description: 'Description json' },
    release_id: { ...ASSETID_OUTPUT, description: 'Release id' },
    changelog: { ...CHANGELOG_OUTPUT, description: 'Changelog' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    release: { ...RELEASE5C8689_OUTPUT, description: 'Release' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
  },
}

const DATA0FF98B_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Releases',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      description_id: { type: 'string', description: 'The related description.', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_latest: { type: 'boolean', description: 'Whether is latest.', optional: true },
      is_prerelease: { type: 'boolean', description: 'Whether is prerelease.', optional: true },
      label_ids: {
        type: 'array',
        description: 'Ids of the associated labels.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      lead_id: { type: 'string', description: 'The related lead.', optional: true },
      name: { type: 'string', description: 'Display name.', optional: true },
      release_date: { type: 'string', description: 'The release date.', optional: true },
      status: { type: 'string', description: 'The status.', optional: true },
      tag_id: { type: 'string', description: 'The related tag.', optional: true },
      target_date: {
        type: 'string',
        description: 'Planned due date, as `YYYY-MM-DD`.',
        optional: true,
      },
      lead: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      tag: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTRELEASESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Releasesresult',
  optional: true,
  properties: {
    data: { ...DATA0FF98B_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2MANAGERELEASELABELSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Release Labelsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
  },
}

export const PLANEV2V2MANAGERELEASEWORKITEMSRESULT0E13C5_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Manage Release Work Itemsresult',
  optional: true,
  properties: {
    added: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Added' },
    removed: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Removed' },
    message: { ...ASSETID_OUTPUT, description: 'Message' },
  },
}

export const PLANEV2V2LISTROLESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Rolesresult',
  optional: true,
  properties: {
    data: { ...DATAC7747A_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2BULKCREATESTATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Statesresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETESTATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Statesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATESTATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Statesresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const STATE4B88AE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'State model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    color: { ...COLORBBA70B_OUTPUT, description: 'Color' },
    sequence: { ...SEQUENCE_OUTPUT, description: 'Sequence' },
    group: { ...GROUP_OUTPUT, description: 'Group' },
    is_triage: { ...ISTRIAGE_OUTPUT, description: 'Is triage' },
    default: { ...DEFAULT_OUTPUT, description: 'Default' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    slug: { ...ASSETID_OUTPUT, description: 'Slug' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

const ID0104B0_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONEB47E6_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const GROUP37F580_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Group',
  optional: true,
  nullable: true,
}

const SEQUENCEBE4B18_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sequence',
  optional: true,
  nullable: true,
}

const ISTRIAGE51D413_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Triage',
  optional: true,
  nullable: true,
}

const CREATEDAT1F9096_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

export const PLANEV2STATES28CE24_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 States',
  optional: true,
  properties: {
    id: { ...ID0104B0_OUTPUT, description: 'Id' },
    name: {
      ...NAME55C8FE_OUTPUT,
      description: 'Display name, unique within the project. Maximum 255 characters.',
    },
    description: { ...DESCRIPTIONEB47E6_OUTPUT, description: 'Description' },
    color: {
      ...COLOR742473_OUTPUT,
      description: 'Hex color used wherever the state is rendered, for example `#3f76ff`.',
    },
    group: { ...GROUP37F580_OUTPUT, description: 'Group' },
    sequence: { ...SEQUENCEBE4B18_OUTPUT, description: 'Sequence' },
    is_default: {
      ...ISDEFAULT91F18A_OUTPUT,
      description:
        'Whether new work items land in this state when no `state_id` is supplied. Exactly one state per project is the default.',
    },
    is_triage: { ...ISTRIAGE51D413_OUTPUT, description: 'Is triage' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    created_at: { ...CREATEDAT1F9096_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID3BCA72_OUTPUT, description: 'The user who created the state.' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    default: { ...DEFAULT_OUTPUT, description: 'Default' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    slug: { ...ASSETID_OUTPUT, description: 'Slug' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
  },
}

export const PLANEV2V2LISTSTATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Statesresult',
  optional: true,
  properties: {
    data: { ...DATA283BBF_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const BACKGROUNDCOLOR3B6724_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Background Color',
  optional: true,
  nullable: true,
}

const LOGOPROPS7DF626_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

export const PLANEV2STICKIESF0CED7_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Stickies',
  optional: true,
  properties: {
    background_color: { ...BACKGROUNDCOLOR3B6724_OUTPUT, description: 'Background color' },
    color: { ...COLOR7410A0_OUTPUT, description: 'Color' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    description_stripped: {
      ...DESCRIPTIONSTRIPPED03385F_OUTPUT,
      description: 'Description stripped',
    },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    logo_props: { ...LOGOPROPS7DF626_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    owner_id: { ...OWNERID_OUTPUT, description: 'The related owner.' },
    sort_order: { ...SORTORDER9643A4_OUTPUT, description: 'Sort order' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    owner: { ...OWNER_OUTPUT, description: 'Owner' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    created_by: { ...CYCLE883343_OUTPUT, description: 'Created by' },
    updated_by: { ...CYCLE883343_OUTPUT, description: 'Updated by' },
  },
}

export const PLANEV2V2LISTSTICKIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Stickiesresult',
  optional: true,
  properties: {
    data: { ...DATADEC467_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const STICKY12CFAE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Response model for a sticky.',
  optional: true,
  properties: {
    id: { ...IDE04262_OUTPUT, description: 'Id' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    logo_props: { ...LOGOPROPS235527_OUTPUT, description: 'Logo props' },
    color: { ...COLOR_OUTPUT, description: 'Color' },
    background_color: { ...BACKGROUNDCOLOR_OUTPUT, description: 'Background color' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    owner: { ...OWNER_OUTPUT, description: 'Owner' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...CYCLE883343_OUTPUT, description: 'Deleted at' },
    created_by: { ...CYCLE883343_OUTPUT, description: 'Created by' },
    updated_by: { ...CYCLE883343_OUTPUT, description: 'Updated by' },
    grouped_by: { ...ASSETID_OUTPUT, description: 'Grouped by' },
    sub_grouped_by: { ...ASSETID_OUTPUT, description: 'Sub grouped by' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...ASSETID_OUTPUT, description: 'Next cursor' },
    prev_cursor: { ...ASSETID_OUTPUT, description: 'Prev cursor' },
    next_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Next page results' },
    prev_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Prev page results' },
    count: { ...ACCESS644595_OUTPUT, description: 'Count' },
    total_pages: { ...ACCESS644595_OUTPUT, description: 'Total pages' },
    total_results: { ...ACCESS644595_OUTPUT, description: 'Total results' },
    extra_stats: { ...EXTRASTATS_OUTPUT, description: 'Extra stats (nullable provider value).' },
    results: { ...RESULTS5FA64D_OUTPUT, description: 'Results' },
  },
}

export const TEAMSPACED3D01E_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Teamspace model.',
  optional: true,
  properties: {
    id: { ...IDE04262_OUTPUT, description: 'Id' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description_json: { ...DESCRIPTIONJSON_OUTPUT, description: 'Description json' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    logo_props: { ...LOGOPROPS30A00B_OUTPUT, description: 'Logo props' },
    lead: { ...LEAD_OUTPUT, description: 'Lead' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDATFF28E1_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT43E222_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBYE10D2E_OUTPUT, description: 'Updated by (nullable provider value).' },
  },
}

const LOGOPROPS00C670_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  properties: {
    in_use: { type: 'string', description: 'Asset Id', optional: true },
    emoji: {
      type: 'object',
      description: 'emoji',
      optional: true,
      properties: { value: { type: 'string', description: 'Asset Id', optional: true } },
    },
  },
  nullable: true,
}

export const PLANEV2TEAMSPACES2E5B2F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Teamspaces',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    lead_id: { ...LEADID_OUTPUT, description: 'The related lead.' },
    logo_props: { ...LOGOPROPS00C670_OUTPUT, description: 'Logo props' },
    member_ids: { ...MEMBERIDS139E2A_OUTPUT, description: 'Ids of the associated members.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    project_ids: { ...PROJECTIDSA92388_OUTPUT, description: 'Ids of the associated projects.' },
    lead: { ...OWNEDBY18E538_OUTPUT, description: 'Lead' },
    description_json: { ...DESCRIPTIONJSON_OUTPUT, description: 'Description json' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    updated_at: { ...UPDATEDAT43E222_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBYE10D2E_OUTPUT, description: 'Updated by (nullable provider value).' },
  },
}

const DATA261570_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Teamspaces',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      lead_id: { type: 'string', description: 'The related lead.', optional: true },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      member_ids: {
        type: 'array',
        description: 'Ids of the associated members.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      project_ids: {
        type: 'array',
        description: 'Ids of the associated projects.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      lead: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTTEAMSPACESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Teamspacesresult',
  optional: true,
  properties: {
    data: { ...DATA261570_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2TEAMSPACES5A249D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Teamspaces',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    lead_id: { ...LEADID_OUTPUT, description: 'The related lead.' },
    logo_props: { ...LOGOPROPS00C670_OUTPUT, description: 'Logo props' },
    member_ids: { ...MEMBERIDS139E2A_OUTPUT, description: 'Ids of the associated members.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    project_ids: { ...PROJECTIDSA92388_OUTPUT, description: 'Ids of the associated projects.' },
    lead: { ...OWNEDBY18E538_OUTPUT, description: 'Lead' },
    description_json: { ...DESCRIPTIONJSON_OUTPUT, description: 'Description json' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY7500ED_OUTPUT, description: 'Description binary' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    updated_at: { ...UPDATEDAT43E222_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
  },
}

const FIELDS361C0E_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Fields',
  optional: true,
  properties: {
    'Content-Type': { ...ASSETID_OUTPUT, description: 'Content-type' },
    key: { ...ASSETID_OUTPUT, description: 'Key' },
    'x-amz-algorithm': { ...ASSETID_OUTPUT, description: 'X-amz-algorithm' },
    'x-amz-credential': { ...ASSETID_OUTPUT, description: 'X-amz-credential' },
    'x-amz-date': { ...ASSETID_OUTPUT, description: 'X-amz-date' },
    policy: { ...ASSETID_OUTPUT, description: 'Policy' },
    'x-amz-signature': { ...ASSETID_OUTPUT, description: 'X-amz-signature' },
  },
}

const UPLOADDATA27F4DF_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Upload  Data',
  optional: true,
  properties: {
    url: { ...ASSETID_OUTPUT, description: 'Url' },
    fields: { ...FIELDS361C0E_OUTPUT, description: 'Fields' },
  },
}

export const PLANEV2USERASSETS89DD1A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 User- Assets',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES2FF54B_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    entity_type: { ...ENTITYTYPE7582D6_OUTPUT, description: 'The entity type.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
    user_id: { ...USERID_OUTPUT, description: 'The related user.' },
    asset_id: { ...ASSETID_OUTPUT, description: 'Asset id' },
    upload_data: { ...UPLOADDATA27F4DF_OUTPUT, description: 'Upload data' },
  },
}

export const PLANEV2V2LISTUSERASSETSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List User Assetsresult',
  optional: true,
  properties: {
    data: { ...DATA02BF8D_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWEBHOOKLOGSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Webhook Logsresult',
  optional: true,
  properties: {
    data: { ...DATA5085A5_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWEBHOOKSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Webhooksresult',
  optional: true,
  properties: {
    data: { ...DATA956B74_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2REGENERATEWEBHOOKSECRETRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Regenerate Webhook Secretresult',
  optional: true,
  properties: {
    content_type: { ...ASSETID_OUTPUT, description: 'Content type' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    is_active: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is active' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    scopes: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Scopes' },
    secret_key: { ...ASSETID_OUTPUT, description: 'Secret key' },
    url: { ...ASSETID_OUTPUT, description: 'Url' },
    version: { ...ASSETID_OUTPUT, description: 'Version' },
  },
}

const ACTORF9564C_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const COMMENT959498_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Comment',
  optional: true,
  nullable: true,
}

const EPOCH695E96_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Epoch',
  optional: true,
  nullable: true,
}

const FIELDD6D073_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Field',
  optional: true,
  nullable: true,
}

const NEWVALUE714CE9_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'New Value',
  optional: true,
  nullable: true,
}

const OLDVALUEC23D31_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Old Value',
  optional: true,
  nullable: true,
}

const VERB39C6B6_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Verb',
  optional: true,
  nullable: true,
}

export const PLANEV2WORKITEMACTIVITIES7D9718_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Activities',
  optional: true,
  properties: {
    actor_id: { ...ACTORID_OUTPUT, description: 'The related actor.' },
    comment: { ...COMMENT959498_OUTPUT, description: 'Comment' },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    duration: { ...DURATIONCEC84D_OUTPUT, description: 'Time logged, in minutes.' },
    epoch: { ...EPOCH695E96_OUTPUT, description: 'Epoch' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    field: { ...FIELDD6D073_OUTPUT, description: 'Field' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    issue_comment_id: { ...ISSUECOMMENTID_OUTPUT, description: 'The related issue comment.' },
    new_identifier_id: { ...NEWIDENTIFIERID_OUTPUT, description: 'The related new identifier.' },
    new_value: { ...NEWVALUE714CE9_OUTPUT, description: 'New value' },
    old_identifier_id: { ...OLDIDENTIFIERID_OUTPUT, description: 'The related old identifier.' },
    old_value: { ...OLDVALUEC23D31_OUTPUT, description: 'Old value' },
    verb: { ...VERB39C6B6_OUTPUT, description: 'Verb' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    actor: { ...OWNEDBY18E538_OUTPUT, description: 'Actor' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    attachments: { ...ATTACHMENTS_OUTPUT, description: 'Attachments' },
    old_identifier: { ...OLDIDENTIFIER_OUTPUT, description: 'Old identifier' },
    new_identifier: { ...NEWIDENTIFIER_OUTPUT, description: 'New identifier' },
    project: { ...PROJECT4C8EC3_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    issue_comment: { ...ISSUECOMMENT_OUTPUT, description: 'Issue comment' },
    grouped_by: { ...ASSETID_OUTPUT, description: 'Grouped by' },
    sub_grouped_by: { ...ASSETID_OUTPUT, description: 'Sub grouped by' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...ASSETID_OUTPUT, description: 'Next cursor' },
    prev_cursor: { ...ASSETID_OUTPUT, description: 'Prev cursor' },
    next_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Next page results' },
    prev_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Prev page results' },
    count: { ...ACCESS644595_OUTPUT, description: 'Count' },
    total_pages: { ...ACCESS644595_OUTPUT, description: 'Total pages' },
    total_results: { ...ACCESS644595_OUTPUT, description: 'Total results' },
    extra_stats: { ...EXTRASTATS_OUTPUT, description: 'Extra stats (nullable provider value).' },
    results: { ...RESULTS803362_OUTPUT, description: 'Results' },
  },
}

const DATA8FF7B7_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Activities',
    properties: {
      actor_id: { type: 'string', description: 'The related actor.', optional: true },
      comment: { type: 'string', description: 'The comment.', optional: true },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      duration: { type: 'number', description: 'Time logged, in minutes.', optional: true },
      epoch: { type: 'json', description: 'Epoch', optional: true },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      field: { type: 'string', description: 'The field.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      issue_comment_id: {
        type: 'string',
        description: 'The related issue comment.',
        optional: true,
      },
      new_identifier_id: {
        type: 'string',
        description: 'The related new identifier.',
        optional: true,
      },
      new_value: { type: 'string', description: 'The new value.', optional: true },
      old_identifier_id: {
        type: 'string',
        description: 'The related old identifier.',
        optional: true,
      },
      old_value: { type: 'string', description: 'The old value.', optional: true },
      verb: { type: 'string', description: 'The verb.', optional: true },
      work_item_id: { type: 'string', description: 'The related work item.', optional: true },
      actor: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTACTIVITIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Activitiesresult',
  optional: true,
  properties: {
    data: { ...DATA8FF7B7_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const WORKITEMACTIVITY7FFF5B_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item activity model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    verb: { ...VERB_OUTPUT, description: 'Verb' },
    field: { ...FIELD_OUTPUT, description: 'Field' },
    old_value: { ...OLDVALUE_OUTPUT, description: 'Old value' },
    new_value: { ...NEWVALUE_OUTPUT, description: 'New value' },
    comment: { ...COMMENT_OUTPUT, description: 'Comment' },
    attachments: { ...ATTACHMENTS_OUTPUT, description: 'Attachments' },
    old_identifier: { ...OLDIDENTIFIER_OUTPUT, description: 'Old identifier' },
    new_identifier: { ...NEWIDENTIFIER_OUTPUT, description: 'New identifier' },
    epoch: { ...EPOCH_OUTPUT, description: 'Epoch' },
    project: { ...PROJECT4C8EC3_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE259123_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    issue_comment: { ...ISSUECOMMENT_OUTPUT, description: 'Issue comment' },
    actor: { ...ACTORF9564C_OUTPUT, description: 'Actor' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
  },
}

const USERB09253_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Asset Id',
  optional: true,
  nullable: true,
}

const WORKITEMATTACHMENT6EF93D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item attachment model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    attributes: { ...ATTRIBUTES0D5D79_OUTPUT, description: 'Attributes' },
    asset: { ...ASSET_OUTPUT, description: 'Asset' },
    entity_type: { ...ENTITYTYPE_OUTPUT, description: 'Entity type' },
    entity_identifier: { ...ENTITYIDENTIFIER_OUTPUT, description: 'Entity identifier' },
    is_deleted: { ...ISDELETED_OUTPUT, description: 'Is deleted' },
    is_archived: { ...ISARCHIVED_OUTPUT, description: 'Is archived' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    size: { ...SIZE_OUTPUT, description: 'Size' },
    is_uploaded: { ...ISUPLOADED_OUTPUT, description: 'Is uploaded' },
    storage_metadata: { ...STORAGEMETADATA_OUTPUT, description: 'Storage metadata' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    user: { ...USERB09253_OUTPUT, description: 'User' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    draft_issue: { ...DRAFTISSUE_OUTPUT, description: 'Draft issue' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    comment: { ...COMMENT_OUTPUT, description: 'Comment' },
    page: { ...PAGE_OUTPUT, description: 'Page' },
  },
}

export const PLANEV2WORKITEMATTACHMENTSE3FE99_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Attachments',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES2FF54B_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    asset_id: { ...ASSETID_OUTPUT, description: 'Asset id' },
    attachment: { ...WORKITEMATTACHMENT6EF93D_OUTPUT, description: 'Work item attachment model.' },
    upload_data: { ...UPLOADDATA016C9C_OUTPUT, description: 'Upload data' },
    detail: { ...DETAIL_OUTPUT, description: 'Provider confirmation message.' },
  },
}

export const PLANEV2V2LISTATTACHMENTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Attachmentsresult',
  optional: true,
  properties: {
    data: { ...DATAE25E41_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const WORKITEMATTACHMENTC365E0_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item attachment model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    attributes: { ...ATTRIBUTES0D5D79_OUTPUT, description: 'Attributes' },
    asset: { ...ASSET_OUTPUT, description: 'Asset' },
    entity_type: { ...ENTITYTYPE_OUTPUT, description: 'Entity type' },
    entity_identifier: { ...ENTITYIDENTIFIER_OUTPUT, description: 'Entity identifier' },
    is_deleted: { ...ISDELETED_OUTPUT, description: 'Is deleted' },
    is_archived: { ...ISARCHIVED_OUTPUT, description: 'Is archived' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    size: { ...SIZE_OUTPUT, description: 'Size' },
    is_uploaded: { ...ISUPLOADED_OUTPUT, description: 'Is uploaded' },
    storage_metadata: { ...STORAGEMETADATA_OUTPUT, description: 'Storage metadata' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    user: { ...USERB09253_OUTPUT, description: 'User' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    draft_issue: { ...DRAFTISSUE_OUTPUT, description: 'Draft issue' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    comment: { ...COMMENT_OUTPUT, description: 'Comment' },
    page: { ...PAGE_OUTPUT, description: 'Page' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    asset_url: { ...ASSETID_OUTPUT, description: 'Asset url' },
  },
}

export const PLANEV2V2BULKCREATECOMMENTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Commentsresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETECOMMENTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Commentsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATECOMMENTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Commentsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2WORKITEMCOMMENTS8B4ED9_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Comments',
  optional: true,
  properties: {
    id: { ...IDDDC529_OUTPUT, description: 'Unique identifier for the comment.' },
    work_item_id: {
      ...WORKITEMIDA2FC32_OUTPUT,
      description:
        'The work item this comment is attached to. Always matches the `work_item_id` in the request path.',
    },
    comment_html: {
      ...COMMENTHTML2D6EFC_OUTPUT,
      description: 'The comment body, as HTML. This is the field you write.',
    },
    comment_stripped: {
      ...COMMENTSTRIPPED14F41E_OUTPUT,
      description:
        'The plain-text version of `comment_html`, derived server-side. It is what `?search=` matches, so markup never affects a search hit. Read-only — you never send it.',
    },
    access: {
      ...ACCESSC9A263_OUTPUT,
      description:
        'Visibility of the comment. One of `INTERNAL` or `EXTERNAL`. `INTERNAL` keeps the comment inside the project team; `EXTERNAL` marks it as visible outside the team, for example on a published project.',
    },
    actor_id: { ...ASSETID_OUTPUT, description: 'Actor id' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    edited_at: { ...CYCLE883343_OUTPUT, description: 'Edited at' },
    created_at: { ...CREATEDAT899C85_OUTPUT, description: 'When the comment was created.' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    actor: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Actor' },
  },
}

const ID1DC427_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const COMMENTHTML4E04BA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Comment Html',
  optional: true,
  nullable: true,
}

const COMMENTSTRIPPEDE29B44_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Comment Stripped',
  optional: true,
  nullable: true,
}

const ACCESS8CD280_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Access',
  optional: true,
  nullable: true,
}

const CREATEDATE53020_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

export const PLANEV2WORKITEMCOMMENTS0C5466_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Comments',
  optional: true,
  properties: {
    id: { ...ID1DC427_OUTPUT, description: 'Id' },
    work_item_id: {
      ...WORKITEMIDA2FC32_OUTPUT,
      description:
        'The work item this comment is attached to. Always matches the `work_item_id` in the request path.',
    },
    comment_html: { ...COMMENTHTML4E04BA_OUTPUT, description: 'Comment html' },
    comment_stripped: { ...COMMENTSTRIPPEDE29B44_OUTPUT, description: 'Comment stripped' },
    access: { ...ACCESS8CD280_OUTPUT, description: 'Access' },
    actor_id: { ...ASSETID_OUTPUT, description: 'Actor id' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    edited_at: { ...CYCLE883343_OUTPUT, description: 'Edited at' },
    created_at: { ...CREATEDATE53020_OUTPUT, description: 'Created at' },
    created_by_id: { ...ASSETID_OUTPUT, description: 'Created by id' },
    actor: { ...OWNEDBY18E538_OUTPUT, description: 'Actor' },
    is_member: { ...ISMEMBER_OUTPUT, description: 'Is member' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    attachments: { ...ATTACHMENTS_OUTPUT, description: 'Attachments' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    description: { ...CYCLE883343_OUTPUT, description: 'Description' },
    comment_json: { ...COMMENTJSON_OUTPUT, description: 'Comment json' },
  },
}

const DATAB4280D_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Comments',
    properties: {
      id: { type: 'string', description: 'Unique identifier for the comment.', optional: true },
      work_item_id: {
        type: 'string',
        description:
          'The work item this comment is attached to. Always matches the `work_item_id` in the request path.',
        optional: true,
      },
      comment_html: {
        type: 'string',
        description: 'The comment body, as HTML. This is the field you write.',
        optional: true,
      },
      comment_stripped: {
        type: 'string',
        description:
          'The plain-text version of `comment_html`, derived server-side. It is what `?search=` matches, so markup never affects a search hit. Read-only — you never send it.',
        optional: true,
      },
      access: {
        type: 'string',
        description:
          'Visibility of the comment. One of `INTERNAL` or `EXTERNAL`. `INTERNAL` keeps the comment inside the project team; `EXTERNAL` marks it as visible outside the team, for example on a published project.',
        optional: true,
      },
      actor_id: { type: 'string', description: 'Asset Id', optional: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      edited_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'When the comment was created.', optional: true },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true },
      actor: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTCOMMENTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Commentsresult',
  optional: true,
  properties: {
    data: { ...DATAB4280D_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const WORKITEMCOMMENTD35106_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item comment model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    is_member: { ...ISMEMBER_OUTPUT, description: 'Is member' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    comment_stripped: { ...COMMENTSTRIPPED_OUTPUT, description: 'Comment stripped' },
    comment_html: { ...COMMENTHTML_OUTPUT, description: 'Comment html' },
    attachments: { ...ATTACHMENTS_OUTPUT, description: 'Attachments' },
    access: { ...ACCESS11DBB2_OUTPUT, description: 'Access' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    edited_at: { ...EDITEDAT_OUTPUT, description: 'Edited at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    actor: { ...ACTORF9564C_OUTPUT, description: 'Actor' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    description: { ...CYCLE883343_OUTPUT, description: 'Description' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
  },
}

export const PLANEV2WORKITEMLINKS329BC3_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Links',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    metadata: { ...METADATAF0A51F_OUTPUT, description: 'Metadata' },
    title: { ...TITLED12A0D_OUTPUT, description: 'Title' },
    url: { ...URLC17248_OUTPUT, description: 'Target URL.' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
  },
}

export const PLANEV2WORKITEMLINKS5E13ED_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Links',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    metadata: { ...METADATAF0A51F_OUTPUT, description: 'Metadata' },
    title: { ...TITLED12A0D_OUTPUT, description: 'Title' },
    url: { ...URLC17248_OUTPUT, description: 'Target URL.' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    grouped_by: { ...ASSETID_OUTPUT, description: 'Grouped by' },
    sub_grouped_by: { ...ASSETID_OUTPUT, description: 'Sub grouped by' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...ASSETID_OUTPUT, description: 'Next cursor' },
    prev_cursor: { ...ASSETID_OUTPUT, description: 'Prev cursor' },
    next_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Next page results' },
    prev_page_results: { ...HASPAGES8E2BC3_OUTPUT, description: 'Prev page results' },
    count: { ...ACCESS644595_OUTPUT, description: 'Count' },
    total_pages: { ...ACCESS644595_OUTPUT, description: 'Total pages' },
    total_results: { ...ACCESS644595_OUTPUT, description: 'Total results' },
    extra_stats: { ...EXTRASTATS_OUTPUT, description: 'Extra stats (nullable provider value).' },
    results: { ...RESULTS803362_OUTPUT, description: 'Results' },
  },
}

export const PLANEV2V2LISTLINKSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Linksresult',
  optional: true,
  properties: {
    data: { ...DATA8C69BA_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const WORKITEMLINKBD3AA8_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item link model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    title: { ...TITLE_OUTPUT, description: 'Title' },
    url: { ...URL_OUTPUT, description: 'Url' },
    metadata: { ...METADATA_OUTPUT, description: 'Metadata' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
  },
}

export const PLANEV2V2LISTWORKITEMPROPERTIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Work Item Propertiesresult',
  optional: true,
  properties: {
    data: { ...DATA6FD798_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTPROPERTYCONTEXTSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Property Contextsresult',
  optional: true,
  properties: {
    data: { ...DATA62C3E9_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const WORKITEMPROPERTYOPTION62BF89_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item property option model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    is_active: { ...ISACTIVE_OUTPUT, description: 'Is active' },
    is_default: { ...ISDEFAULT_OUTPUT, description: 'Is default' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    property: { ...PROPERTY_OUTPUT, description: 'Property' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
  },
}

const ID98544C_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const DESCRIPTIONA18DB4_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const ISDEFAULT445C3B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Default',
  optional: true,
  nullable: true,
}

const SORTORDER3CFE65_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sort Order',
  optional: true,
  nullable: true,
}

export const PLANEV2WORKITEMPROPERTYOPTIONSF0877F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Property- Options',
  optional: true,
  properties: {
    id: { ...ID98544C_OUTPUT, description: 'Id' },
    name: {
      ...NAME85421B_OUTPUT,
      description: 'The label shown in the picker, for example `Critical`. Maximum 255 characters.',
    },
    description: { ...DESCRIPTIONA18DB4_OUTPUT, description: 'Description' },
    is_default: { ...ISDEFAULT445C3B_OUTPUT, description: 'Is default' },
    sort_order: { ...SORTORDER3CFE65_OUTPUT, description: 'Sort order' },
    external_id: { ...CYCLE883343_OUTPUT, description: 'External id' },
    external_source: { ...CYCLE883343_OUTPUT, description: 'External source' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    is_active: { ...ISACTIVE_OUTPUT, description: 'Is active' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    property: { ...PROPERTY_OUTPUT, description: 'Property' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
  },
}

export const PLANEV2V2LISTPROPERTYOPTIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Property Optionsresult',
  optional: true,
  properties: {
    data: { ...DATA313B27_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2ATTACHTYPEPROPERTYRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Attach Type Propertyresult',
  optional: true,
  properties: { properties: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Properties' } },
}

export const PLANEV2V2LISTTYPEPROPERTIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Type Propertiesresult',
  optional: true,
  properties: {
    data: { ...DATAD55667_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const WORKITEMTYPEA15C03_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item type model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    project_ids: { ...PROJECTIDS_OUTPUT, description: 'Project ids' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    is_epic: { ...ISEPIC_OUTPUT, description: 'Is epic' },
    is_default: { ...ISDEFAULT_OUTPUT, description: 'Is default' },
    is_active: { ...ISACTIVE_OUTPUT, description: 'Is active' },
    level: { ...LEVEL_OUTPUT, description: 'Level' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
  },
}

const ID5E100A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const DESCRIPTION1F7691_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Description',
  optional: true,
  nullable: true,
}

const ISACTIVE4162EC_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Active',
  optional: true,
  nullable: true,
}

const ISDEFAULTE8A1EA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Default',
  optional: true,
  nullable: true,
}

const ISEPIC3EB7B7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Epic',
  optional: true,
  nullable: true,
}

const LEVEL336C1A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Level',
  optional: true,
  nullable: true,
}

const LOGOPROPS3EB47B_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const CREATEDATD2219C_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

export const PLANEV2WORKITEMTYPES056C22_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Types',
  optional: true,
  properties: {
    id: { ...ID5E100A_OUTPUT, description: 'Id' },
    name: {
      ...NAME75D552_OUTPUT,
      description: 'Display name, for example `Bug`. Maximum 255 characters.',
    },
    description: { ...DESCRIPTION1F7691_OUTPUT, description: 'Description' },
    is_active: { ...ISACTIVE4162EC_OUTPUT, description: 'Is active' },
    is_default: { ...ISDEFAULTE8A1EA_OUTPUT, description: 'Is default' },
    is_epic: { ...ISEPIC3EB7B7_OUTPUT, description: 'Is epic' },
    level: { ...LEVEL336C1A_OUTPUT, description: 'Level' },
    logo_props: { ...LOGOPROPS3EB47B_OUTPUT, description: 'Logo props' },
    created_at: { ...CREATEDATD2219C_OUTPUT, description: 'Created at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    project_ids: { ...PROJECTIDS_OUTPUT, description: 'Project ids' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
  },
}

export const PLANEV2V2GETWORKITEMTYPESCHEMARESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Work Item Type Schemaresult',
  optional: true,
  properties: {
    type_id: { ...ASSETID_OUTPUT, description: 'Type id' },
    type_name: { ...ASSETID_OUTPUT, description: 'Type name' },
    type_description: { ...ASSETID_OUTPUT, description: 'Type description' },
    type_logo_props: { ...PLANEV2TYPELOGOPROPS_OUTPUT, description: 'Type logo props' },
    fields: { ...PLANEV2FIELDS_OUTPUT, description: 'Fields' },
    custom_fields: { ...LOGOPROPSB439A5_OUTPUT, description: 'Custom fields' },
  },
}

export const PLANEV2V2LISTWORKITEMTYPESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Work Item Typesresult',
  optional: true,
  properties: {
    data: { ...DATA1BA868_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2WORKITEMWORKLOGS111186_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Worklogs',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    duration: { ...DURATIONCEC84D_OUTPUT, description: 'Time logged, in minutes.' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    logged_by_id: { ...LOGGEDBYID_OUTPUT, description: 'The related logged by.' },
    updated_at: { ...UPDATEDAT579FB8_OUTPUT, description: 'When the record last changed.' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    logged_by: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Logged by' },
  },
}

export const WORKITEMWORKLOG7CF3B8_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item work log model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    duration: { ...DURATION_OUTPUT, description: 'Duration' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project_id: { ...PROJECTID_OUTPUT, description: 'Project id' },
    workspace_id: { ...WORKSPACEID41DAD2_OUTPUT, description: 'Workspace id' },
    logged_by: { ...LOGGEDBY_OUTPUT, description: 'Logged by' },
  },
}

const DURATIONCF388A_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Duration',
  optional: true,
  nullable: true,
}

const UPDATEDATF8B0D7_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Updated At',
  optional: true,
  nullable: true,
}

export const PLANEV2WORKITEMWORKLOGSD59C1C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Item- Worklogs',
  optional: true,
  properties: {
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION16907B_OUTPUT, description: 'Description' },
    duration: { ...DURATIONCF388A_OUTPUT, description: 'Duration' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    logged_by_id: { ...LOGGEDBYID_OUTPUT, description: 'The related logged by.' },
    updated_at: { ...UPDATEDATF8B0D7_OUTPUT, description: 'Updated at' },
    work_item_id: { ...WORKITEMID_OUTPUT, description: 'The related work item.' },
    logged_by: { ...OWNEDBY18E538_OUTPUT, description: 'Logged by' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project_id: { ...PROJECTID_OUTPUT, description: 'Project id' },
    workspace_id: { ...WORKSPACEID41DAD2_OUTPUT, description: 'Workspace id' },
  },
}

export const PLANEV2V2GETPROJECTWORKLOGSUMMARYRESULTITEM9FE59D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Get Project Worklog Summaryresultitem',
  optional: true,
  properties: {
    duration: { ...ACCESS644595_OUTPUT, description: 'Duration' },
    work_item_id: { ...ASSETID_OUTPUT, description: 'Work item id' },
    issue_id: { ...ISSUEID_OUTPUT, description: 'ID of the work item' },
  },
}

const DATA82834C_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Item- Worklogs',
    properties: {
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      duration: { type: 'number', description: 'Time logged, in minutes.', optional: true },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      logged_by_id: { type: 'string', description: 'The related logged by.', optional: true },
      updated_at: { type: 'string', description: 'When the record last changed.', optional: true },
      work_item_id: { type: 'string', description: 'The related work item.', optional: true },
      logged_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTWORKLOGSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Worklogsresult',
  optional: true,
  properties: {
    data: { ...DATA82834C_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2WORKITEMS0209D1_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Items',
  optional: true,
  properties: {
    id: {
      ...IDB23E78_OUTPUT,
      description:
        'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
    },
    name: { ...NAME6F7B53_OUTPUT, description: 'Title of the work item. Maximum 255 characters.' },
    identifier: {
      ...IDENTIFIER4F4557_OUTPUT,
      description:
        "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
    },
    sequence_id: {
      ...SEQUENCEIDFB3D8D_OUTPUT,
      description: "The work item's number within its project. Assigned by Plane and never reused.",
    },
    priority: {
      ...PRIORITYDCA6CE_OUTPUT,
      description:
        'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
    },
    state_id: {
      ...STATEID55C66B_OUTPUT,
      description: 'The workflow state the work item is currently in.',
    },
    type_id: { ...CYCLE883343_OUTPUT, description: 'Type id' },
    assignee_ids: {
      ...ASSIGNEEIDS_OUTPUT,
      description: 'User ids assigned to the work item. Empty array when unassigned.',
    },
    label_ids: {
      ...LABELIDS958CBC_OUTPUT,
      description: 'Label ids applied to the work item. Empty array when unlabeled.',
    },
    parent_id: {
      ...PARENTIDE65D55_OUTPUT,
      description:
        'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    is_draft: {
      ...ISDRAFT88B48C_OUTPUT,
      description:
        'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
    },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    created_at: { ...CREATEDAT083E6E_OUTPUT, description: 'When the work item was created.' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    custom_fields: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Custom fields' },
    assignees: { ...ASSIGNEESE6F198_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELSAFCC9F_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...PARENTC31FEB_OUTPUT, description: 'Parent' },
    state: { ...STATEF1F313_OUTPUT, description: 'State' },
    type: { ...TYPEF949C2_OUTPUT, description: 'Type' },
  },
}

export const PLANEV2V2BULKCREATEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Create Work Itemsresult',
  optional: true,
  properties: {
    results: { ...RESULTSD78556_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKDELETEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Delete Work Itemsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

export const PLANEV2V2BULKUPDATEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Bulk Update Work Itemsresult',
  optional: true,
  properties: {
    results: { ...RESULTS0A57A3_OUTPUT, description: 'Results' },
    succeeded: { ...ACCESS644595_OUTPUT, description: 'Succeeded' },
    failed: { ...ACCESS644595_OUTPUT, description: 'Failed' },
  },
}

const ID3B71DC_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Id',
  optional: true,
  nullable: true,
}

const NAME1B9841_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Name',
  optional: true,
  nullable: true,
}

const SEQUENCEID215CCC_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Sequence Id',
  optional: true,
  nullable: true,
}

const PRIORITYEE2BCD_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Priority',
  optional: true,
  nullable: true,
}

const ISDRAFT402C37_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Is Draft',
  optional: true,
  nullable: true,
}

const CREATEDAT5B0AE6_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Created At',
  optional: true,
  nullable: true,
}

const ASSIGNEESB6479C_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Assignees',
  optional: true,
  items: {
    type: 'json',
    description: 'Assignees Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      display_name: { type: 'string', description: 'Asset Id', optional: true },
      avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      email: { type: 'string', description: 'Asset Id', optional: true },
      first_name: { type: 'string', description: 'Asset Id', optional: true },
      last_name: { type: 'string', description: 'Asset Id', optional: true },
      avatar: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const PARENT848F9C_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Parent',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    sequence_id: { type: 'number', description: 'Access', optional: true },
  },
  nullable: true,
}

const STATE7F27F1_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'State',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    group: { type: 'json', description: 'Group', optional: true, nullable: true },
  },
  nullable: true,
}

const TYPE65A531_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Type',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    logo_props: { type: 'json', description: 'Logo Props', optional: true },
    is_epic: { type: 'boolean', description: 'Has Pages', optional: true },
  },
  nullable: true,
}

export const PLANEV2WORKITEMS90FFDA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Items',
  optional: true,
  properties: {
    id: { ...ID3B71DC_OUTPUT, description: 'Id' },
    name: { ...NAME1B9841_OUTPUT, description: 'Name' },
    identifier: {
      ...IDENTIFIER4F4557_OUTPUT,
      description:
        "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
    },
    sequence_id: { ...SEQUENCEID215CCC_OUTPUT, description: 'Sequence id' },
    priority: { ...PRIORITYEE2BCD_OUTPUT, description: 'Priority' },
    state_id: {
      ...STATEID55C66B_OUTPUT,
      description: 'The workflow state the work item is currently in.',
    },
    type_id: { ...CYCLE883343_OUTPUT, description: 'Type id' },
    assignee_ids: {
      ...ASSIGNEEIDS_OUTPUT,
      description: 'User ids assigned to the work item. Empty array when unassigned.',
    },
    label_ids: {
      ...LABELIDS958CBC_OUTPUT,
      description: 'Label ids applied to the work item. Empty array when unlabeled.',
    },
    parent_id: {
      ...PARENTIDE65D55_OUTPUT,
      description:
        'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    is_draft: { ...ISDRAFT402C37_OUTPUT, description: 'Is draft' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    created_at: { ...CREATEDAT5B0AE6_OUTPUT, description: 'Created at' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    custom_fields: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Custom fields' },
    assignees: { ...ASSIGNEESB6479C_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELS3303C8_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...PARENT848F9C_OUTPUT, description: 'Parent' },
    state: { ...STATE7F27F1_OUTPUT, description: 'State' },
    type: { ...TYPE65A531_OUTPUT, description: 'Type' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    cycle_id: { ...CYCLEID_OUTPUT, description: 'Cycle id' },
    module_ids: { ...LABELIDS_OUTPUT, description: 'Module ids' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    point: { ...POINT_OUTPUT, description: 'Point' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    completed_at: { ...COMPLETEDAT_OUTPUT, description: 'Completed at' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT30AA14_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    estimate_point: { ...ESTIMATEPOINT1C3278_OUTPUT, description: 'Estimate point' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
    created_via: { ...ID045D22_OUTPUT, description: 'Created via' },
    updated_via: { ...ID045D22_OUTPUT, description: 'Updated via' },
    last_activity_at: { ...ASSETID_OUTPUT, description: 'Last activity at' },
    min_assignee_first_name: { ...CYCLEID_OUTPUT, description: 'Min assignee first name' },
    min_label_name: { ...CYCLEID_OUTPUT, description: 'Min label name' },
    min_module_name: { ...CYCLEID_OUTPUT, description: 'Min module name' },
    priority_rank: { ...PRIORITYRANK_OUTPUT, description: 'Priority rank' },
    state_group: { ...CYCLE883343_OUTPUT, description: 'State group' },
  },
}

export const PLANEV2WORKITEMS49553E_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Items',
  optional: true,
  properties: {
    id: {
      ...IDB23E78_OUTPUT,
      description:
        'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
    },
    name: { ...NAME6F7B53_OUTPUT, description: 'Title of the work item. Maximum 255 characters.' },
    identifier: {
      ...IDENTIFIER4F4557_OUTPUT,
      description:
        "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
    },
    sequence_id: {
      ...SEQUENCEIDFB3D8D_OUTPUT,
      description: "The work item's number within its project. Assigned by Plane and never reused.",
    },
    priority: {
      ...PRIORITYDCA6CE_OUTPUT,
      description:
        'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
    },
    state_id: {
      ...STATEID55C66B_OUTPUT,
      description: 'The workflow state the work item is currently in.',
    },
    type_id: { ...CYCLE883343_OUTPUT, description: 'Type id' },
    assignee_ids: {
      ...ASSIGNEEIDS_OUTPUT,
      description: 'User ids assigned to the work item. Empty array when unassigned.',
    },
    label_ids: {
      ...LABELIDS958CBC_OUTPUT,
      description: 'Label ids applied to the work item. Empty array when unlabeled.',
    },
    parent_id: {
      ...PARENTIDE65D55_OUTPUT,
      description:
        'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    is_draft: {
      ...ISDRAFT88B48C_OUTPUT,
      description:
        'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
    },
    archived_at: {
      ...ARCHIVEDAT90ED0E_OUTPUT,
      description:
        'When the work item was archived, or `null` if it is active. See [Archiving](#archiving-and-deleting).',
    },
    created_at: { ...CREATEDAT083E6E_OUTPUT, description: 'When the work item was created.' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    custom_fields: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Custom fields' },
    assignees: { ...ASSIGNEESE6F198_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELSAFCC9F_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...PARENTC31FEB_OUTPUT, description: 'Parent' },
    state: { ...STATEF1F313_OUTPUT, description: 'State' },
    type: { ...TYPEF949C2_OUTPUT, description: 'Type' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    cycle_id: { ...ID045D22_OUTPUT, description: 'Cycle id' },
    module_ids: { ...LABELIDS_OUTPUT, description: 'Module ids' },
  },
}

const STATEBB5F68_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'State',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    group: { type: 'json', description: 'Group', optional: true, nullable: true },
  },
  nullable: true,
}

const ASSIGNEESE78AF7_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Assignees',
  optional: true,
  items: {
    type: 'json',
    description: 'Assignees Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      display_name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      email: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      first_name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      last_name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      avatar: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

const LABELSDB08CD_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Labels',
  optional: true,
  items: {
    type: 'json',
    description: 'Labels Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      deleted_by: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      deleted_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      description: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      sort_order: { type: 'number', description: 'Sort Order', optional: true, nullable: true },
      external_source: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      external_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      updated_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      workspace: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      project: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      parent: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    },
  },
}

export const PLANEV2WORKITEMS3D744C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Items',
  optional: true,
  properties: {
    id: { ...ID3B71DC_OUTPUT, description: 'Id' },
    name: { ...NAME1B9841_OUTPUT, description: 'Name' },
    identifier: {
      ...IDENTIFIER4F4557_OUTPUT,
      description:
        "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
    },
    sequence_id: { ...SEQUENCEID215CCC_OUTPUT, description: 'Sequence id' },
    priority: { ...PRIORITYEE2BCD_OUTPUT, description: 'Priority' },
    state_id: {
      ...STATEID55C66B_OUTPUT,
      description: 'The workflow state the work item is currently in.',
    },
    type_id: { ...CYCLE883343_OUTPUT, description: 'Type id' },
    assignee_ids: {
      ...ASSIGNEEIDS_OUTPUT,
      description: 'User ids assigned to the work item. Empty array when unassigned.',
    },
    label_ids: {
      ...LABELIDS958CBC_OUTPUT,
      description: 'Label ids applied to the work item. Empty array when unlabeled.',
    },
    parent_id: {
      ...PARENTIDE65D55_OUTPUT,
      description:
        'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    is_draft: { ...ISDRAFT402C37_OUTPUT, description: 'Is draft' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    created_at: { ...CREATEDAT5B0AE6_OUTPUT, description: 'Created at' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    custom_fields: { ...VIEWPROPS8D74F6_OUTPUT, description: 'Custom fields' },
    state: { ...STATEBB5F68_OUTPUT, description: 'State' },
    assignees: { ...ASSIGNEESE78AF7_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELSDB08CD_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...PARENT848F9C_OUTPUT, description: 'Parent' },
    type: { ...TYPE65A531_OUTPUT, description: 'Type' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    cycle_id: { ...CYCLEID_OUTPUT, description: 'Cycle id' },
    module_ids: { ...LABELIDS_OUTPUT, description: 'Module ids' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    point: { ...POINT_OUTPUT, description: 'Point' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    completed_at: { ...COMPLETEDAT_OUTPUT, description: 'Completed at' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT30AA14_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    estimate_point: { ...ESTIMATEPOINT1C3278_OUTPUT, description: 'Estimate point' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
    created_via: { ...ID045D22_OUTPUT, description: 'Created via' },
    updated_via: { ...ID045D22_OUTPUT, description: 'Updated via' },
    last_activity_at: { ...ASSETID_OUTPUT, description: 'Last activity at' },
    min_assignee_first_name: { ...CYCLEID_OUTPUT, description: 'Min assignee first name' },
    min_label_name: { ...CYCLEID_OUTPUT, description: 'Min label name' },
    min_module_name: { ...CYCLEID_OUTPUT, description: 'Min module name' },
    priority_rank: { ...PRIORITYRANK_OUTPUT, description: 'Priority rank' },
    state_group: { ...CYCLE883343_OUTPUT, description: 'State group' },
  },
}

const DATA4C0D90_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Items',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Title of the work item. Maximum 255 characters.',
        optional: true,
      },
      identifier: {
        type: 'string',
        description:
          "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
        optional: true,
      },
      sequence_id: {
        type: 'number',
        description:
          "The work item's number within its project. Assigned by Plane and never reused.",
        optional: true,
      },
      priority: {
        type: 'string',
        description:
          'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
        optional: true,
      },
      state_id: {
        type: 'string',
        description: 'The workflow state the work item is currently in.',
        optional: true,
      },
      type_id: {
        type: 'string',
        description:
          'The work item type. `null` when the project has no types enabled or the item is untyped.',
        optional: true,
        nullable: true,
      },
      assignee_ids: {
        type: 'array',
        description: 'User ids assigned to the work item. Empty array when unassigned.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      label_ids: {
        type: 'array',
        description: 'Label ids applied to the work item. Empty array when unlabeled.',
        optional: true,
        items: { type: 'string', description: 'Asset Id' },
      },
      parent_id: {
        type: 'string',
        description:
          'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
        optional: true,
        nullable: true,
      },
      start_date: {
        type: 'string',
        description: 'Planned start, or `null`.',
        optional: true,
        nullable: true,
      },
      target_date: {
        type: 'string',
        description: 'Planned due date, or `null`.',
        optional: true,
        nullable: true,
      },
      is_draft: {
        type: 'boolean',
        description:
          'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
        optional: true,
      },
      archived_at: {
        type: 'string',
        description:
          'When the work item was archived, or `null` if it is active. See [Archiving](#archiving-and-deleting).',
        optional: true,
        nullable: true,
      },
      created_at: {
        type: 'string',
        description: 'When the work item was created.',
        optional: true,
      },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      custom_fields: { type: 'json', description: 'View Props', optional: true, nullable: true },
      assignees: {
        type: 'array',
        description: 'Assignees',
        optional: true,
        items: {
          type: 'object',
          description: 'Assignees Item',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            display_name: { type: 'string', description: 'Asset Id', optional: true },
            avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
            email: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
      cycle: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      labels: {
        type: 'array',
        description: 'Labels',
        optional: true,
        items: {
          type: 'object',
          description: 'Labels Item',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            color: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
      modules: {
        type: 'array',
        description: 'Points',
        optional: true,
        items: { type: 'json', description: 'Logo Props' },
      },
      parent: {
        type: 'object',
        description: 'Parent',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          name: { type: 'string', description: 'Asset Id', optional: true },
          sequence_id: { type: 'number', description: 'Access', optional: true },
        },
        nullable: true,
      },
      state: {
        type: 'object',
        description: 'State',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          name: { type: 'string', description: 'Asset Id', optional: true },
          color: { type: 'string', description: 'Asset Id', optional: true },
          group: { type: 'string', description: 'Asset Id', optional: true },
        },
        nullable: true,
      },
      type: {
        type: 'object',
        description: 'Type',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          name: { type: 'string', description: 'Asset Id', optional: true },
          logo_props: { type: 'json', description: 'Logo Props', optional: true },
          is_epic: { type: 'boolean', description: 'Has Pages', optional: true },
        },
        nullable: true,
      },
      project_id: { type: 'string', description: 'Asset Id', optional: true },
      cycle_id: { type: 'json', description: 'Id', optional: true, nullable: true },
      module_ids: {
        type: 'array',
        description: 'Label Ids',
        optional: true,
        items: { type: 'json', description: 'Logo Props' },
      },
    },
  },
}

const PREVIOUSE7D2AF_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Previous',
  optional: true,
  nullable: true,
}

export const PLANEV2V2LISTWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Work Itemsresult',
  optional: true,
  properties: {
    data: { ...DATA4C0D90_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUSE7D2AF_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const STATE5FF5FD_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'State',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    color: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    group: { type: 'string', description: 'Group', optional: true, nullable: true },
  },
  nullable: true,
}

const ASSIGNEESC7C467_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Assignees',
  optional: true,
  items: {
    type: 'json',
    description: 'Assignees Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      first_name: { type: 'string', description: 'Asset Id', optional: true },
      last_name: { type: 'string', description: 'Asset Id', optional: true },
      email: { type: 'string', description: 'Asset Id', optional: true },
      avatar: { type: 'string', description: 'Asset Id', optional: true },
      avatar_url: { type: 'json', description: 'Id', optional: true, nullable: true },
      display_name: { type: 'string', description: 'Asset Id', optional: true },
    },
  },
}

const LABELS6FF712_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Labels',
  optional: true,
  items: {
    type: 'json',
    description: 'Labels Item',
    properties: {
      id: { type: 'string', description: 'Asset Id', optional: true },
      deleted_by: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_at: { type: 'string', description: 'Asset Id', optional: true },
      updated_at: { type: 'string', description: 'Asset Id', optional: true },
      deleted_at: { type: 'json', description: 'Id', optional: true, nullable: true },
      name: { type: 'string', description: 'Asset Id', optional: true },
      description: { type: 'string', description: 'Asset Id', optional: true },
      color: { type: 'string', description: 'Asset Id', optional: true },
      sort_order: { type: 'number', description: 'Sort Order', optional: true },
      external_source: { type: 'json', description: 'Id', optional: true, nullable: true },
      external_id: { type: 'json', description: 'Id', optional: true, nullable: true },
      created_by: { type: 'string', description: 'Asset Id', optional: true },
      updated_by: { type: 'json', description: 'Id', optional: true, nullable: true },
      workspace: { type: 'string', description: 'Asset Id', optional: true },
      project: { type: 'string', description: 'Asset Id', optional: true },
      parent: { type: 'json', description: 'Id', optional: true, nullable: true },
    },
  },
}

export const WORKITEMDC8A1D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    type_id: { ...TYPEID_OUTPUT, description: 'Type id' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    point: { ...POINT_OUTPUT, description: 'Point' },
    name: { ...NAME_OUTPUT, description: 'Name' },
    description_html: { ...DESCRIPTIONHTML_OUTPUT, description: 'Description html' },
    description_stripped: { ...DESCRIPTIONSTRIPPED_OUTPUT, description: 'Description stripped' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    priority: { ...PRIORITY7C079D_OUTPUT, description: 'Priority' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    target_date: { ...TARGETDATE_OUTPUT, description: 'Target date' },
    sequence_id: { ...SEQUENCEID6A702B_OUTPUT, description: 'Sequence id' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    completed_at: { ...COMPLETEDAT_OUTPUT, description: 'Completed at' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    is_draft: { ...ISDRAFT_OUTPUT, description: 'Is draft' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT30AA14_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    parent: { ...PARENT6F1635_OUTPUT, description: 'Parent' },
    state: { ...STATE5FF5FD_OUTPUT, description: 'State' },
    estimate_point: { ...ESTIMATEPOINT1C3278_OUTPUT, description: 'Estimate point' },
    type: { ...TYPE_OUTPUT, description: 'Type' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    assignees: { ...ASSIGNEESC7C467_OUTPUT, description: 'Assignees' },
    labels: { ...LABELS6FF712_OUTPUT, description: 'Labels' },
    deleted_by: { ...ID045D22_OUTPUT, description: 'Deleted by' },
    cycle_id: { ...CYCLEID_OUTPUT, description: 'Cycle id' },
    created_via: { ...ID045D22_OUTPUT, description: 'Created via' },
    updated_via: { ...ID045D22_OUTPUT, description: 'Updated via' },
    last_activity_at: { ...ASSETID_OUTPUT, description: 'Last activity at' },
    min_assignee_first_name: { ...CYCLEID_OUTPUT, description: 'Min assignee first name' },
    min_label_name: { ...CYCLEID_OUTPUT, description: 'Min label name' },
    min_module_name: { ...CYCLEID_OUTPUT, description: 'Min module name' },
    priority_rank: { ...PRIORITYRANK_OUTPUT, description: 'Priority rank' },
    state_group: { ...CYCLE883343_OUTPUT, description: 'State group' },
  },
}

const DATA1D8FF3_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Work- Items',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
        optional: true,
      },
      name: {
        type: 'string',
        description: 'Title of the work item. Maximum 255 characters.',
        optional: true,
      },
      identifier: {
        type: 'string',
        description:
          "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
        optional: true,
      },
      sequence_id: { type: 'json', description: 'Sequence Id', optional: true },
      priority: {
        type: 'string',
        description:
          'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
        optional: true,
      },
      state_id: {
        type: 'string',
        description: 'The workflow state the work item is currently in.',
        optional: true,
      },
      type_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      assignee_ids: {
        type: 'array',
        description: 'User ids assigned to the work item. Empty array when unassigned.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      label_ids: {
        type: 'array',
        description: 'Label ids applied to the work item. Empty array when unlabeled.',
        optional: true,
        items: { type: 'json', description: 'Page Ids Item' },
      },
      parent_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      start_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      target_date: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      is_draft: {
        type: 'boolean',
        description:
          'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
        optional: true,
      },
      archived_at: {
        type: 'string',
        description:
          'When the work item was archived, or `null` if it is active. See [Archiving](#archiving-and-deleting).',
        optional: true,
        nullable: true,
      },
      created_at: {
        type: 'string',
        description: 'When the work item was created.',
        optional: true,
      },
      created_by_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      custom_fields: { type: 'json', description: 'View Props', optional: true, nullable: true },
      cycle_id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
      module_ids: {
        type: 'array',
        description: 'Project Ids',
        optional: true,
        items: { type: 'array', description: 'Default Value' },
      },
      project_id: { type: 'string', description: 'Asset Id', optional: true },
      assignees: {
        type: 'array',
        description: 'Assignees',
        optional: true,
        items: {
          type: 'object',
          description: 'Assignees Item',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            display_name: { type: 'string', description: 'Asset Id', optional: true },
            avatar_url: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
            email: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
      cycle: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      labels: {
        type: 'array',
        description: 'Labels',
        optional: true,
        items: {
          type: 'object',
          description: 'Labels Item',
          properties: {
            id: { type: 'string', description: 'Asset Id', optional: true },
            name: { type: 'string', description: 'Asset Id', optional: true },
            color: { type: 'string', description: 'Asset Id', optional: true },
          },
        },
      },
      modules: {
        type: 'array',
        description: 'Points',
        optional: true,
        items: { type: 'json', description: 'Logo Props' },
      },
      parent: {
        type: 'object',
        description: 'Parent',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          name: { type: 'string', description: 'Asset Id', optional: true },
          sequence_id: { type: 'number', description: 'Access', optional: true },
        },
        nullable: true,
      },
      state: {
        type: 'object',
        description: 'State',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          name: { type: 'string', description: 'Asset Id', optional: true },
          color: { type: 'string', description: 'Asset Id', optional: true },
          group: { type: 'string', description: 'Asset Id', optional: true },
        },
        nullable: true,
      },
      type: {
        type: 'object',
        description: 'Type',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Asset Id', optional: true },
          name: { type: 'string', description: 'Asset Id', optional: true },
          logo_props: { type: 'json', description: 'Logo Props', optional: true },
          is_epic: { type: 'boolean', description: 'Has Pages', optional: true },
        },
        nullable: true,
      },
    },
  },
}

export const PLANEV2V2LISTWORKSPACEWORKITEMSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Work Itemsresult',
  optional: true,
  properties: {
    data: { ...DATA1D8FF3_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2WORKITEMS029D81_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Items',
  optional: true,
  properties: {
    id: {
      ...IDB23E78_OUTPUT,
      description:
        'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
    },
    name: { ...NAME6F7B53_OUTPUT, description: 'Title of the work item. Maximum 255 characters.' },
    identifier: {
      ...IDENTIFIER4F4557_OUTPUT,
      description:
        "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
    },
    sequence_id: {
      ...SEQUENCEIDFB3D8D_OUTPUT,
      description: "The work item's number within its project. Assigned by Plane and never reused.",
    },
    priority: {
      ...PRIORITYDCA6CE_OUTPUT,
      description:
        'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
    },
    state_id: {
      ...STATEID55C66B_OUTPUT,
      description: 'The workflow state the work item is currently in.',
    },
    type_id: { ...CYCLE883343_OUTPUT, description: 'Type id' },
    assignee_ids: {
      ...ASSIGNEEIDS_OUTPUT,
      description: 'User ids assigned to the work item. Empty array when unassigned.',
    },
    label_ids: {
      ...LABELIDS958CBC_OUTPUT,
      description: 'Label ids applied to the work item. Empty array when unlabeled.',
    },
    parent_id: {
      ...PARENTIDE65D55_OUTPUT,
      description:
        'The parent work item, or `null` for a top-level item. A parent may live in another project of the same workspace.',
    },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    is_draft: {
      ...ISDRAFT88B48C_OUTPUT,
      description:
        'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
    },
    archived_at: {
      ...ARCHIVEDAT90ED0E_OUTPUT,
      description:
        'When the work item was archived, or `null` if it is active. See [Archiving](#archiving-and-deleting).',
    },
    created_at: { ...CREATEDAT083E6E_OUTPUT, description: 'When the work item was created.' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    custom_fields: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Custom fields' },
    assignees: { ...ASSIGNEESE6F198_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELSAFCC9F_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...PARENTC31FEB_OUTPUT, description: 'Parent' },
    state: { ...STATEF1F313_OUTPUT, description: 'State' },
    type: { ...TYPEF949C2_OUTPUT, description: 'Type' },
  },
}

export const PLANEV2WORKITEMSA7B6DE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Work- Items',
  optional: true,
  properties: {
    id: {
      ...IDB23E78_OUTPUT,
      description:
        'Unique identifier for the work item. This is the `{pk}` on every project-scoped detail route.',
    },
    name: { ...NAME6F7B53_OUTPUT, description: 'Title of the work item. Maximum 255 characters.' },
    identifier: {
      ...IDENTIFIER4F4557_OUTPUT,
      description:
        "The human key, for example `PROJ-142`. It is the project's identifier joined to `sequence_id`, and it is what people paste into chat and commit messages. Use it with [Get a work item by identifier](/api-reference/v2/work-items/get-work-item-by-identifier) when you don't have the project UUID.",
    },
    sequence_id: { ...SEQUENCEID3A1EAC_OUTPUT, description: 'Sequence id' },
    priority: {
      ...PRIORITYDCA6CE_OUTPUT,
      description:
        'One of `urgent`, `high`, `medium`, `low`, or `none`. Never null — an unprioritized work item reads `none`.',
    },
    state_id: {
      ...STATEID55C66B_OUTPUT,
      description: 'The workflow state the work item is currently in.',
    },
    type_id: { ...CYCLE883343_OUTPUT, description: 'Type id' },
    assignee_ids: {
      ...ASSIGNEEIDS2DE275_OUTPUT,
      description: 'User ids assigned to the work item. Empty array when unassigned.',
    },
    label_ids: {
      ...LABELIDS16374A_OUTPUT,
      description: 'Label ids applied to the work item. Empty array when unlabeled.',
    },
    parent_id: { ...CYCLE883343_OUTPUT, description: 'Parent id' },
    start_date: { ...CYCLE883343_OUTPUT, description: 'Start date' },
    target_date: { ...CYCLE883343_OUTPUT, description: 'Target date' },
    is_draft: {
      ...ISDRAFT88B48C_OUTPUT,
      description:
        'Whether the work item is still a draft. Drafts are created in the Plane app and are excluded from most boards.',
    },
    archived_at: {
      ...ARCHIVEDAT90ED0E_OUTPUT,
      description:
        'When the work item was archived, or `null` if it is active. See [Archiving](#archiving-and-deleting).',
    },
    created_at: { ...CREATEDAT083E6E_OUTPUT, description: 'When the work item was created.' },
    created_by_id: { ...CYCLE883343_OUTPUT, description: 'Created by id' },
    custom_fields: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Custom fields' },
    cycle_id: { ...ASSETID_OUTPUT, description: 'Cycle id' },
    module_ids: { ...PROJECTIDS76D572_OUTPUT, description: 'Module ids' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    assignees: { ...ASSIGNEESE6F198_OUTPUT, description: 'Assignees' },
    cycle: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Cycle' },
    labels: { ...LABELSAFCC9F_OUTPUT, description: 'Labels' },
    modules: { ...POINTS_OUTPUT, description: 'Modules' },
    parent: { ...PARENTC31FEB_OUTPUT, description: 'Parent' },
    state: { ...STATEF1F313_OUTPUT, description: 'State' },
    type: { ...TYPEF949C2_OUTPUT, description: 'Type' },
  },
}

export const PLANEV2V2LISTWORKFLOWSTATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workflow Statesresult',
  optional: true,
  properties: {
    data: { ...DATAA8C811_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKFLOWTRANSITIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workflow Transitionsresult',
  optional: true,
  properties: {
    data: { ...DATA76A8FD_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKFLOWSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workflowsresult',
  optional: true,
  properties: {
    data: { ...DATA88DC10_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2WORKSPACEASSETS33620D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Assets',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES2FF54B_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    entity_type: { ...ENTITYTYPE7582D6_OUTPUT, description: 'The entity type.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
    asset_id: { ...ASSETID_OUTPUT, description: 'Asset id' },
    upload_data: { ...UPLOADDATA27F4DF_OUTPUT, description: 'Upload data' },
  },
}

const ATTRIBUTES6781CA_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Attributes',
  optional: true,
  properties: { entity_type: { type: 'string', description: 'Asset Id', optional: true } },
  nullable: true,
}

export const PLANEV2WORKSPACEASSETS0C0A0A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Assets',
  optional: true,
  properties: {
    asset_url: { ...ASSETURL_OUTPUT, description: 'The asset url.' },
    attributes: { ...ATTRIBUTES6781CA_OUTPUT, description: 'Attributes' },
    content_type: { ...CONTENTTYPE_OUTPUT, description: 'The content type.' },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    entity_type: { ...ENTITYTYPE7582D6_OUTPUT, description: 'The entity type.' },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_uploaded: { ...ISUPLOADEDB45807_OUTPUT, description: 'Whether is uploaded.' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    size: { ...SIZE422D69_OUTPUT, description: 'Size' },
    type: { ...ASSETID_OUTPUT, description: 'Type' },
  },
}

export const PLANEV2V2LISTWORKSPACEASSETSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Assetsresult',
  optional: true,
  properties: {
    data: { ...DATAB73DB2_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEAUTOMATIONACTIVITIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Automation Activitiesresult',
  optional: true,
  properties: {
    data: { ...DATA92A59E_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEAUTOMATIONEDGESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Automation Edgesresult',
  optional: true,
  properties: {
    data: { ...DATAEDFCAE_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEAUTOMATIONNODESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Automation Nodesresult',
  optional: true,
  properties: {
    data: { ...DATA23F884_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEAUTOMATIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Automationsresult',
  optional: true,
  properties: {
    data: { ...DATA307069_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2WORKSPACEREGENERATENODEWEBHOOKSECRETRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Workspace Regenerate Node Webhook Secretresult',
  optional: true,
  properties: { secret: { ...ASSETID_OUTPUT, description: 'Secret' } },
}

export const PLANEV2WORKSPACEFEATURES56CADD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Features',
  optional: true,
  properties: {
    id: {
      ...IDDE4ACB_OUTPUT,
      description: "Unique identifier for the workspace's feature record.",
    },
    is_work_item_types_enabled: {
      ...ISWORKITEMTYPESENABLED_OUTPUT,
      description:
        'Whether work item types are managed at the **workspace** level. `true` means workspace mode — types and properties are defined once for the workspace and imported into projects. `false` means project mode — each project owns its own types. This is the field to read before any type or property write. See [Work item type modes](/api-reference/v2/work-item-type-modes).',
    },
    work_item_type_default_level: {
      ...WORKITEMTYPEDEFAULTLEVEL_OUTPUT,
      description:
        'The default level applied to work item types in this workspace. The schema constrains it to an integer and declares no enum, so treat any value as legal and leave it as returned unless you are deliberately changing type levels.',
    },
    is_workitem_hierarchy_enabled: {
      ...ISWORKITEMHIERARCHYENABLED_OUTPUT,
      description:
        'Whether work items can be nested into a parent and child hierarchy in this workspace.',
    },
    is_project_grouping_enabled: {
      ...ISPROJECTGROUPINGENABLED_OUTPUT,
      description: 'Whether projects can be organized into groups in the workspace.',
    },
    is_teams_enabled: {
      ...ISTEAMSENABLED_OUTPUT,
      description:
        'Whether teamspaces are available. Teamspaces have their own endpoints under the `teamspaces:*` scopes.',
    },
    is_wiki_enabled: {
      ...ISWIKIENABLED_OUTPUT,
      description:
        'Whether the workspace-level wiki is available, behind the `wiki.pages:*` scopes.',
    },
    is_initiative_enabled: {
      ...ISINITIATIVEENABLED_OUTPUT,
      description:
        'Whether initiatives — the layer that groups projects and epics toward a larger outcome — are available.',
    },
    is_customer_enabled: {
      ...ISCUSTOMERENABLED_OUTPUT,
      description:
        'Whether customers and customer requests are available, behind the `customers:*` scopes.',
    },
    is_release_enabled: {
      ...ISRELEASEENABLED_OUTPUT,
      description: 'Whether releases are available, behind the `releases:*` scopes.',
    },
    is_state_duration_enabled: {
      ...ISSTATEDURATIONENABLED_OUTPUT,
      description: 'Whether Plane records how long work items spend in each state.',
    },
    is_pi_enabled: {
      ...ISPIENABLED_OUTPUT,
      description: "Whether Pi, Plane's AI assistant, is available in the workspace.",
    },
    created_at: { ...CREATEDAT15F92D_OUTPUT, description: 'When the feature record was created.' },
    project_grouping: { ...PROJECTGROUPING_OUTPUT, description: 'Project grouping' },
    initiatives: { ...INITIATIVES_OUTPUT, description: 'Initiatives' },
    teams: { ...TEAMS_OUTPUT, description: 'Teams' },
    customers: { ...CUSTOMERS_OUTPUT, description: 'Customers' },
    wiki: { ...WIKI_OUTPUT, description: 'Wiki' },
    pi: { ...PI_OUTPUT, description: 'Pi' },
    work_item_types: { ...WORKITEMTYPES_OUTPUT, description: 'Work item types' },
    releases: { ...RELEASES_OUTPUT, description: 'Releases' },
    states_owned_by_workspace: {
      ...STATESOWNEDBYWORKSPACE_OUTPUT,
      description: 'States owned by workspace',
    },
  },
}

const COLLECTIONID81D695_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Collection Id',
  optional: true,
  nullable: true,
}

const LOGOPROPSADA1BE_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Logo Props',
  optional: true,
  nullable: true,
}

const PARENTIDE8884D_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Parent Id',
  optional: true,
  nullable: true,
}

const VIEWPROPS4552D6_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'View Props',
  optional: true,
  nullable: true,
}

export const PLANEV2WORKSPACEPAGESD6A399_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Pages',
  optional: true,
  properties: {
    access: { ...ACCESS5296B7_OUTPUT, description: 'Access' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    collection_id: { ...COLLECTIONID81D695_OUTPUT, description: 'Collection id' },
    color: {
      ...COLOR3938EE_OUTPUT,
      description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
    },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    description_stripped: {
      ...DESCRIPTIONSTRIPPED03385F_OUTPUT,
      description: 'Description stripped',
    },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_global: {
      ...ISGLOBAL48E7DF_OUTPUT,
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    is_locked: { ...ISLOCKED7FD353_OUTPUT, description: 'Is locked' },
    logo_props: { ...LOGOPROPSADA1BE_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    parent_id: { ...PARENTIDE8884D_OUTPUT, description: 'Parent id' },
    sort_order: { ...SORTORDERDDAA43_OUTPUT, description: 'Sort order' },
    view_props: { ...VIEWPROPS4552D6_OUTPUT, description: 'View props' },
    owned_by: { ...OWNEDBY18E538_OUTPUT, description: 'Owned by' },
    parent: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Parent' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    anchor: { ...ANCHOR_OUTPUT, description: 'Anchor' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    projects: { ...PROJECTS_OUTPUT, description: 'Projects' },
    page_collection_id: { ...PAGECOLLECTIONID_OUTPUT, description: 'Page collection id' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...CYCLE883343_OUTPUT, description: 'Updated by' },
    description_json: { ...DESCRIPTIONJSON0B33AD_OUTPUT, description: 'Description json' },
  },
}

export const PLANEV2WORKSPACEPAGESC8362F_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Pages',
  optional: true,
  properties: {
    access: { ...ACCESS5296B7_OUTPUT, description: 'Access' },
    archived_at: { ...CYCLE883343_OUTPUT, description: 'Archived at' },
    collection_id: { ...COLLECTIONID81D695_OUTPUT, description: 'Collection id' },
    color: {
      ...COLOR3938EE_OUTPUT,
      description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
    },
    created_at: { ...CREATEDAT88654E_OUTPUT, description: 'Created at' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description_html: { ...DESCRIPTIONHTML605EC1_OUTPUT, description: 'Description html' },
    description_stripped: {
      ...DESCRIPTIONSTRIPPED03385F_OUTPUT,
      description: 'Description stripped',
    },
    external_id: { ...EXTERNALIDE53BCD_OUTPUT, description: 'External id' },
    external_source: { ...EXTERNALSOURCEEB04B9_OUTPUT, description: 'External source' },
    id: { ...ID835E8A_OUTPUT, description: 'Id' },
    is_global: {
      ...ISGLOBAL48E7DF_OUTPUT,
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    is_locked: { ...ISLOCKED7FD353_OUTPUT, description: 'Is locked' },
    logo_props: { ...LOGOPROPSADA1BE_OUTPUT, description: 'Logo props' },
    name: { ...NAME8B7867_OUTPUT, description: 'Name' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    parent_id: { ...PARENTIDE8884D_OUTPUT, description: 'Parent id' },
    sort_order: { ...SORTORDERDDAA43_OUTPUT, description: 'Sort order' },
    view_props: { ...VIEWPROPS4552D6_OUTPUT, description: 'View props' },
    owned_by: { ...OWNEDBY18E538_OUTPUT, description: 'Owned by' },
    parent: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Parent' },
    description_binary: { ...DESCRIPTIONBINARY_OUTPUT, description: 'Description binary' },
    description: { ...DESCRIPTIONB39DCD_OUTPUT, description: 'Description' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    anchor: { ...ANCHOR_OUTPUT, description: 'Anchor' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    projects: { ...PROJECTS_OUTPUT, description: 'Projects' },
    page_collection_id: { ...PAGECOLLECTIONID_OUTPUT, description: 'Page collection id' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ID045D22_OUTPUT, description: 'Updated by' },
    description_json: { ...DESCRIPTIONJSON0B33AD_OUTPUT, description: 'Description json' },
  },
}

const DATA9B4D85_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Pages',
    properties: {
      access: { type: 'number', description: 'Who can see this.', optional: true },
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      collection_id: { type: 'string', description: 'The related collection.', optional: true },
      color: {
        type: 'string',
        description: 'Hex color used wherever this is rendered, for example `#3f76ff`.',
        optional: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description_html: {
        type: 'string',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
        optional: true,
      },
      description_stripped: {
        type: 'string',
        description: 'The description stripped.',
        optional: true,
      },
      external_id: { type: 'json', description: 'External Id', optional: true, nullable: true },
      external_source: {
        type: 'json',
        description: 'External Source',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_global: {
        type: 'boolean',
        description: 'Whether this lives at the workspace level rather than inside a project.',
        optional: true,
      },
      is_locked: {
        type: 'boolean',
        description: 'Prevents further edits to the content.',
        optional: true,
      },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      owned_by_id: { type: 'string', description: 'The related owned by.', optional: true },
      parent_id: { type: 'string', description: 'The related parent.', optional: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      view_props: {
        type: 'string',
        description: 'Editor-owned layout descriptor. Pass back what you read.',
        optional: true,
        nullable: true,
      },
      owned_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
      parent: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTWORKSPACEPAGESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Pagesresult',
  optional: true,
  properties: {
    data: { ...DATA9B4D85_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2WORKSPACEVIEWS490E6D_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 Workspace- Views',
  optional: true,
  properties: {
    access: { ...ACCESS97D6DB_OUTPUT, description: 'Who can see this.' },
    archived_at: {
      ...ARCHIVEDAT31CCCE_OUTPUT,
      description: 'When the record was archived, or `null` if it is active.',
    },
    created_at: { ...CREATEDAT50E5D2_OUTPUT, description: 'When the record was created.' },
    created_by_id: { ...CREATEDBYID_OUTPUT, description: 'The user who created the record.' },
    description: { ...DESCRIPTION36D05F_OUTPUT, description: 'Free-form description.' },
    display_filters: { ...DISPLAYFILTERS_OUTPUT, description: 'Display filters' },
    display_properties: { ...DISPLAYPROPERTIES_OUTPUT, description: 'Display properties' },
    filters: { ...FILTERS_OUTPUT, description: 'Filters' },
    id: { ...ID35193D_OUTPUT, description: 'Unique identifier.' },
    is_locked: { ...ISLOCKEDCA86CF_OUTPUT, description: 'Prevents further edits to the content.' },
    logo_props: { ...LOGOPROPS06ABC6_OUTPUT, description: 'Logo props' },
    name: { ...NAMEF3CA52_OUTPUT, description: 'Display name.' },
    owned_by_id: { ...OWNEDBYID53BB5A_OUTPUT, description: 'The related owned by.' },
    pql_filters: { ...PQLFILTERS_OUTPUT, description: 'Pql filters' },
    query: { ...QUERY_OUTPUT, description: 'Query' },
    sort_order: { ...SORTORDERDDAA43_OUTPUT, description: 'Sort order' },
    owned_by: { ...CUSTOMFIELDS9C1322_OUTPUT, description: 'Owned by' },
  },
}

const DATAEDBD49_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Data',
  optional: true,
  items: {
    type: 'object',
    description: 'Plane V2 Workspace- Views',
    properties: {
      access: { type: 'number', description: 'Who can see this.', optional: true },
      archived_at: {
        type: 'string',
        description: 'When the record was archived, or `null` if it is active.',
        optional: true,
        nullable: true,
      },
      created_at: { type: 'string', description: 'When the record was created.', optional: true },
      created_by_id: {
        type: 'string',
        description: 'The user who created the record.',
        optional: true,
      },
      description: { type: 'string', description: 'Free-form description.', optional: true },
      display_filters: {
        type: 'string',
        description: 'Saved display options — grouping, ordering and layout.',
        optional: true,
        nullable: true,
      },
      display_properties: {
        type: 'string',
        description: 'The display properties.',
        optional: true,
        nullable: true,
      },
      filters: {
        type: 'string',
        description: 'Saved filter set, in the same shape the list endpoints accept.',
        optional: true,
        nullable: true,
      },
      id: { type: 'string', description: 'Unique identifier.', optional: true },
      is_locked: {
        type: 'boolean',
        description: 'Prevents further edits to the content.',
        optional: true,
      },
      logo_props: {
        type: 'string',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
        optional: true,
        nullable: true,
      },
      name: { type: 'string', description: 'Display name.', optional: true },
      owned_by_id: { type: 'string', description: 'The related owned by.', optional: true },
      pql_filters: {
        type: 'string',
        description: 'The pql filters.',
        optional: true,
        nullable: true,
      },
      query: { type: 'string', description: 'The query.', optional: true, nullable: true },
      sort_order: { type: 'json', description: 'Sort Order', optional: true },
      owned_by: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    },
  },
}

export const PLANEV2V2LISTWORKSPACEVIEWSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Viewsresult',
  optional: true,
  properties: {
    data: { ...DATAEDBD49_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEWORKITEMPROPERTIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Work Item Propertiesresult',
  optional: true,
  properties: {
    data: { ...DATAC76CC1_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEPROPERTYOPTIONSRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Property Optionsresult',
  optional: true,
  properties: {
    data: { ...DATAEEE2F9_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEWORKITEMTEMPLATESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Work Item Templatesresult',
  optional: true,
  properties: {
    data: { ...DATA99D8D4_OUTPUT, description: 'Data' },
    next: { ...ACCESS644595_OUTPUT, description: 'Next' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    previous: { ...ACCESS644595_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2ATTACHWORKSPACETYPEPROPERTYRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 Attach Workspace Type Propertyresult',
  optional: true,
  properties: { properties: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Properties' } },
}

export const PLANEV2V2LISTWORKSPACETYPEPROPERTIESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Type Propertiesresult',
  optional: true,
  properties: {
    data: { ...DATA6A7B72_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

export const PLANEV2V2LISTWORKSPACEWORKITEMTYPESRESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane V2 V2 List Workspace Work Item Typesresult',
  optional: true,
  properties: {
    data: { ...DATA74C95E_OUTPUT, description: 'Data' },
    next: { ...PREVIOUS_OUTPUT, description: 'Next' },
    previous: { ...PREVIOUS_OUTPUT, description: 'Previous' },
    total_count: { ...ACCESS644595_OUTPUT, description: 'Total count' },
    pagination: { ...PLANEV2PAGINATION_OUTPUT, description: 'Pagination' },
    next_cursor: { ...CYCLE883343_OUTPUT, description: 'Next cursor' },
    has_more: { ...HASPAGES8E2BC3_OUTPUT, description: 'Has more' },
  },
}

const PAGEF74376_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true },
    name: { type: 'string', description: 'Asset Id', optional: true },
    access: { type: 'number', description: 'Access', optional: true },
    logo_props: { type: 'json', description: 'logo props', optional: true },
    parent_id: {
      type: 'json',
      description: 'Parent id (nullable provider value).',
      optional: true,
    },
    collection_id: { type: 'string', description: 'Asset Id', optional: true },
    workspace: { type: 'string', description: 'Asset Id', optional: true },
    sub_pages_count: { type: 'number', description: 'Access', optional: true },
    is_shared: { type: 'boolean', description: 'Has Pages', optional: true },
    owned_by: { type: 'string', description: 'Asset Id', optional: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true },
    created_at: { type: 'string', description: 'Asset Id', optional: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true },
    updated_by: { type: 'string', description: 'Asset Id', optional: true },
    is_favorite: { type: 'boolean', description: 'Has Pages', optional: true },
    label_ids: {
      type: 'array',
      description: 'Label Ids',
      optional: true,
      items: { type: 'json', description: 'Logo Props' },
    },
  },
  nullable: true,
}

export const COLLECTIONBRANCHPAGEEDA77C_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'A row in the list-pages-in-collection response, with a nested page object.',
  optional: true,
  properties: {
    page_collection_id: { ...PAGECOLLECTIONID_OUTPUT, description: 'Page collection id' },
    collection_id: { ...COLLECTIONID_OUTPUT, description: 'Collection id' },
    parent_id: { ...PARENTID_OUTPUT, description: 'Parent id' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    page: { ...PAGEF74376_OUTPUT, description: 'Page' },
  },
}

export const CYCLE8C1C16_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Cycle model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    total_issues: { ...TOTALISSUES_OUTPUT, description: 'Total issues' },
    cancelled_issues: { ...CANCELLEDISSUES_OUTPUT, description: 'Cancelled issues' },
    completed_issues: { ...COMPLETEDISSUES_OUTPUT, description: 'Completed issues' },
    started_issues: { ...STARTEDISSUES_OUTPUT, description: 'Started issues' },
    unstarted_issues: { ...UNSTARTEDISSUES_OUTPUT, description: 'Unstarted issues' },
    backlog_issues: { ...BACKLOGISSUES_OUTPUT, description: 'Backlog issues' },
    total_estimates: { ...TOTALESTIMATES_OUTPUT, description: 'Total estimates' },
    completed_estimates: { ...COMPLETEDESTIMATES_OUTPUT, description: 'Completed estimates' },
    started_estimates: { ...STARTEDESTIMATES_OUTPUT, description: 'Started estimates' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    end_date: { ...ENDDATE_OUTPUT, description: 'End date' },
    view_props: { ...VIEWPROPS_OUTPUT, description: 'View props' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    progress_snapshot: { ...PROGRESSSNAPSHOT_OUTPUT, description: 'Progress snapshot' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    timezone: { ...TIMEZONE_OUTPUT, description: 'Timezone' },
    version: { ...VERSION_OUTPUT, description: 'Version' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    owned_by: { ...OWNEDBY4BE915_OUTPUT, description: 'Owned by' },
  },
}

export const PLANEUPDATEPROJECTMAPPINGBYKEYRESULT5729C9_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane Update Project Mapping By Key Result',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    idp_group_name: { ...ASSETID_OUTPUT, description: 'Idp group name' },
    project: { ...ASSETID_OUTPUT, description: 'Project' },
    all_projects: { ...HASPAGES8E2BC3_OUTPUT, description: 'All projects' },
    role: { ...ASSETID_OUTPUT, description: 'Role' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

export const MODULEE68880_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Module model.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    total_issues: { ...TOTALISSUES_OUTPUT, description: 'Total issues' },
    cancelled_issues: { ...CANCELLEDISSUES_OUTPUT, description: 'Cancelled issues' },
    completed_issues: { ...COMPLETEDISSUES_OUTPUT, description: 'Completed issues' },
    started_issues: { ...STARTEDISSUES_OUTPUT, description: 'Started issues' },
    unstarted_issues: { ...UNSTARTEDISSUES_OUTPUT, description: 'Unstarted issues' },
    backlog_issues: { ...BACKLOGISSUES_OUTPUT, description: 'Backlog issues' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    name: { ...NAMEEB0F45_OUTPUT, description: 'Name' },
    description: { ...DESCRIPTION_OUTPUT, description: 'Description' },
    description_text: { ...DESCRIPTIONTEXT_OUTPUT, description: 'Description text' },
    description_html: { ...DESCRIPTIONHTMLFA4901_OUTPUT, description: 'Description html' },
    start_date: { ...STARTDATE_OUTPUT, description: 'Start date' },
    target_date: { ...TARGETDATE_OUTPUT, description: 'Target date' },
    status: { ...STATUS_OUTPUT, description: 'Status' },
    view_props: { ...VIEWPROPS_OUTPUT, description: 'View props' },
    sort_order: { ...SORTORDER_OUTPUT, description: 'Sort order' },
    external_source: { ...EXTERNALSOURCE_OUTPUT, description: 'External source' },
    external_id: { ...EXTERNALID_OUTPUT, description: 'External id' },
    archived_at: { ...ARCHIVEDAT_OUTPUT, description: 'Archived at' },
    logo_props: { ...LOGOPROPS_OUTPUT, description: 'Logo props' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    lead: { ...LEAD_OUTPUT, description: 'Lead' },
    members: { ...DEFAULTVALUECB839F_OUTPUT, description: 'Members' },
  },
}

export const PLANECREATEPROJECTWITHTEMPLATERESULTBB886A_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane Create Project With Template Result',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    description: { ...ASSETID_OUTPUT, description: 'Description' },
    identifier: { ...ASSETID_OUTPUT, description: 'Identifier' },
    network: { ...ACCESS644595_OUTPUT, description: 'Network' },
    project_lead: { ...ASSETID_OUTPUT, description: 'Project lead' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
  },
}

const PAGE816670_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Nested page info returned inside a WorkItemPage response.',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    is_global: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
    description_html: { type: 'string', description: 'Asset Id', optional: true },
  },
  nullable: true,
}

export const WORKITEMPAGECAC7C5_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item to page link.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    page: { ...PAGE816670_OUTPUT, description: 'Page' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
  },
}

const PAGEFF2AA2_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Nested page info returned inside a WorkItemPage response.',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    name: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    updated_at: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    created_by: { type: 'string', description: 'Asset Id', optional: true, nullable: true },
    is_global: { type: 'boolean', description: 'Has Pages', optional: true, nullable: true },
    logo_props: { type: 'json', description: 'Logo Props', optional: true, nullable: true },
  },
  nullable: true,
}

export const WORKITEMPAGE3D85B8_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item to page link.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    page: { ...PAGEFF2AA2_OUTPUT, description: 'Page' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
  },
}

export const PLANECREATEWORKITEMRELATIONRESULTITEMITEM5C3495_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Plane Create Work Item Relation Result Item Item',
  optional: true,
  properties: {
    id: { ...ASSETID_OUTPUT, description: 'Id' },
    name: { ...ASSETID_OUTPUT, description: 'Name' },
    sequence_id: { ...ACCESS644595_OUTPUT, description: 'Sequence id' },
    project_id: { ...ASSETID_OUTPUT, description: 'Project id' },
    relation_type: { ...ASSETID_OUTPUT, description: 'Relation type' },
    state_id: { ...ASSETID_OUTPUT, description: 'State id' },
    priority: { ...ASSETID_OUTPUT, description: 'Priority' },
    type_id: { ...ASSETID_OUTPUT, description: 'Type id' },
    is_epic: { ...HASPAGES8E2BC3_OUTPUT, description: 'Is epic' },
    created_at: { ...ASSETID_OUTPUT, description: 'Created at' },
    updated_at: { ...ASSETID_OUTPUT, description: 'Updated at' },
    created_by: { ...ASSETID_OUTPUT, description: 'Created by' },
    updated_by: { ...ASSETID_OUTPUT, description: 'Updated by' },
  },
}

export const CYCLEWORKITEM639FF1_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Work item in a cycle.',
  optional: true,
  properties: {
    id: { ...ID_OUTPUT, description: 'Id' },
    sub_issues_count: { ...SUBISSUESCOUNT_OUTPUT, description: 'Sub issues count' },
    created_at: { ...CREATEDAT_OUTPUT, description: 'Created at' },
    updated_at: { ...UPDATEDAT_OUTPUT, description: 'Updated at' },
    deleted_at: { ...DELETEDAT_OUTPUT, description: 'Deleted at' },
    created_by: { ...CREATEDBY94A812_OUTPUT, description: 'Created by' },
    updated_by: { ...UPDATEDBY1F6D11_OUTPUT, description: 'Updated by' },
    project: { ...PROJECT0BF380_OUTPUT, description: 'Project' },
    workspace: { ...WORKSPACE8D2899_OUTPUT, description: 'Workspace' },
    issue: { ...ISSUE_OUTPUT, description: 'Issue' },
    cycle: { ...CYCLE_OUTPUT, description: 'Cycle' },
  },
}
