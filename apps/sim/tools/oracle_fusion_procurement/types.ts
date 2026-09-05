import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface OracleFusionProcurementAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleFusionProcurementParams extends OracleFusionProcurementAuthParams {
  [key: string]: unknown
}

export interface OracleFusionProcurementListResponse extends ToolResponse {
  output: {
    items: Array<Record<string, unknown>>
    count: number
    hasMore: boolean
    limit: number
    offset: number
    totalResults?: number
    nextOffset?: number
  }
}

export type OracleFusionProcurementDetailResponse<Wrapper extends string> = ToolResponse & {
  output: Record<Wrapper, Record<string, unknown>>
}

// Explicit 26C projections. Uppercase constants in types.ts follow the shared docs parser contract.
export const SUPPLIER_OUTPUT_PROPERTIES = {
  SupplierId: {
    type: 'string',
    description: 'Supplier Id as an exact decimal string',
  },
  Supplier: {
    type: 'string',
    description: 'Supplier',
    nullable: true,
  },
  SupplierNumber: {
    type: 'string',
    description: 'Supplier Number',
    nullable: true,
  },
  SupplierPartyId: {
    type: 'string',
    description: 'Supplier Party Id as an exact decimal string',
    nullable: true,
  },
  AlternateName: {
    type: 'string',
    description: 'Alternate Name',
    nullable: true,
  },
  Alias: {
    type: 'string',
    description: 'Alias',
    nullable: true,
  },
  BusinessRelationship: {
    type: 'string',
    description: 'Business Relationship',
    nullable: true,
  },
  BusinessRelationshipCode: {
    type: 'string',
    description: 'Business Relationship Code',
    nullable: true,
  },
  SupplierType: {
    type: 'string',
    description: 'Supplier Type',
    nullable: true,
  },
  SupplierTypeCode: {
    type: 'string',
    description: 'Supplier Type Code',
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    nullable: true,
  },
  CorporateWebsite: {
    type: 'string',
    description: 'Corporate Website',
    nullable: true,
  },
  OneTimeSupplierFlag: {
    type: 'boolean',
    description: 'One Time Supplier Flag',
    nullable: true,
  },
  InactiveDate: {
    type: 'string',
    description: 'Inactive Date',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SUPPLIER_SITE_OUTPUT_PROPERTIES = {
  SupplierSiteId: {
    type: 'string',
    description: 'Supplier Site Id as an exact decimal string',
  },
  SupplierSite: {
    type: 'string',
    description: 'Supplier Site',
    nullable: true,
  },
  ProcurementBUId: {
    type: 'string',
    description: 'Procurement BUId as an exact decimal string',
    nullable: true,
  },
  ProcurementBU: {
    type: 'string',
    description: 'Procurement BU',
    nullable: true,
  },
  SupplierAddressId: {
    type: 'string',
    description: 'Supplier Address Id as an exact decimal string',
    nullable: true,
  },
  SupplierAddressName: {
    type: 'string',
    description: 'Supplier Address Name',
    nullable: true,
  },
  SitePurposePurchasingFlag: {
    type: 'boolean',
    description: 'Site Purpose Purchasing Flag',
    nullable: true,
  },
  SitePurposeSourcingOnlyFlag: {
    type: 'boolean',
    description: 'Site Purpose Sourcing Only Flag',
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    nullable: true,
  },
  Email: {
    type: 'string',
    description: 'Email',
    nullable: true,
  },
  CommunicationMethodCode: {
    type: 'string',
    description: 'Communication Method Code',
    nullable: true,
  },
  HoldAllNewPurchasingDocumentsFlag: {
    type: 'boolean',
    description: 'Hold All New Purchasing Documents Flag',
    nullable: true,
  },
  PurchasingHoldReason: {
    type: 'string',
    description: 'Purchasing Hold Reason',
    nullable: true,
  },
  InactiveDate: {
    type: 'string',
    description: 'Inactive Date',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PURCHASE_REQUISITION_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Authoritative opaque resource key from the Oracle self link',
  },
  RequisitionHeaderId: {
    type: 'string',
    description: 'Requisition Header Id as an exact decimal string',
  },
  Requisition: {
    type: 'string',
    description: 'Requisition',
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    nullable: true,
  },
  DocumentStatus: {
    type: 'string',
    description: 'Document Status',
    nullable: true,
  },
  DocumentStatusCode: {
    type: 'string',
    description: 'Document Status Code',
    nullable: true,
  },
  PreparerId: {
    type: 'string',
    description: 'Preparer Id as an exact decimal string',
    nullable: true,
  },
  Preparer: {
    type: 'string',
    description: 'Preparer',
    nullable: true,
  },
  RequisitioningBUId: {
    type: 'string',
    description: 'Requisitioning BUId as an exact decimal string',
    nullable: true,
  },
  RequisitioningBU: {
    type: 'string',
    description: 'Requisitioning BU',
    nullable: true,
  },
  Justification: {
    type: 'string',
    description: 'Justification',
    nullable: true,
  },
  FunctionalCurrencyCode: {
    type: 'string',
    description: 'Functional Currency Code',
    nullable: true,
  },
  FundsStatus: {
    type: 'string',
    description: 'Funds Status',
    nullable: true,
  },
  FundsStatusCode: {
    type: 'string',
    description: 'Funds Status Code',
    nullable: true,
  },
  SubmissionDate: {
    type: 'string',
    description: 'Submission Date',
    nullable: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'Approved Date',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PURCHASE_REQUISITION_LINE_OUTPUT_PROPERTIES = {
  RequisitionLineId: {
    type: 'string',
    description: 'Requisition Line Id as an exact decimal string',
  },
  RequisitionHeaderId: {
    type: 'string',
    description: 'Requisition Header Id as an exact decimal string',
    nullable: true,
  },
  LineNumber: {
    type: 'string',
    description: 'Line Number as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  LineStatus: {
    type: 'string',
    description: 'Line Status',
    nullable: true,
  },
  ItemId: {
    type: 'string',
    description: 'Item Id as an exact decimal string',
    nullable: true,
  },
  Item: {
    type: 'string',
    description: 'Item',
    nullable: true,
  },
  ItemDescription: {
    type: 'string',
    description: 'Item Description',
    nullable: true,
  },
  Quantity: {
    type: 'string',
    description: 'Quantity as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  UOMCode: {
    type: 'string',
    description: 'UOMCode',
    nullable: true,
  },
  UnitPrice: {
    type: 'string',
    description: 'Unit Price as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  Amount: {
    type: 'string',
    description: 'Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  RequestedDeliveryDate: {
    type: 'string',
    description: 'Requested Delivery Date',
    nullable: true,
  },
  RequesterId: {
    type: 'string',
    description: 'Requester Id as an exact decimal string',
    nullable: true,
  },
  Requester: {
    type: 'string',
    description: 'Requester',
    nullable: true,
  },
  SupplierId: {
    type: 'string',
    description: 'Supplier Id as an exact decimal string',
    nullable: true,
  },
  Supplier: {
    type: 'string',
    description: 'Supplier',
    nullable: true,
  },
  SupplierSiteId: {
    type: 'string',
    description: 'Supplier Site Id as an exact decimal string',
    nullable: true,
  },
  SupplierSite: {
    type: 'string',
    description: 'Supplier Site',
    nullable: true,
  },
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
    nullable: true,
  },
  PurchaseOrder: {
    type: 'string',
    description: 'Purchase Order',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Authoritative opaque resource key from the Oracle self link',
  },
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
  },
  VersionId: {
    type: 'string',
    description: 'Version Id as an exact decimal string',
    nullable: true,
  },
  OrderNumber: {
    type: 'string',
    description: 'Order Number',
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    nullable: true,
  },
  ChangeOrderStatusCode: {
    type: 'string',
    description: 'Change Order Status Code',
    nullable: true,
  },
  BuyerId: {
    type: 'string',
    description: 'Buyer Id as an exact decimal string',
    nullable: true,
  },
  Buyer: {
    type: 'string',
    description: 'Buyer',
    nullable: true,
  },
  ProcurementBUId: {
    type: 'string',
    description: 'Procurement BUId as an exact decimal string',
    nullable: true,
  },
  ProcurementBU: {
    type: 'string',
    description: 'Procurement BU',
    nullable: true,
  },
  RequisitioningBUId: {
    type: 'string',
    description: 'Requisitioning BUId as an exact decimal string',
    nullable: true,
  },
  SupplierId: {
    type: 'string',
    description: 'Supplier Id as an exact decimal string',
    nullable: true,
  },
  Supplier: {
    type: 'string',
    description: 'Supplier',
    nullable: true,
  },
  SupplierSiteId: {
    type: 'string',
    description: 'Supplier Site Id as an exact decimal string',
    nullable: true,
  },
  SupplierSite: {
    type: 'string',
    description: 'Supplier Site',
    nullable: true,
  },
  DocumentStyleId: {
    type: 'string',
    description: 'Document Style Id as an exact decimal string',
    nullable: true,
  },
  DocumentStyle: {
    type: 'string',
    description: 'Document Style',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  OrderedAmountBeforeAdjustments: {
    type: 'string',
    description: 'Ordered Amount Before Adjustments as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  FundsStatus: {
    type: 'string',
    description: 'Funds Status',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const DRAFT_PURCHASE_ORDER_LINE_OUTPUT_PROPERTIES = {
  POLineId: {
    type: 'string',
    description: 'POLine Id as an exact decimal string',
  },
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
    nullable: true,
  },
  LineNumber: {
    type: 'string',
    description: 'Line Number as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  LineTypeId: {
    type: 'string',
    description: 'Line Type Id as an exact decimal string',
    nullable: true,
  },
  LineType: {
    type: 'string',
    description: 'Line Type',
    nullable: true,
  },
  ItemId: {
    type: 'string',
    description: 'Item Id as an exact decimal string',
    nullable: true,
  },
  Item: {
    type: 'string',
    description: 'Item',
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    nullable: true,
  },
  Quantity: {
    type: 'string',
    description: 'Quantity as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Price: {
    type: 'string',
    description: 'Price as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Amount: {
    type: 'string',
    description: 'Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  UOMCode: {
    type: 'string',
    description: 'UOMCode',
    nullable: true,
  },
  SupplierItem: {
    type: 'string',
    description: 'Supplier Item',
    nullable: true,
  },
  CategoryId: {
    type: 'string',
    description: 'Category Id as an exact decimal string',
    nullable: true,
  },
  Category: {
    type: 'string',
    description: 'Category',
    nullable: true,
  },
  CancelFlag: {
    type: 'boolean',
    description: 'Cancel Flag',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PURCHASE_ORDER_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Authoritative opaque resource key from the Oracle self link',
  },
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
  },
  OrderNumber: {
    type: 'string',
    description: 'Order Number',
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    nullable: true,
  },
  BuyerId: {
    type: 'string',
    description: 'Buyer Id as an exact decimal string',
    nullable: true,
  },
  Buyer: {
    type: 'string',
    description: 'Buyer',
    nullable: true,
  },
  ProcurementBUId: {
    type: 'string',
    description: 'Procurement BUId as an exact decimal string',
    nullable: true,
  },
  ProcurementBU: {
    type: 'string',
    description: 'Procurement BU',
    nullable: true,
  },
  RequisitioningBUId: {
    type: 'string',
    description: 'Requisitioning BUId as an exact decimal string',
    nullable: true,
  },
  SupplierId: {
    type: 'string',
    description: 'Supplier Id as an exact decimal string',
    nullable: true,
  },
  Supplier: {
    type: 'string',
    description: 'Supplier',
    nullable: true,
  },
  SupplierSiteId: {
    type: 'string',
    description: 'Supplier Site Id as an exact decimal string',
    nullable: true,
  },
  SupplierSite: {
    type: 'string',
    description: 'Supplier Site',
    nullable: true,
  },
  DocumentStyleId: {
    type: 'string',
    description: 'Document Style Id as an exact decimal string',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  Ordered: {
    type: 'string',
    description: 'Ordered as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Total: {
    type: 'string',
    description: 'Total as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Revision: {
    type: 'string',
    description: 'Revision as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  FrozenFlag: {
    type: 'boolean',
    description: 'Frozen Flag',
    nullable: true,
  },
  FundsStatus: {
    type: 'string',
    description: 'Funds Status',
    nullable: true,
  },
  OrderDate: {
    type: 'string',
    description: 'Order Date',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PURCHASE_ORDER_LINE_OUTPUT_PROPERTIES = {
  POLineId: {
    type: 'string',
    description: 'POLine Id as an exact decimal string',
  },
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
    nullable: true,
  },
  LineNumber: {
    type: 'string',
    description: 'Line Number as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  LineTypeId: {
    type: 'string',
    description: 'Line Type Id as an exact decimal string',
    nullable: true,
  },
  LineType: {
    type: 'string',
    description: 'Line Type',
    nullable: true,
  },
  ItemId: {
    type: 'string',
    description: 'Item Id as an exact decimal string',
    nullable: true,
  },
  Item: {
    type: 'string',
    description: 'Item',
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    nullable: true,
  },
  Quantity: {
    type: 'string',
    description: 'Quantity as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Price: {
    type: 'string',
    description: 'Price as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Ordered: {
    type: 'string',
    description: 'Ordered as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Total: {
    type: 'string',
    description: 'Total as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  UOMCode: {
    type: 'string',
    description: 'UOMCode',
    nullable: true,
  },
  SupplierItem: {
    type: 'string',
    description: 'Supplier Item',
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PURCHASE_ORDER_LIFECYCLE_OUTPUT_PROPERTIES = {
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
  },
  OrderNumber: {
    type: 'string',
    description: 'Order Number',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  OrderedAmount: {
    type: 'string',
    description: 'Ordered Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  DeliveredAmount: {
    type: 'string',
    description: 'Delivered Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  InReceivingAmount: {
    type: 'string',
    description: 'In Receiving Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  InTransitAmount: {
    type: 'string',
    description: 'In Transit Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  PaidAmount: {
    type: 'string',
    description: 'Paid Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  PartiallyPaidAmount: {
    type: 'string',
    description: 'Partially Paid Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  UnpaidAmount: {
    type: 'string',
    description: 'Unpaid Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  NetRetainage: {
    type: 'string',
    description: 'Net Retainage as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  Retainage: {
    type: 'string',
    description: 'Retainage as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  RetainageReleased: {
    type: 'string',
    description: 'Retainage Released as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PURCHASE_ORDER_RECEIPT_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Authoritative opaque resource key from the Oracle self link',
  },
  ReceiptId: {
    type: 'string',
    description: 'Receipt Id as an exact decimal string',
    nullable: true,
  },
  Receipt: {
    type: 'string',
    description: 'Receipt',
    nullable: true,
  },
  ReceiptDate: {
    type: 'string',
    description: 'Receipt Date',
    nullable: true,
  },
  POHeaderId: {
    type: 'string',
    description: 'POHeader Id as an exact decimal string',
    nullable: true,
  },
  POLineId: {
    type: 'string',
    description: 'POLine Id as an exact decimal string',
    nullable: true,
  },
  LineLocationId: {
    type: 'string',
    description: 'Line Location Id as an exact decimal string',
    nullable: true,
  },
  LineNumber: {
    type: 'string',
    description: 'Line Number as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  ScheduleNumber: {
    type: 'string',
    description: 'Schedule Number as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  ItemOrScheduleDescription: {
    type: 'string',
    description: 'Item Or Schedule Description',
    nullable: true,
  },
  ReceivedBy: {
    type: 'string',
    description: 'Received By',
    nullable: true,
  },
  ReceivedQuantity: {
    type: 'string',
    description: 'Received Quantity as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  DeliveredQuantity: {
    type: 'string',
    description: 'Delivered Quantity as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  ReturnedQuantity: {
    type: 'string',
    description: 'Returned Quantity as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  ReceivedAmount: {
    type: 'string',
    description: 'Received Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  DeliveredAmount: {
    type: 'string',
    description: 'Delivered Amount as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  UOMCode: {
    type: 'string',
    description: 'UOMCode',
    nullable: true,
  },
  ShipmentId: {
    type: 'string',
    description: 'Shipment Id as an exact decimal string',
    nullable: true,
  },
  ShipmentNumber: {
    type: 'string',
    description: 'Shipment Number',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Authoritative opaque resource key from the Oracle self link',
  },
  AuctionHeaderId: {
    type: 'string',
    description: 'Auction Header Id as an exact decimal string',
  },
  Negotiation: {
    type: 'string',
    description: 'Negotiation',
    nullable: true,
  },
  NegotiationTitle: {
    type: 'string',
    description: 'Negotiation Title',
    nullable: true,
  },
  NegotiationType: {
    type: 'string',
    description: 'Negotiation Type',
    nullable: true,
  },
  NegotiationTypeId: {
    type: 'string',
    description: 'Negotiation Type Id as an exact decimal string',
    nullable: true,
  },
  NegotiationStyleId: {
    type: 'string',
    description: 'Negotiation Style Id as an exact decimal string',
    nullable: true,
  },
  NegotiationStatus: {
    type: 'string',
    description: 'Negotiation Status',
    nullable: true,
  },
  NegotiationStatusCode: {
    type: 'string',
    description: 'Negotiation Status Code',
    nullable: true,
  },
  ProcurementBUId: {
    type: 'string',
    description: 'Procurement BUId as an exact decimal string',
    nullable: true,
  },
  ProcurementBU: {
    type: 'string',
    description: 'Procurement BU',
    nullable: true,
  },
  BuyerId: {
    type: 'string',
    description: 'Buyer Id as an exact decimal string',
    nullable: true,
  },
  Buyer: {
    type: 'string',
    description: 'Buyer',
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    nullable: true,
  },
  OpenDate: {
    type: 'string',
    description: 'Open Date',
    nullable: true,
  },
  CloseDate: {
    type: 'string',
    description: 'Close Date',
    nullable: true,
  },
  AwardStatus: {
    type: 'string',
    description: 'Award Status',
    nullable: true,
  },
  SuppliersCount: {
    type: 'string',
    description: 'Suppliers Count as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  SupplierResponses: {
    type: 'string',
    description: 'Supplier Responses as a decimal string, preserving framework-v9 precision',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SUPPLIER_NEGOTIATION_RESPONSE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Authoritative opaque resource key from the Oracle self link',
  },
  ResponseNumber: {
    type: 'string',
    description: 'Response Number as an exact decimal string',
  },
  AuctionHeaderId: {
    type: 'string',
    description: 'Auction Header Id as an exact decimal string',
    nullable: true,
  },
  Negotiation: {
    type: 'string',
    description: 'Negotiation',
    nullable: true,
  },
  NegotiationTitle: {
    type: 'string',
    description: 'Negotiation Title',
    nullable: true,
  },
  ResponseStatus: {
    type: 'string',
    description: 'Response Status',
    nullable: true,
  },
  ResponseStatusCode: {
    type: 'string',
    description: 'Response Status Code',
    nullable: true,
  },
  SupplierId: {
    type: 'string',
    description: 'Supplier Id as an exact decimal string',
    nullable: true,
  },
  Supplier: {
    type: 'string',
    description: 'Supplier',
    nullable: true,
  },
  SupplierSiteId: {
    type: 'string',
    description: 'Supplier Site Id as an exact decimal string',
    nullable: true,
  },
  SupplierSite: {
    type: 'string',
    description: 'Supplier Site',
    nullable: true,
  },
  ResponseDate: {
    type: 'string',
    description: 'Response Date',
    nullable: true,
  },
  ResponseAmount: {
    type: 'string',
    description: 'Response Amount',
    nullable: true,
  },
  ResponseCurrencyCode: {
    type: 'string',
    description: 'Response Currency Code',
    nullable: true,
  },
  NegotiationCurrencyCode: {
    type: 'string',
    description: 'Negotiation Currency Code',
    nullable: true,
  },
  AwardStatus: {
    type: 'string',
    description: 'Award Status',
    nullable: true,
  },
  ShortlistFlag: {
    type: 'boolean',
    description: 'Shortlist Flag',
    nullable: true,
  },
  NoteToBuyer: {
    type: 'string',
    description: 'Note To Buyer',
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCUREMENT_AGENT_OUTPUT_PROPERTIES = {
  AssignmentId: {
    type: 'string',
    description: 'Assignment Id as an exact decimal string',
  },
  AgentId: {
    type: 'string',
    description: 'Agent Id as an exact decimal string',
    nullable: true,
  },
  Agent: {
    type: 'string',
    description: 'Agent',
    nullable: true,
  },
  AgentEmail: {
    type: 'string',
    description: 'Agent Email',
    nullable: true,
  },
  ProcurementBUId: {
    type: 'string',
    description: 'Procurement BUId as an exact decimal string',
    nullable: true,
  },
  ProcurementBU: {
    type: 'string',
    description: 'Procurement BU',
    nullable: true,
  },
  DefaultRequisitioningBUId: {
    type: 'string',
    description: 'Default Requisitioning BUId as an exact decimal string',
    nullable: true,
  },
  DefaultRequisitioningBU: {
    type: 'string',
    description: 'Default Requisitioning BU',
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    nullable: true,
  },
  ManageOrdersAllowedFlag: {
    type: 'boolean',
    description: 'Manage Orders Allowed Flag',
    nullable: true,
  },
  ManageRequisitionsAllowedFlag: {
    type: 'boolean',
    description: 'Manage Requisitions Allowed Flag',
    nullable: true,
  },
  ManageSuppliersAllowedFlag: {
    type: 'boolean',
    description: 'Manage Suppliers Allowed Flag',
    nullable: true,
  },
  ManageNegotiationsAllowedFlag: {
    type: 'boolean',
    description: 'Manage Negotiations Allowed Flag',
    nullable: true,
  },
  AccessLevelToOtherAgentsOrdersCode: {
    type: 'string',
    description: 'Access Level To Other Agents Orders Code',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCUREMENT_PAGINATION_OUTPUTS = {
  count: { type: 'number', description: 'Number of records in this page' },
  hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
  limit: { type: 'number', description: 'Page size returned by Oracle' },
  offset: { type: 'number', description: 'Offset returned by Oracle' },
  totalResults: {
    type: 'number',
    description: 'Estimated total when requested and returned by Oracle',
    optional: true,
  },
  nextOffset: {
    type: 'number',
    description: 'Offset for the next page, only when hasMore is true',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCUREMENT_STRING_ACTION_OUTPUTS = {
  result: { type: 'string', description: 'Documented Oracle action result' },
  businessSuccess: {
    type: 'boolean',
    description: 'Whether Oracle explicitly reported a successful action',
  },
} as const satisfies Record<string, OutputProperty>

export const PROCUREMENT_WITHDRAW_ACTION_OUTPUTS = {
  result: {
    type: 'json',
    description:
      'Documented dynamic dictionary of arrays of string-valued objects; result.STATUS contains CODE',
  },
  businessSuccess: {
    type: 'boolean',
    description: 'Whether result.STATUS reports CODE SUCCESS',
  },
} as const satisfies Record<string, OutputProperty>

export const PROCUREMENT_VALIDATION_ACTION_OUTPUTS = {
  result: {
    type: 'array',
    description:
      'Documented validation messages as string-valued dictionaries; inspect every warning or error before submitting',
    items: { type: 'object', description: 'Oracle-defined string-valued message dictionary' },
  },
  hasMessages: {
    type: 'boolean',
    description:
      'Whether validation returned warnings or errors; false means no messages were returned',
  },
} as const satisfies Record<string, OutputProperty>

export const PROCUREMENT_NEGOTIATION_ACTION_OUTPUTS = {
  result: {
    type: 'object',
    description: 'Projected validation or publication result from the documented 26C examples',
    properties: {
      Status: { type: 'string', description: 'Oracle business status, such as SUCCESS or ERROR' },
      Message: { type: 'string', description: 'Oracle business-result message' },
      Negotiation: {
        type: 'string',
        description: 'Negotiation number, normalized to a string',
        nullable: true,
      },
      ErrorsListId: {
        type: 'string',
        description: 'Oracle validation error-list identifier',
        nullable: true,
      },
    },
  },
  businessSuccess: {
    type: 'boolean',
    description: 'Whether Oracle reported Status SUCCESS, not merely an HTTP success',
  },
} as const satisfies Record<string, OutputProperty>
