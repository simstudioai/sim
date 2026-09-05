import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import {
  oracleFusionExactInteger,
  serializeOracleFusionJsonBody,
} from '@/lib/internal/oracle-fusion/request-body'

export class ProcurementInputError extends Error {}
export class ProcurementResponseError extends Error {}

const MAX_INT64 = '9223372036854775807'
export const PROCUREMENT_PAGE_SIZE = 100
export const PROCUREMENT_MAX_OFFSET = 1_000_000
const MAX_INLINE_CHILDREN = 100

/** Input and output IDs stay strings across persistence and the internal-operation boundary. */
export const procurementIdentifierSchema = z.unknown().transform((value, context) => {
  const normalized = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (
    normalized === undefined ||
    normalized.length > MAX_INT64.length ||
    (normalized.length === MAX_INT64.length && normalized > MAX_INT64)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Expected an exact non-negative int64 ID; supply large identifiers as decimal strings',
    })
    return z.NEVER
  }
  return normalized
})

export const procurementKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      encodeOracleFusionPathSegment(value)
      return true
    } catch {
      return false
    }
  }, 'Expected an opaque Oracle resource key, not a URL')

export const procurementPagingSchema = z.object({
  limit: z.number().int().min(1).max(PROCUREMENT_PAGE_SIZE).default(PROCUREMENT_PAGE_SIZE),
  offset: z.number().int().min(0).max(PROCUREMENT_MAX_OFFSET).default(0),
  q: z.string().trim().max(4096).optional(),
  orderBy: z.string().trim().max(1024).optional(),
  totalResults: z.boolean().optional(),
})

function nullableField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === undefined ? null : value), schema.nullable())
}

const nullableString = nullableField(z.string())
/**
 * Framework v9 sends high-precision numeric attributes as strings. Like SAP decimal
 * outputs, use one stable string representation instead of silently rounding them.
 */
const nullableNumber = nullableField(
  z
    .union([
      z
        .number()
        .finite()
        .refine((value) => !Number.isInteger(value) || Number.isSafeInteger(value)),
      z
        .string()
        .max(256)
        .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/),
    ])
    .transform((value) => String(value))
)
const nullableBoolean = nullableField(z.boolean())
const nullableIdentifier = nullableField(procurementIdentifierSchema)

/**
 * These are projections, not passthrough schemas. Oracle links and @context are consumed
 * before parsing so framework-v9 resource keys survive without exposing provider metadata.
 */
export const procurementResourceSchemas = {
  /** 26C: op-suppliers-supplierid-get.html */
  suppliers: z.object({
    SupplierId: procurementIdentifierSchema,
    Supplier: nullableString,
    SupplierNumber: nullableString,
    SupplierPartyId: nullableIdentifier,
    AlternateName: nullableString,
    Alias: nullableString,
    BusinessRelationship: nullableString,
    BusinessRelationshipCode: nullableString,
    SupplierType: nullableString,
    SupplierTypeCode: nullableString,
    Status: nullableString,
    CorporateWebsite: nullableString,
    OneTimeSupplierFlag: nullableBoolean,
    InactiveDate: nullableString,
    CreationDate: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-suppliers-supplierid-child-sites-suppliersiteid-get.html */
  supplierSites: z.object({
    SupplierSiteId: procurementIdentifierSchema,
    SupplierSite: nullableString,
    ProcurementBUId: nullableIdentifier,
    ProcurementBU: nullableString,
    SupplierAddressId: nullableIdentifier,
    SupplierAddressName: nullableString,
    SitePurposePurchasingFlag: nullableBoolean,
    SitePurposeSourcingOnlyFlag: nullableBoolean,
    Status: nullableString,
    Email: nullableString,
    CommunicationMethodCode: nullableString,
    HoldAllNewPurchasingDocumentsFlag: nullableBoolean,
    PurchasingHoldReason: nullableString,
    InactiveDate: nullableString,
    CreationDate: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-purchaserequisitions-purchaserequisitionsuniqid-get.html */
  purchaseRequisitions: z.object({
    RequisitionHeaderId: procurementIdentifierSchema,
    Requisition: nullableString,
    Description: nullableString,
    DocumentStatus: nullableString,
    DocumentStatusCode: nullableString,
    PreparerId: nullableIdentifier,
    Preparer: nullableString,
    RequisitioningBUId: nullableIdentifier,
    RequisitioningBU: nullableString,
    Justification: nullableString,
    FunctionalCurrencyCode: nullableString,
    FundsStatus: nullableString,
    FundsStatusCode: nullableString,
    SubmissionDate: nullableString,
    ApprovedDate: nullableString,
    CreationDate: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-purchaserequisitions-purchaserequisitionsuniqid-child-lines-get.html */
  purchaseRequisitionLines: z.object({
    RequisitionLineId: procurementIdentifierSchema,
    RequisitionHeaderId: nullableIdentifier,
    LineNumber: nullableNumber,
    LineStatus: nullableString,
    ItemId: nullableIdentifier,
    Item: nullableString,
    ItemDescription: nullableString,
    Quantity: nullableNumber,
    UOMCode: nullableString,
    UnitPrice: nullableNumber,
    CurrencyCode: nullableString,
    Amount: nullableNumber,
    RequestedDeliveryDate: nullableString,
    RequesterId: nullableIdentifier,
    Requester: nullableString,
    SupplierId: nullableIdentifier,
    Supplier: nullableString,
    SupplierSiteId: nullableIdentifier,
    SupplierSite: nullableString,
    POHeaderId: nullableIdentifier,
    PurchaseOrder: nullableString,
  }),
  /** 26C: op-draftpurchaseorders-draftpurchaseordersuniqid-get.html */
  draftPurchaseOrders: z.object({
    POHeaderId: procurementIdentifierSchema,
    VersionId: nullableIdentifier,
    OrderNumber: nullableString,
    Description: nullableString,
    Status: nullableString,
    StatusCode: nullableString,
    ChangeOrderStatusCode: nullableString,
    BuyerId: nullableIdentifier,
    Buyer: nullableString,
    ProcurementBUId: nullableIdentifier,
    ProcurementBU: nullableString,
    RequisitioningBUId: nullableIdentifier,
    SupplierId: nullableIdentifier,
    Supplier: nullableString,
    SupplierSiteId: nullableIdentifier,
    SupplierSite: nullableString,
    DocumentStyleId: nullableIdentifier,
    DocumentStyle: nullableString,
    CurrencyCode: nullableString,
    OrderedAmountBeforeAdjustments: nullableNumber,
    FundsStatus: nullableString,
    CreationDate: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-draftpurchaseorders-draftpurchaseordersuniqid-child-lines-get.html */
  draftPurchaseOrderLines: z.object({
    POLineId: procurementIdentifierSchema,
    POHeaderId: nullableIdentifier,
    LineNumber: nullableNumber,
    LineTypeId: nullableIdentifier,
    LineType: nullableString,
    ItemId: nullableIdentifier,
    Item: nullableString,
    Description: nullableString,
    Quantity: nullableNumber,
    Price: nullableNumber,
    Amount: nullableNumber,
    CurrencyCode: nullableString,
    UOMCode: nullableString,
    SupplierItem: nullableString,
    CategoryId: nullableIdentifier,
    Category: nullableString,
    CancelFlag: nullableBoolean,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-purchaseorders-purchaseordersuniqid-get.html */
  purchaseOrders: z.object({
    POHeaderId: procurementIdentifierSchema,
    OrderNumber: nullableString,
    Description: nullableString,
    Status: nullableString,
    StatusCode: nullableString,
    BuyerId: nullableIdentifier,
    Buyer: nullableString,
    ProcurementBUId: nullableIdentifier,
    ProcurementBU: nullableString,
    RequisitioningBUId: nullableIdentifier,
    SupplierId: nullableIdentifier,
    Supplier: nullableString,
    SupplierSiteId: nullableIdentifier,
    SupplierSite: nullableString,
    DocumentStyleId: nullableIdentifier,
    CurrencyCode: nullableString,
    Ordered: nullableNumber,
    Total: nullableNumber,
    Revision: nullableNumber,
    FrozenFlag: nullableBoolean,
    FundsStatus: nullableString,
    OrderDate: nullableString,
    CreationDate: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-purchaseorders-purchaseordersuniqid-child-lines-get.html */
  purchaseOrderLines: z.object({
    POLineId: procurementIdentifierSchema,
    POHeaderId: nullableIdentifier,
    LineNumber: nullableNumber,
    LineTypeId: nullableIdentifier,
    LineType: nullableString,
    ItemId: nullableIdentifier,
    Item: nullableString,
    Description: nullableString,
    Quantity: nullableNumber,
    Price: nullableNumber,
    Ordered: nullableNumber,
    Total: nullableNumber,
    CurrencyCode: nullableString,
    UOMCode: nullableString,
    SupplierItem: nullableString,
    Status: nullableString,
    StatusCode: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-purchaseorderlifecycledetails-poheaderid-get.html */
  purchaseOrderLifecycleDetails: z.object({
    POHeaderId: procurementIdentifierSchema,
    OrderNumber: nullableString,
    CurrencyCode: nullableString,
    OrderedAmount: nullableNumber,
    DeliveredAmount: nullableNumber,
    InReceivingAmount: nullableNumber,
    InTransitAmount: nullableNumber,
    PaidAmount: nullableNumber,
    PartiallyPaidAmount: nullableNumber,
    UnpaidAmount: nullableNumber,
    NetRetainage: nullableNumber,
    Retainage: nullableNumber,
    RetainageReleased: nullableNumber,
  }),
  /** 26C: op-purchaseorderlifecycledetails-poheaderid-child-receipts-receiptsuniqid-get.html */
  purchaseOrderReceipts: z.object({
    ReceiptId: nullableIdentifier,
    Receipt: nullableString,
    ReceiptDate: nullableString,
    POHeaderId: nullableIdentifier,
    POLineId: nullableIdentifier,
    LineLocationId: nullableIdentifier,
    LineNumber: nullableNumber,
    ScheduleNumber: nullableNumber,
    ItemOrScheduleDescription: nullableString,
    ReceivedBy: nullableString,
    ReceivedQuantity: nullableNumber,
    DeliveredQuantity: nullableNumber,
    ReturnedQuantity: nullableNumber,
    ReceivedAmount: nullableNumber,
    DeliveredAmount: nullableNumber,
    CurrencyCode: nullableString,
    UOMCode: nullableString,
    ShipmentId: nullableIdentifier,
    ShipmentNumber: nullableString,
  }),
  /** 26C: op-suppliernegotiations-suppliernegotiationsuniqid-get.html */
  supplierNegotiations: z.object({
    AuctionHeaderId: procurementIdentifierSchema,
    Negotiation: nullableString,
    NegotiationTitle: nullableString,
    NegotiationType: nullableString,
    NegotiationTypeId: nullableIdentifier,
    NegotiationStyleId: nullableIdentifier,
    NegotiationStatus: nullableString,
    NegotiationStatusCode: nullableString,
    ProcurementBUId: nullableIdentifier,
    ProcurementBU: nullableString,
    BuyerId: nullableIdentifier,
    Buyer: nullableString,
    CurrencyCode: nullableString,
    OpenDate: nullableString,
    CloseDate: nullableString,
    AwardStatus: nullableString,
    SuppliersCount: nullableNumber,
    SupplierResponses: nullableNumber,
    CreationDate: nullableString,
    LastUpdateDate: nullableString,
  }),
  /** 26C: op-suppliernegotiationresponses-suppliernegotiationresponsesuniqid-get.html */
  supplierNegotiationResponses: z.object({
    ResponseNumber: procurementIdentifierSchema,
    AuctionHeaderId: nullableIdentifier,
    Negotiation: nullableString,
    NegotiationTitle: nullableString,
    ResponseStatus: nullableString,
    ResponseStatusCode: nullableString,
    SupplierId: nullableIdentifier,
    Supplier: nullableString,
    SupplierSiteId: nullableIdentifier,
    SupplierSite: nullableString,
    ResponseDate: nullableString,
    ResponseAmount: nullableString,
    ResponseCurrencyCode: nullableString,
    NegotiationCurrencyCode: nullableString,
    AwardStatus: nullableString,
    ShortlistFlag: nullableBoolean,
    NoteToBuyer: nullableString,
    CreationDate: nullableString,
  }),
  /** 26C: op-procurementagents-assignmentid-get.html */
  procurementAgents: z.object({
    AssignmentId: procurementIdentifierSchema,
    AgentId: nullableIdentifier,
    Agent: nullableString,
    AgentEmail: nullableString,
    ProcurementBUId: nullableIdentifier,
    ProcurementBU: nullableString,
    DefaultRequisitioningBUId: nullableIdentifier,
    DefaultRequisitioningBU: nullableString,
    Status: nullableString,
    StatusCode: nullableString,
    ManageOrdersAllowedFlag: nullableBoolean,
    ManageRequisitionsAllowedFlag: nullableBoolean,
    ManageSuppliersAllowedFlag: nullableBoolean,
    ManageNegotiationsAllowedFlag: nullableBoolean,
    AccessLevelToOtherAgentsOrdersCode: nullableString,
  }),
  /** 26C: op-procurementbusinessunitslov-get.html */
  procurementBusinessUnits: z.object({
    ProcurementBUId: procurementIdentifierSchema,
    ProcurementBU: nullableString,
    AgentAction: nullableString,
  }),
  /** 26C: op-procurementpersonslov-get.html */
  procurementPersons: z.object({
    PersonId: nullableIdentifier,
    PersonNumber: nullableString,
    DisplayName: nullableString,
  }),
  /** 26C: op-purchasingdocumentstyleslov-get.html */
  purchasingDocumentStyles: z.object({
    StyleId: procurementIdentifierSchema,
    StyleName: nullableString,
    DisplayName: nullableString,
    DocumentSubtype: nullableString,
    StatusCode: nullableString,
  }),
  /** 26C: op-suppliers-supplierid-child-addresses-get.html */
  supplierAddresses: z.object({
    SupplierAddressId: procurementIdentifierSchema,
    AddressName: nullableString,
    FormattedAddress: nullableString,
    Status: nullableString,
  }),
} as const

export type ProcurementResource = keyof typeof procurementResourceSchemas

/**
 * Exact-integer wrappers are constructed only here on the server, immediately before
 * transport serialization. Never expose these wrappers as persisted tool or block inputs.
 */
const requestInteger = procurementIdentifierSchema.transform(oracleFusionExactInteger)
const requestDate = z.string().date()
const requestDateTime = z.union([z.string().datetime({ offset: true }), requestDate])

/** 26C: op-suppliers-supplierid-child-addresses-post.html */
const supplierAddressBodySchema = z.object({
  CountryCode: z.string().max(2),
  Email: z.string().max(320).optional(),
  AddressName: z.string().max(240).nullable().optional(),
  AddressLine1: z.string().max(240).nullable().optional(),
  AddressLine2: z.string().max(240).nullable().optional(),
  City: z.string().max(60).nullable().optional(),
  State: z.string().max(60).nullable().optional(),
  Province: z.string().max(60).nullable().optional(),
  PostalCode: z.string().max(60).nullable().optional(),
  AddressPurposeOrderingFlag: z.boolean().nullable().optional(),
  AddressPurposeRFQOrBiddingFlag: z.boolean().nullable().optional(),
}).strict()

/** 26C: op-suppliers-supplierid-child-sites-suppliersiteid-child-assignments-post.html */
const supplierSiteAssignmentBodySchema = z
  .object({
    ClientBUId: requestInteger.nullable().optional(),
    BillToBUId: requestInteger.nullable().optional(),
    ShipToLocationId: requestInteger.nullable().optional(),
    BillToLocationId: requestInteger.nullable().optional(),
    InactiveDate: requestDate.nullable().optional(),
  })
  .strict()

/** 26C: op-purchaserequisitions-purchaserequisitionsuniqid-child-lines-post.html */
const requisitionLineBodySchema = z
  .object({
    LineNumber: z.number().finite(),
    LineTypeId: requestInteger.nullable().optional(),
    ItemId: requestInteger.nullable().optional(),
    Item: z.string().max(300).nullable().optional(),
    ItemDescription: z.string().max(240).nullable().optional(),
    CategoryId: requestInteger.nullable().optional(),
    Quantity: z.number().finite().nullable().optional(),
    UOMCode: z.string().max(3).nullable().optional(),
    UnitPrice: z.number().finite().nullable().optional(),
    CurrencyCode: z.string().max(15).nullable().optional(),
    RequestedDeliveryDate: requestDate.nullable().optional(),
    RequesterId: requestInteger.nullable().optional(),
    DeliverToLocationId: requestInteger.nullable().optional(),
    DestinationTypeCode: z.string().max(25).nullable().optional(),
    DestinationOrganizationId: requestInteger.nullable().optional(),
    SupplierId: requestInteger.nullable().optional(),
    SupplierSiteId: requestInteger.nullable().optional(),
    NoteToBuyer: z.string().max(1000).nullable().optional(),
    NoteToSupplier: z.string().max(1000).nullable().optional(),
    UrgentFlag: z.boolean().nullable().optional(),
  })
  .strict()

/** 26C: op-draftpurchaseorders-draftpurchaseordersuniqid-child-lines-polineid-child-schedules-post.html */
const draftPurchaseOrderScheduleBodySchema = z
  .object({
    ScheduleNumber: z.number().finite(),
    ShipToLocationId: requestInteger.optional(),
    ShipToOrganizationId: requestInteger.optional(),
    ShipToOrganizationCode: z.string().max(18).nullable().optional(),
    Quantity: z.number().finite().nullable().optional(),
    Price: z.number().finite().nullable().optional(),
    Amount: z.number().finite().nullable().optional(),
    RequestedDeliveryDate: requestDate.nullable().optional(),
    PromisedDeliveryDate: requestDate.nullable().optional(),
    RequestedShipDate: requestDate.nullable().optional(),
    PromisedShipDate: requestDate.nullable().optional(),
    DestinationTypeCode: z.string().max(25).nullable().optional(),
    ReceiptRequiredFlag: z.boolean().optional(),
    InspectionRequiredFlag: z.boolean().optional(),
    ReceiptRoutingId: requestInteger.optional(),
  })
  .strict()

/** 26C: op-draftpurchaseorders-draftpurchaseordersuniqid-child-lines-post.html */
const draftPurchaseOrderLineBodySchema = z
  .object({
    LineNumber: z.number().finite(),
    LineTypeId: requestInteger.optional(),
    LineType: z.string().max(30).optional(),
    ItemId: requestInteger.nullable().optional(),
    Item: z.string().max(4000).nullable().optional(),
    Description: z.string().max(240).nullable().optional(),
    CategoryId: requestInteger.nullable().optional(),
    Quantity: z.number().finite().nullable().optional(),
    UOMCode: z.string().max(3).nullable().optional(),
    Price: z.number().finite().nullable().optional(),
    Amount: z.number().finite().nullable().optional(),
    SupplierItem: z.string().max(300).nullable().optional(),
    NoteToSupplier: z.string().max(1000).nullable().optional(),
    schedules: z.array(draftPurchaseOrderScheduleBodySchema).max(MAX_INLINE_CHILDREN).optional(),
  })
  .strict()

/** 26C: op-suppliernegotiations-suppliernegotiationsuniqid-child-lines-post.html */
const negotiationLineBodySchema = z
  .object({
    Line: z.string().max(25).nullable().optional(),
    LineTypeId: requestInteger.nullable().optional(),
    ItemId: requestInteger.nullable().optional(),
    Item: z.string().max(300).nullable().optional(),
    LineDescription: z.string().max(2500).nullable().optional(),
    CategoryId: requestInteger.nullable().optional(),
    Quantity: z.number().finite().nullable().optional(),
    UOMCode: z.string().max(3).nullable().optional(),
    StartPrice: z.number().finite().nullable().optional(),
    TargetPrice: z.number().finite().nullable().optional(),
    RequestedDeliveryDate: requestDate.nullable().optional(),
    ShipToLocationId: requestInteger.nullable().optional(),
    RequisitioningBUId: requestInteger.nullable().optional(),
    NoteToSuppliers: z.string().max(4000).nullable().optional(),
  })
  .strict()

/** 26C: op-suppliernegotiations-suppliernegotiationsuniqid-child-suppliers-post.html */
const negotiationSupplierBodySchema = z
  .object({
    SupplierId: requestInteger,
    SupplierSiteId: requestInteger.nullable().optional(),
    SupplierContactId: requestInteger.nullable().optional(),
    AdditionalContactEmail: z.string().max(240).nullable().optional(),
    NotifyAllSupplierContactsFlag: z.boolean().nullable().optional(),
  })
  .strict()

/**
 * Oracle's supplier create example omits SupplierNumber/SupplierPartyId, and PATCH
 * examples omit unchanged required-on-create fields. Do not require those generated values.
 * https://docs.oracle.com/en/cloud/saas/procurement/26c/fapra/op-suppliers-post.html
 */
export const procurementWriteSchemas = {
  /** 26C: op-suppliers-post.html */
  createSupplier: z
    .object({
      Supplier: z.string().max(360),
      SupplierNumber: z.string().max(30).optional(),
      SupplierPartyId: requestInteger.optional(),
      AlternateName: z.string().max(360).nullable().optional(),
      Alias: z.string().max(360).nullable().optional(),
      CorporateWebsite: z.string().max(150).nullable().optional(),
      BusinessRelationshipCode: z.string().max(30).nullable().optional(),
      SupplierTypeCode: z.string().max(30).nullable().optional(),
      TaxOrganizationTypeCode: z.string().max(30).nullable().optional(),
      OneTimeSupplierFlag: z.boolean().nullable().optional(),
      ParentSupplierId: requestInteger.nullable().optional(),
      InactiveDate: requestDate.nullable().optional(),
      addresses: z.array(supplierAddressBodySchema).max(MAX_INLINE_CHILDREN).optional(),
    })
    .strict(),
  /** 26C: op-suppliers-supplierid-patch.html */
  updateSupplier: z
    .object({
      Supplier: z.string().max(360).optional(),
      AlternateName: z.string().max(360).nullable().optional(),
      Alias: z.string().max(360).nullable().optional(),
      CorporateWebsite: z.string().max(150).nullable().optional(),
      SupplierTypeCode: z.string().max(30).nullable().optional(),
      OneTimeSupplierFlag: z.boolean().nullable().optional(),
      ParentSupplierId: requestInteger.nullable().optional(),
      InactiveDate: requestDate.nullable().optional(),
    })
    .strict(),
  /** 26C: op-suppliers-supplierid-child-sites-post.html */
  createSupplierSite: z
    .object({
      ProcurementBUId: requestInteger,
      SupplierSite: z.string().max(240),
      SupplierAddressId: requestInteger.nullable().optional(),
      SupplierAddressName: z.string().max(240).nullable().optional(),
      SitePurposePurchasingFlag: z.boolean().nullable().optional(),
      SitePurposeSourcingOnlyFlag: z.boolean().nullable().optional(),
      Email: z.string().max(2000).nullable().optional(),
      CommunicationMethodCode: z.string().max(25).nullable().optional(),
      HoldAllNewPurchasingDocumentsFlag: z.boolean().nullable().optional(),
      PurchasingHoldReason: z.string().max(240).nullable().optional(),
      InactiveDate: requestDate.nullable().optional(),
      assignments: z.array(supplierSiteAssignmentBodySchema).max(MAX_INLINE_CHILDREN).optional(),
    })
    .strict(),
  /** 26C: op-suppliers-supplierid-child-sites-suppliersiteid-patch.html */
  updateSupplierSite: z
    .object({
      SupplierSite: z.string().max(240).optional(),
      SitePurposePurchasingFlag: z.boolean().nullable().optional(),
      SitePurposeSourcingOnlyFlag: z.boolean().nullable().optional(),
      Email: z.string().max(2000).nullable().optional(),
      CommunicationMethodCode: z.string().max(25).nullable().optional(),
      HoldAllNewPurchasingDocumentsFlag: z.boolean().nullable().optional(),
      PurchasingHoldReason: z.string().max(240).nullable().optional(),
      InactiveDate: requestDate.nullable().optional(),
    })
    .strict(),
  /** 26C: op-purchaserequisitions-post.html */
  createPurchaseRequisition: z
    .object({
      PreparerId: requestInteger,
      RequisitioningBUId: requestInteger,
      Description: z.string().max(240).nullable().optional(),
      Justification: z.string().max(1000).nullable().optional(),
      EmergencyRequisitionFlag: z.boolean().nullable().optional(),
      lines: z.array(requisitionLineBodySchema).max(MAX_INLINE_CHILDREN).optional(),
    })
    .strict(),
  /** 26C: op-purchaserequisitions-purchaserequisitionsuniqid-patch.html */
  updatePurchaseRequisition: z
    .object({
      PreparerId: requestInteger.optional(),
      RequisitioningBUId: requestInteger.optional(),
      Description: z.string().max(240).nullable().optional(),
      Justification: z.string().max(1000).nullable().optional(),
      EmergencyRequisitionFlag: z.boolean().nullable().optional(),
    })
    .strict(),
  /** 26C: op-draftpurchaseorders-post.html */
  createDraftPurchaseOrder: z
    .object({
      BuyerId: requestInteger,
      DocumentStyleId: requestInteger,
      ProcurementBUId: requestInteger,
      SupplierId: requestInteger.nullable().optional(),
      SupplierSiteId: requestInteger.nullable().optional(),
      RequisitioningBUId: requestInteger.nullable().optional(),
      CurrencyCode: z.string().max(15).nullable().optional(),
      Description: z.string().max(240).nullable().optional(),
      OrderNumber: z.string().max(30).nullable().optional(),
      NoteToSupplier: z.string().max(1000).nullable().optional(),
      NoteToReceiver: z.string().max(1000).nullable().optional(),
      DefaultShipToLocationId: requestInteger.nullable().optional(),
      BillToLocationId: requestInteger.nullable().optional(),
      BillToBUId: requestInteger.nullable().optional(),
      lines: z.array(draftPurchaseOrderLineBodySchema).max(MAX_INLINE_CHILDREN).optional(),
    })
    .strict(),
  /** 26C: op-draftpurchaseorders-draftpurchaseordersuniqid-patch.html */
  updateDraftPurchaseOrder: z
    .object({
      BuyerId: requestInteger.optional(),
      SupplierSiteId: requestInteger.nullable().optional(),
      Description: z.string().max(240).nullable().optional(),
      NoteToSupplier: z.string().max(1000).nullable().optional(),
      NoteToReceiver: z.string().max(1000).nullable().optional(),
      BillToLocationId: requestInteger.nullable().optional(),
    })
    .strict(),
  /** 26C: op-suppliernegotiations-post.html */
  createSupplierNegotiation: z
    .object({
      ProcurementBUId: requestInteger,
      BuyerId: requestInteger.nullable().optional(),
      NegotiationTitle: z.string().max(80).nullable().optional(),
      NegotiationType: z.string().max(50).nullable().optional(),
      NegotiationTypeId: requestInteger.nullable().optional(),
      NegotiationStyleId: requestInteger.nullable().optional(),
      CurrencyCode: z.string().max(15).nullable().optional(),
      Outcome: z.string().max(240).nullable().optional(),
      OpenDate: requestDateTime.nullable().optional(),
      CloseDate: requestDateTime.nullable().optional(),
      PreviewDate: requestDateTime.nullable().optional(),
      OpenImmediatelyFlag: z.boolean().nullable().optional(),
      PreviewImmediatelyFlag: z.boolean().nullable().optional(),
      RestrictToInvitedSuppliersFlag: z.boolean().nullable().optional(),
      RequisitioningBUId: requestInteger.nullable().optional(),
      Synopsis: z.string().max(4000).nullable().optional(),
      lines: z.array(negotiationLineBodySchema).max(MAX_INLINE_CHILDREN).optional(),
      suppliers: z.array(negotiationSupplierBodySchema).max(MAX_INLINE_CHILDREN).optional(),
    })
    .strict(),
  /** 26C: op-suppliernegotiations-suppliernegotiationsuniqid-patch.html */
  updateSupplierNegotiation: z
    .object({
      NegotiationTitle: z.string().max(80).nullable().optional(),
      CurrencyCode: z.string().max(15).nullable().optional(),
      OpenDate: requestDateTime.nullable().optional(),
      CloseDate: requestDateTime.nullable().optional(),
      PreviewDate: requestDateTime.nullable().optional(),
      OpenImmediatelyFlag: z.boolean().nullable().optional(),
      PreviewImmediatelyFlag: z.boolean().nullable().optional(),
      RestrictToInvitedSuppliersFlag: z.boolean().nullable().optional(),
      RequisitioningBUId: requestInteger.nullable().optional(),
      Synopsis: z.string().max(4000).nullable().optional(),
    })
    .strict(),
} as const

export type ProcurementWriteOperation = keyof typeof procurementWriteSchemas

export function parseProcurementBody(value: unknown, required: boolean): Record<string, unknown> {
  if (value === undefined || value === '') {
    if (required) throw new ProcurementInputError('A non-empty body is required for this update')
    return {}
  }
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_INLINE_MATERIALIZATION_BYTES) {
      throw new ProcurementInputError('Procurement body exceeds the inline byte limit')
    }
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new ProcurementInputError('Procurement body must be valid JSON')
    }
  }
  if (!isPlainRecord(parsed)) throw new ProcurementInputError('Procurement body must be an object')
  if (required && Object.keys(parsed).length === 0) {
    throw new ProcurementInputError('A non-empty body is required for this update')
  }
  /** Bound bytes, nesting, and nodes before recursive schema parsing of caller-supplied objects. */
  try {
    serializeOracleFusionJsonBody(parsed)
  } catch {
    throw new ProcurementInputError('Procurement body must be bounded plain JSON')
  }
  return parsed
}
