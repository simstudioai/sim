import { z } from 'zod'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'

export const ORACLE_FUSION_SCM_RESOURCE_ROOT = '/fscmRestApi/resources/11.13.18.05' as const

export const ORACLE_FUSION_SCM_INVENTORY_ORGANIZATION_FIELDS = [
  'OrganizationId',
  'OrganizationCode',
  'OrganizationName',
  'Status',
  'LocationId',
  'LocationCode',
  'InventoryFlag',
  'ManufacturingPlantFlag',
  'ContractManufacturingFlag',
  'MaintenanceEnabledFlag',
  'ManagementBusinessUnitId',
  'ManagementBusinessUnitName',
  'LegalEntityId',
  'LegalEntityName',
  'ProfitCenterBusinessUnitId',
  'ProfitCenterBusinessUnitName',
  'MasterOrganizationId',
  'MasterOrganizationCode',
  'MasterOrganizationName',
] as const

export const ORACLE_FUSION_SCM_ITEM_FIELDS = [
  'ItemId',
  'OrganizationId',
  'OrganizationCode',
  'ItemNumber',
  'ItemDescription',
  'ItemClass',
  'ApprovalStatusValue',
  'ItemStatusValue',
  'LifecyclePhaseValue',
  'UserItemTypeValue',
  'PrimaryUOMValue',
  'SecondaryUOMValue',
  'InventoryItemFlag',
  'StockEnabledFlag',
  'ShippableFlag',
  'BuildInWIPFlag',
  'AssetTrackedFlag',
  'LotControlValue',
  'SerialGenerationValue',
] as const

export const ORACLE_FUSION_SCM_ON_HAND_QUANTITY_FIELDS = [
  'OrganizationId',
  'OrganizationCode',
  'InventoryItemId',
  'ItemNumber',
  'SubinventoryCode',
  'LocatorId',
  'LotNumber',
  'SerialNumber',
  'PrimaryUOMCode',
  'SecondaryUOMCode',
  'OnhandQuantity',
  'SecondaryOnhandQuantity',
  'ReceivingQuantity',
  'SecondaryReceivingQuantity',
  'ReservedQuantity',
  'SecondaryReservedQuantity',
  'InboundQuantity',
  'SecondaryInboundQuantity',
  'ConsignedQuantity',
  'SecondaryConsignedQuantity',
  'OwningOrganizationId',
  'OwningOrganization',
] as const

export const ORACLE_FUSION_SCM_INVENTORY_TRANSACTION_FIELDS = [
  'TransactionId',
  'OrganizationId',
  'Organization',
  'InventoryItemId',
  'Item',
  'ItemDescription',
  'Revision',
  'SubinventoryId',
  'SubinventoryCode',
  'SubinventoryName',
  'LocatorId',
  'Locator',
  'TransactionDate',
  'TransactionType',
  'TransactionSourceType',
  'SourceReference',
  'Reason',
  'Reference',
  'TransactionQuantity',
  'Quantity',
  'TransactionUOM',
  'TransactionUOMCode',
  'PrimaryUOMCode',
  'SecondaryQuantity',
  'SecondaryUOMCode',
  'TransferOrganizationId',
  'TransferOrganizationCode',
  'TransferOrganization',
  'TransferSubinventoryCode',
] as const

export const ORACLE_FUSION_SCM_SUPPLY_REQUEST_FIELDS = [
  'InterfaceBatchNumber',
  'InterfaceSourceCode',
  'SupplyOrderReferenceId',
  'SupplyOrderReferenceNumber',
  'SupplyOrderSource',
  'SupplyRequestDate',
  'SupplyRequestStatus',
  'SupplyOrderNumber',
  'SupplyOrderStatus',
  'AllowPartialRequestFlag',
  'ProcessRequestFlag',
  'TrustedSource',
] as const

export const ORACLE_FUSION_SCM_SUPPLY_ORDER_LINE_FIELDS = [
  'SupplyLineId',
  'SupplyOrderHeaderId',
  'SupplyLineNumber',
  'SupplyLineStatus',
  'SupplyType',
  'ItemId',
  'ItemNumber',
  'ItemDescription',
  'ItemRevision',
  'SupplyOrderReferenceLineId',
  'SupplyOrderReferenceLineNumber',
  'Quantity',
  'UOMCode',
  'UOMName',
  'NeedByDate',
  'DestinationOrganizationId',
  'DestinationOrganizationCode',
  'DestinationOrganizationName',
] as const

export const ORACLE_FUSION_SCM_SHIPMENT_FIELDS = [
  'DeliveryId',
  'Shipment',
  'ShipmentDescription',
  'ShipmentStatus',
  'ShipmentStatusCode',
  'OrganizationId',
  'OrganizationCode',
  'OrganizationName',
  'InitialPickupDate',
  'ActualShipDate',
  'ActualShipDateTime',
  'ActualDeliveryDate',
  'Carrier',
  'ShippingMethod',
  'ServiceLevel',
  'ModeOfTransport',
  'BillOfLading',
  'Waybill',
  'GrossWeight',
  'NetWeight',
  'WeightUOMCode',
  'Volume',
  'VolumeUOMCode',
  'ShipToCustomer',
  'ShipToCustomerNumber',
  'ShipToLocation',
  'OpenExceptionSeverity',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_SCM_SHIPMENT_LINE_FIELDS = [
  'ShipmentLine',
  'Shipment',
  'ShipmentId',
  'OrderTypeCode',
  'OrderType',
  'Order',
  'OrderLine',
  'OrderSchedule',
  'SourceOrder',
  'SourceOrderLine',
  'SourceOrderFulfillmentLine',
  'SourceOrderFulfillmentLineId',
  'InventoryItemId',
  'Item',
  'ItemDescription',
  'Revision',
  'OrganizationId',
  'OrganizationCode',
  'OrganizationName',
  'SourceSubinventory',
  'DestinationOrganizationCode',
  'DestinationSubinventory',
  'RequestedQuantity',
  'RequestedQuantityUOMCode',
  'PendingQuantity',
  'PickedQuantity',
  'StagedQuantity',
  'ShippedQuantity',
  'DeliveredQuantity',
  'BackorderedQuantity',
  'CancelledQuantity',
  'LineStatus',
  'LineStatusCode',
  'ScheduledShipDate',
  'IntegrationStatus',
  'IntegrationStatusCode',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_SCM_MANUFACTURING_WORK_ORDER_FIELDS = [
  'WorkOrderId',
  'WorkOrderNumber',
  'WorkOrderDescription',
  'WorkOrderStatusId',
  'WorkOrderStatusName',
  'WorkOrderStatusCode',
  'WorkOrderSystemStatusCode',
  'WorkOrderType',
  'WorkOrderTypeDescription',
  'WorkOrderSubType',
  'WorkOrderSubTypeDescription',
  'OrganizationId',
  'OrganizationCode',
  'OrganizationName',
  'InventoryItemId',
  'ItemNumber',
  'Description',
  'PlannedStartQuantity',
  'CompletedQuantity',
  'ScrappedQuantity',
  'RejectedQuantity',
  'UOMCode',
  'UnitOfMeasure',
  'PlannedStartDate',
  'PlannedCompletionDate',
  'ActualStartDate',
  'ActualCompletionDate',
  'WorkDefinitionId',
  'WorkDefinitionCode',
  'WorkDefinitionName',
  'SerialTrackingFlag',
  'SupplyType',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_SCM_MAINTENANCE_WORK_ORDER_FIELDS = [
  'WorkOrderId',
  'WorkOrderNumber',
  'WorkOrderDescription',
  'WorkOrderStatus',
  'WorkOrderStatusCode',
  'WorkOrderStatusId',
  'WorkOrderType',
  'WorkOrderTypeCode',
  'WorkOrderSubType',
  'WorkOrderSubTypeCode',
  'WorkOrderPriority',
  'OrganizationId',
  'OrganizationCode',
  'AssetId',
  'AssetNumber',
  'AssetDescription',
  'InventoryItemId',
  'ItemNumber',
  'ItemDescription',
  'PlannedStartQuantity',
  'UOMCode',
  'UnitOfMeasure',
  'PlannedStartDate',
  'PlannedCompletionDate',
  'ActualStartDate',
  'ActualCompletionDate',
  'MntWorkDefinitionCode',
  'MntWorkDefinitionName',
  'MaintenanceProgramId',
  'MaintenanceProgramCode',
  'MaintenanceProgramName',
  'WarrantyRepairFlag',
  'ReleasedDate',
] as const

const oracleText = z.string().nullable().optional()
const oracleNumber = z.number().finite().nullable().optional()
const oracleBoolean = z.boolean().nullable().optional()
const linkSchema = z
  .object({ rel: z.string().optional(), href: z.string().optional() })
  .passthrough()
const linksShape = { links: z.array(linkSchema).optional() }
const MAX_IDENTIFIER_DIGITS = 128

/** Keeps Oracle identifiers lossless while sharing Fusion's decimal-token normalization. */
export function normalizeOracleFusionScmIdentifier(value: unknown): string | undefined {
  return normalizeOracleFusionDecimalIdentifier(value, { maxDigits: MAX_IDENTIFIER_DIGITS })
}

const oracleIdentifier = z.preprocess((value) => {
  if (value === undefined || value === null) return value
  return normalizeOracleFusionScmIdentifier(value) ?? value
}, z.string().regex(/^\d+$/).max(MAX_IDENTIFIER_DIGITS).nullable().optional())

function resourceSchema(shape: Record<string, z.ZodTypeAny>) {
  return z.object({ ...shape, ...linksShape }).passthrough()
}

export const oracleFusionScmInventoryOrganizationSchema = resourceSchema({
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  OrganizationName: oracleText,
  Status: oracleText,
  LocationId: oracleIdentifier,
  LocationCode: oracleText,
  InventoryFlag: oracleBoolean,
  ManufacturingPlantFlag: oracleBoolean,
  ContractManufacturingFlag: oracleBoolean,
  MaintenanceEnabledFlag: oracleBoolean,
  ManagementBusinessUnitId: oracleIdentifier,
  ManagementBusinessUnitName: oracleText,
  LegalEntityId: oracleIdentifier,
  LegalEntityName: oracleText,
  ProfitCenterBusinessUnitId: oracleIdentifier,
  ProfitCenterBusinessUnitName: oracleText,
  MasterOrganizationId: oracleIdentifier,
  MasterOrganizationCode: oracleText,
  MasterOrganizationName: oracleText,
})

export const oracleFusionScmItemSchema = resourceSchema({
  ItemId: oracleIdentifier,
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  ItemNumber: oracleText,
  ItemDescription: oracleText,
  ItemClass: oracleText,
  ApprovalStatusValue: oracleText,
  ItemStatusValue: oracleText,
  LifecyclePhaseValue: oracleText,
  UserItemTypeValue: oracleText,
  PrimaryUOMValue: oracleText,
  SecondaryUOMValue: oracleText,
  InventoryItemFlag: oracleBoolean,
  StockEnabledFlag: oracleBoolean,
  ShippableFlag: oracleBoolean,
  BuildInWIPFlag: oracleBoolean,
  AssetTrackedFlag: oracleBoolean,
  LotControlValue: oracleText,
  SerialGenerationValue: oracleText,
})

export const oracleFusionScmOnHandQuantitySchema = resourceSchema({
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  InventoryItemId: oracleIdentifier,
  ItemNumber: oracleText,
  SubinventoryCode: oracleText,
  LocatorId: oracleIdentifier,
  LotNumber: oracleText,
  SerialNumber: oracleText,
  PrimaryUOMCode: oracleText,
  SecondaryUOMCode: oracleText,
  OnhandQuantity: oracleNumber,
  SecondaryOnhandQuantity: oracleNumber,
  ReceivingQuantity: oracleNumber,
  SecondaryReceivingQuantity: oracleNumber,
  ReservedQuantity: oracleNumber,
  SecondaryReservedQuantity: oracleNumber,
  InboundQuantity: oracleNumber,
  SecondaryInboundQuantity: oracleNumber,
  ConsignedQuantity: oracleNumber,
  SecondaryConsignedQuantity: oracleNumber,
  OwningOrganizationId: oracleIdentifier,
  OwningOrganization: oracleText,
})

export const oracleFusionScmInventoryTransactionSchema = resourceSchema({
  TransactionId: oracleIdentifier,
  OrganizationId: oracleIdentifier,
  Organization: oracleText,
  InventoryItemId: oracleIdentifier,
  Item: oracleText,
  ItemDescription: oracleText,
  Revision: oracleText,
  SubinventoryId: oracleIdentifier,
  SubinventoryCode: oracleText,
  SubinventoryName: oracleText,
  LocatorId: oracleIdentifier,
  Locator: oracleText,
  TransactionDate: oracleText,
  TransactionType: oracleText,
  TransactionSourceType: oracleText,
  SourceReference: oracleText,
  Reason: oracleText,
  Reference: oracleText,
  TransactionQuantity: oracleNumber,
  Quantity: oracleNumber,
  TransactionUOM: oracleText,
  TransactionUOMCode: oracleText,
  PrimaryUOMCode: oracleText,
  SecondaryQuantity: oracleNumber,
  SecondaryUOMCode: oracleText,
  TransferOrganizationId: oracleIdentifier,
  TransferOrganizationCode: oracleText,
  TransferOrganization: oracleText,
  TransferSubinventoryCode: oracleText,
})

export const oracleFusionScmSupplyRequestSchema = resourceSchema({
  InterfaceBatchNumber: oracleText,
  InterfaceSourceCode: oracleText,
  SupplyOrderReferenceId: oracleIdentifier,
  SupplyOrderReferenceNumber: oracleText,
  SupplyOrderSource: oracleText,
  SupplyRequestDate: oracleText,
  SupplyRequestStatus: oracleText,
  SupplyOrderNumber: oracleText,
  SupplyOrderStatus: oracleText,
  AllowPartialRequestFlag: oracleBoolean,
  ProcessRequestFlag: oracleBoolean,
  TrustedSource: oracleIdentifier,
})

export const oracleFusionScmSupplyOrderLineSchema = resourceSchema({
  SupplyLineId: oracleIdentifier,
  SupplyOrderHeaderId: oracleIdentifier,
  SupplyLineNumber: oracleIdentifier,
  SupplyLineStatus: oracleText,
  SupplyType: oracleText,
  ItemId: oracleIdentifier,
  ItemNumber: oracleText,
  ItemDescription: oracleText,
  ItemRevision: oracleText,
  SupplyOrderReferenceLineId: oracleIdentifier,
  SupplyOrderReferenceLineNumber: oracleText,
  Quantity: oracleNumber,
  UOMCode: oracleText,
  UOMName: oracleText,
  NeedByDate: oracleText,
  DestinationOrganizationId: oracleIdentifier,
  DestinationOrganizationCode: oracleText,
  DestinationOrganizationName: oracleText,
})

export const oracleFusionScmShipmentSchema = resourceSchema({
  DeliveryId: oracleIdentifier,
  Shipment: oracleText,
  ShipmentDescription: oracleText,
  ShipmentStatus: oracleText,
  ShipmentStatusCode: oracleText,
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  OrganizationName: oracleText,
  InitialPickupDate: oracleText,
  ActualShipDate: oracleText,
  ActualShipDateTime: oracleText,
  ActualDeliveryDate: oracleText,
  Carrier: oracleText,
  ShippingMethod: oracleText,
  ServiceLevel: oracleText,
  ModeOfTransport: oracleText,
  BillOfLading: oracleText,
  Waybill: oracleText,
  GrossWeight: oracleNumber,
  NetWeight: oracleNumber,
  WeightUOMCode: oracleText,
  Volume: oracleNumber,
  VolumeUOMCode: oracleText,
  ShipToCustomer: oracleText,
  ShipToCustomerNumber: oracleText,
  ShipToLocation: oracleText,
  OpenExceptionSeverity: oracleText,
  LastUpdateDate: oracleText,
})

export const oracleFusionScmShipmentLineSchema = resourceSchema({
  ShipmentLine: oracleIdentifier,
  Shipment: oracleText,
  ShipmentId: oracleIdentifier,
  OrderTypeCode: oracleText,
  OrderType: oracleText,
  Order: oracleText,
  OrderLine: oracleText,
  OrderSchedule: oracleText,
  SourceOrder: oracleText,
  SourceOrderLine: oracleText,
  SourceOrderFulfillmentLine: oracleText,
  SourceOrderFulfillmentLineId: oracleIdentifier,
  InventoryItemId: oracleIdentifier,
  Item: oracleText,
  ItemDescription: oracleText,
  Revision: oracleText,
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  OrganizationName: oracleText,
  SourceSubinventory: oracleText,
  DestinationOrganizationCode: oracleText,
  DestinationSubinventory: oracleText,
  RequestedQuantity: oracleNumber,
  RequestedQuantityUOMCode: oracleText,
  PendingQuantity: oracleNumber,
  PickedQuantity: oracleNumber,
  StagedQuantity: oracleNumber,
  ShippedQuantity: oracleNumber,
  DeliveredQuantity: oracleNumber,
  BackorderedQuantity: oracleNumber,
  CancelledQuantity: oracleNumber,
  LineStatus: oracleText,
  LineStatusCode: oracleText,
  ScheduledShipDate: oracleText,
  IntegrationStatus: oracleText,
  IntegrationStatusCode: oracleText,
  LastUpdateDate: oracleText,
})

export const oracleFusionScmManufacturingWorkOrderSchema = resourceSchema({
  WorkOrderId: oracleIdentifier,
  WorkOrderNumber: oracleText,
  WorkOrderDescription: oracleText,
  WorkOrderStatusId: oracleIdentifier,
  WorkOrderStatusName: oracleText,
  WorkOrderStatusCode: oracleText,
  WorkOrderSystemStatusCode: oracleText,
  WorkOrderType: oracleText,
  WorkOrderTypeDescription: oracleText,
  WorkOrderSubType: oracleText,
  WorkOrderSubTypeDescription: oracleText,
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  OrganizationName: oracleText,
  InventoryItemId: oracleIdentifier,
  ItemNumber: oracleText,
  Description: oracleText,
  PlannedStartQuantity: oracleNumber,
  CompletedQuantity: oracleNumber,
  ScrappedQuantity: oracleNumber,
  RejectedQuantity: oracleNumber,
  UOMCode: oracleText,
  UnitOfMeasure: oracleText,
  PlannedStartDate: oracleText,
  PlannedCompletionDate: oracleText,
  ActualStartDate: oracleText,
  ActualCompletionDate: oracleText,
  WorkDefinitionId: oracleIdentifier,
  WorkDefinitionCode: oracleText,
  WorkDefinitionName: oracleText,
  SerialTrackingFlag: oracleBoolean,
  SupplyType: oracleText,
  LastUpdateDate: oracleText,
})

export const oracleFusionScmMaintenanceWorkOrderSchema = resourceSchema({
  WorkOrderId: oracleIdentifier,
  WorkOrderNumber: oracleText,
  WorkOrderDescription: oracleText,
  WorkOrderStatus: oracleText,
  WorkOrderStatusCode: oracleText,
  WorkOrderStatusId: oracleIdentifier,
  WorkOrderType: oracleText,
  WorkOrderTypeCode: oracleText,
  WorkOrderSubType: oracleText,
  WorkOrderSubTypeCode: oracleText,
  WorkOrderPriority: oracleNumber,
  OrganizationId: oracleIdentifier,
  OrganizationCode: oracleText,
  AssetId: oracleIdentifier,
  AssetNumber: oracleText,
  AssetDescription: oracleText,
  InventoryItemId: oracleIdentifier,
  ItemNumber: oracleText,
  ItemDescription: oracleText,
  PlannedStartQuantity: oracleNumber,
  UOMCode: oracleText,
  UnitOfMeasure: oracleText,
  PlannedStartDate: oracleText,
  PlannedCompletionDate: oracleText,
  ActualStartDate: oracleText,
  ActualCompletionDate: oracleText,
  MntWorkDefinitionCode: oracleText,
  MntWorkDefinitionName: oracleText,
  MaintenanceProgramId: oracleIdentifier,
  MaintenanceProgramCode: oracleText,
  MaintenanceProgramName: oracleText,
  WarrantyRepairFlag: oracleBoolean,
  ReleasedDate: oracleText,
})

export const ORACLE_FUSION_SCM_TRANSFER_ORDER_FIELDS = [
  'HeaderId',
  'HeaderNumber',
  'Description',
  'Status',
  'SourceTypeLookup',
  'SourceOfTransferOrder',
  'BusinessUnitName',
  'OrderedDate',
  'InterfaceStatus',
  'MessageText',
  'TotalPrice',
  'TotalTax',
  'TotalTransferPrice',
  'LastUpdateDate',
] as const

export const oracleFusionScmTransferOrderSchema = resourceSchema({
  HeaderId: oracleIdentifier,
  HeaderNumber: oracleText,
  Description: oracleText,
  Status: oracleText,
  SourceTypeLookup: oracleText,
  SourceOfTransferOrder: oracleText,
  BusinessUnitName: oracleText,
  OrderedDate: oracleText,
  InterfaceStatus: oracleText,
  MessageText: oracleText,
  TotalPrice: oracleNumber,
  TotalTax: oracleNumber,
  TotalTransferPrice: oracleNumber,
  LastUpdateDate: oracleText,
})

export const ORACLE_FUSION_SCM_TRANSFER_ORDER_LINE_FIELDS = [
  'HeaderId',
  'HeaderNumber',
  'LineId',
  'LineNumber',
  'ItemNumber',
  'ItemDescription',
  'InventoryItemId',
  'TransferOrderLineStatus',
  'StatusLookup',
  'RequestedQuantity',
  'ShippedQuantity',
  'ReceivedQuantity',
  'DeliveredQuantity',
  'UnshippedQuantity',
  'QuantityUOMCode',
  'NeedByDate',
  'ScheduledShipDate',
  'SourceOrganizationId',
  'SourceOrganizationCode',
  'SourceSubinventoryCode',
  'DestinationOrganizationId',
  'DestinationOrganizationCode',
  'DestinationSubinventoryCode',
  'Comments',
  'InterfaceErrMsgCode',
  'InterfaceErrMsgText',
] as const

export const oracleFusionScmTransferOrderLineSchema = resourceSchema({
  HeaderId: oracleIdentifier,
  HeaderNumber: oracleText,
  LineId: oracleIdentifier,
  LineNumber: oracleIdentifier,
  ItemNumber: oracleText,
  ItemDescription: oracleText,
  InventoryItemId: oracleIdentifier,
  TransferOrderLineStatus: oracleText,
  StatusLookup: oracleText,
  RequestedQuantity: oracleNumber,
  ShippedQuantity: oracleNumber,
  ReceivedQuantity: oracleNumber,
  DeliveredQuantity: oracleNumber,
  UnshippedQuantity: oracleNumber,
  QuantityUOMCode: oracleText,
  NeedByDate: oracleText,
  ScheduledShipDate: oracleText,
  SourceOrganizationId: oracleIdentifier,
  SourceOrganizationCode: oracleText,
  SourceSubinventoryCode: oracleText,
  DestinationOrganizationId: oracleIdentifier,
  DestinationOrganizationCode: oracleText,
  DestinationSubinventoryCode: oracleText,
  Comments: oracleText,
  InterfaceErrMsgCode: oracleText,
  InterfaceErrMsgText: oracleText,
})

export const ORACLE_FUSION_SCM_SALES_ORDER_FIELDS = [
  'OrderKey',
  'HeaderId',
  'OrderNumber',
  'BusinessUnitId',
  'BusinessUnitName',
  'SourceTransactionId',
  'SourceTransactionNumber',
  'SourceTransactionSystem',
  'SourceTransactionRevisionNumber',
  'BuyingPartyId',
  'BuyingPartyName',
  'CustomerPONumber',
  'Status',
  'StatusCode',
  'SubmittedFlag',
  'SubmittedDate',
  'CanceledFlag',
  'OpenFlag',
  'OnHoldFlag',
  'TransactionOn',
  'TransactionalCurrencyCode',
  'RequestedShipDate',
  'RequestedArrivalDate',
  'Comments',
  'LastUpdateDate',
] as const

export const oracleFusionScmSalesOrderSchema = resourceSchema({
  OrderKey: oracleText,
  HeaderId: oracleIdentifier,
  OrderNumber: oracleText,
  BusinessUnitId: oracleIdentifier,
  BusinessUnitName: oracleText,
  SourceTransactionId: oracleText,
  SourceTransactionNumber: oracleText,
  SourceTransactionSystem: oracleText,
  SourceTransactionRevisionNumber: oracleIdentifier,
  BuyingPartyId: oracleIdentifier,
  BuyingPartyName: oracleText,
  CustomerPONumber: oracleText,
  Status: oracleText,
  StatusCode: oracleText,
  SubmittedFlag: oracleBoolean,
  SubmittedDate: oracleText,
  CanceledFlag: oracleBoolean,
  OpenFlag: oracleBoolean,
  OnHoldFlag: oracleBoolean,
  TransactionOn: oracleText,
  TransactionalCurrencyCode: oracleText,
  RequestedShipDate: oracleText,
  RequestedArrivalDate: oracleText,
  Comments: oracleText,
  LastUpdateDate: oracleText,
})

export const ORACLE_FUSION_SCM_SALES_ORDER_LINE_FIELDS = [
  'FulfillLineId',
  'LineId',
  'HeaderId',
  'LineNumber',
  'FulfillLineNumber',
  'SourceTransactionLineId',
  'SourceTransactionLineNumber',
  'SourceTransactionScheduleId',
  'SourceScheduleNumber',
  'ProductId',
  'ProductNumber',
  'ProductDescription',
  'OrderedQuantity',
  'OrderedUOMCode',
  'FulfilledQuantity',
  'CanceledQuantity',
  'ShippedQuantity',
  'Status',
  'StatusCode',
  'ScheduleShipDate',
  'ScheduleArrivalDate',
  'ActualShipDate',
  'CanceledFlag',
  'OpenFlag',
  'OnHoldFlag',
  'LastUpdateDate',
] as const

export const oracleFusionScmSalesOrderLineSchema = resourceSchema({
  FulfillLineId: oracleIdentifier,
  LineId: oracleIdentifier,
  HeaderId: oracleIdentifier,
  LineNumber: oracleIdentifier,
  FulfillLineNumber: oracleText,
  SourceTransactionLineId: oracleText,
  SourceTransactionLineNumber: oracleText,
  SourceTransactionScheduleId: oracleText,
  SourceScheduleNumber: oracleText,
  ProductId: oracleIdentifier,
  ProductNumber: oracleText,
  ProductDescription: oracleText,
  OrderedQuantity: oracleNumber,
  OrderedUOMCode: oracleText,
  FulfilledQuantity: oracleNumber,
  CanceledQuantity: oracleNumber,
  ShippedQuantity: oracleNumber,
  Status: oracleText,
  StatusCode: oracleText,
  ScheduleShipDate: oracleText,
  ScheduleArrivalDate: oracleText,
  ActualShipDate: oracleText,
  CanceledFlag: oracleBoolean,
  OpenFlag: oracleBoolean,
  OnHoldFlag: oracleBoolean,
  LastUpdateDate: oracleText,
})

export const ORACLE_FUSION_SCM_FULFILLMENT_LINE_DETAIL_FIELDS = [
  'FulfillLineDetailId',
  'TaskType',
  'Status',
  'StatusCode',
  'StatusAsOfDate',
  'Quantity',
  'SecondaryQuantity',
  'DeliveryName',
  'ActualDeliveryDate',
  'TrackingNumber',
  'WaybillNumber',
  'BillOfLadingNumber',
  'BillingTransactionNumber',
  'BillingTransactionDate',
  'BillingTransactionAmount',
  'ExceptionFlag',
  'TradeComplianceResultCode',
] as const

export const oracleFusionScmFulfillmentLineDetailSchema = resourceSchema({
  FulfillLineDetailId: oracleIdentifier,
  TaskType: oracleText,
  Status: oracleText,
  StatusCode: oracleText,
  StatusAsOfDate: oracleText,
  Quantity: oracleNumber,
  SecondaryQuantity: oracleNumber,
  DeliveryName: oracleText,
  ActualDeliveryDate: oracleText,
  TrackingNumber: oracleText,
  WaybillNumber: oracleText,
  BillOfLadingNumber: oracleText,
  BillingTransactionNumber: oracleText,
  BillingTransactionDate: oracleText,
  BillingTransactionAmount: oracleNumber,
  ExceptionFlag: oracleBoolean,
  TradeComplianceResultCode: oracleText,
})

export const oracleFusionScmResourceSchemas = {
  fulfillmentLineDetails: oracleFusionScmFulfillmentLineDetailSchema,
  salesOrderLines: oracleFusionScmSalesOrderLineSchema,
  salesOrders: oracleFusionScmSalesOrderSchema,
  transferOrderLines: oracleFusionScmTransferOrderLineSchema,
  transferOrders: oracleFusionScmTransferOrderSchema,
  inventoryOrganizations: oracleFusionScmInventoryOrganizationSchema,
  items: oracleFusionScmItemSchema,
  onHandQuantities: oracleFusionScmOnHandQuantitySchema,
  inventoryTransactions: oracleFusionScmInventoryTransactionSchema,
  supplyRequests: oracleFusionScmSupplyRequestSchema,
  supplyOrderLines: oracleFusionScmSupplyOrderLineSchema,
  shipments: oracleFusionScmShipmentSchema,
  shipmentLines: oracleFusionScmShipmentLineSchema,
  manufacturingWorkOrders: oracleFusionScmManufacturingWorkOrderSchema,
  maintenanceWorkOrders: oracleFusionScmMaintenanceWorkOrderSchema,
} as const

export type OracleFusionScmResource = keyof typeof oracleFusionScmResourceSchemas

export const oracleFusionScmResourceFields = {
  fulfillmentLineDetails: ORACLE_FUSION_SCM_FULFILLMENT_LINE_DETAIL_FIELDS,
  salesOrderLines: ORACLE_FUSION_SCM_SALES_ORDER_LINE_FIELDS,
  salesOrders: ORACLE_FUSION_SCM_SALES_ORDER_FIELDS,
  transferOrderLines: ORACLE_FUSION_SCM_TRANSFER_ORDER_LINE_FIELDS,
  transferOrders: ORACLE_FUSION_SCM_TRANSFER_ORDER_FIELDS,
  inventoryOrganizations: ORACLE_FUSION_SCM_INVENTORY_ORGANIZATION_FIELDS,
  items: ORACLE_FUSION_SCM_ITEM_FIELDS,
  onHandQuantities: ORACLE_FUSION_SCM_ON_HAND_QUANTITY_FIELDS,
  inventoryTransactions: ORACLE_FUSION_SCM_INVENTORY_TRANSACTION_FIELDS,
  supplyRequests: ORACLE_FUSION_SCM_SUPPLY_REQUEST_FIELDS,
  supplyOrderLines: ORACLE_FUSION_SCM_SUPPLY_ORDER_LINE_FIELDS,
  shipments: ORACLE_FUSION_SCM_SHIPMENT_FIELDS,
  shipmentLines: ORACLE_FUSION_SCM_SHIPMENT_LINE_FIELDS,
  manufacturingWorkOrders: ORACLE_FUSION_SCM_MANUFACTURING_WORK_ORDER_FIELDS,
  maintenanceWorkOrders: ORACLE_FUSION_SCM_MAINTENANCE_WORK_ORDER_FIELDS,
} as const satisfies Record<OracleFusionScmResource, readonly string[]>

const optionalExpression = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      'Expression contains control characters'
    )
    .optional()

export const oracleFusionScmAuthShape = {
  oauthCredential: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  instanceUrl: z
    .string()
    .trim()
    .refine((value) => normalizeOracleFusionApplicationOrigin(value)),
}

export const oracleFusionScmOpaqueKeySchema = z.string().refine((value) => {
  try {
    encodeOracleFusionPathSegment(value)
    return true
  } catch {
    return false
  }
}, 'Oracle opaque key must be one safe URL path segment')

const listShape = {
  q: optionalExpression(2_048),
  orderBy: optionalExpression(1_024),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().safe().nonnegative().default(0),
  totalResults: z.boolean().default(false),
}

export interface OracleFusionScmAuthInput {
  accessToken: string
  instanceUrl: string
}

export interface OracleFusionScmListInput extends OracleFusionScmAuthInput {
  q?: string
  finder?: string
  orderBy?: string
  limit: number
  offset: number
  totalResults: boolean
  supplyRequestKey?: string
  transferOrderKey?: string
  salesOrderKey?: string
  salesOrderLineKey?: string
}

export interface OracleFusionScmDetailInput extends OracleFusionScmAuthInput {
  key: string
  supplyRequestKey?: string
  transferOrderKey?: string
  salesOrderKey?: string
  salesOrderLineKey?: string
}

export function parseOracleFusionScmListInput(
  value: unknown,
  options: { finder: boolean; parentKeys?: readonly string[] }
): OracleFusionScmListInput {
  const parentShape = Object.fromEntries(
    (options.parentKeys ?? []).map((key) => [key, oracleFusionScmOpaqueKeySchema])
  )
  const schema = z
    .object({
      ...oracleFusionScmAuthShape,
      ...listShape,
      ...(options.finder ? { finder: optionalExpression(2_048) } : {}),
      ...parentShape,
    })
    .strict()
    .superRefine((input, context) => {
      if ('finder' in input && input.q && input.finder) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['finder'],
          message: 'q and finder cannot be used together',
        })
      }
    })
  const parsed = schema.parse(value) as {
    accessToken: string
    instanceUrl: string
    q?: string
    finder?: string
    orderBy?: string
    limit: number
    offset: number
    totalResults: boolean
  } & Record<string, unknown>
  return {
    accessToken: parsed.accessToken,
    instanceUrl: parsed.instanceUrl,
    q: parsed.q,
    ...(options.finder ? { finder: parsed.finder } : {}),
    orderBy: parsed.orderBy,
    limit: parsed.limit,
    offset: parsed.offset,
    totalResults: parsed.totalResults,
    ...Object.fromEntries((options.parentKeys ?? []).map((key) => [key, parsed[key] as string])),
  }
}

export function parseOracleFusionScmDetailInput(
  value: unknown,
  keyParam: string,
  parentKeys: readonly string[] = []
): OracleFusionScmDetailInput {
  const schema = z
    .object({
      ...oracleFusionScmAuthShape,
      [keyParam]: oracleFusionScmOpaqueKeySchema,
      ...Object.fromEntries(parentKeys.map((key) => [key, oracleFusionScmOpaqueKeySchema])),
    })
    .strict()
  const parsed = schema.parse(value) as {
    accessToken: string
    instanceUrl: string
  } & Record<string, unknown>
  return {
    accessToken: parsed.accessToken,
    instanceUrl: parsed.instanceUrl,
    key: parsed[keyParam] as string,
    ...Object.fromEntries(parentKeys.map((key) => [key, parsed[key] as string])),
  }
}

export function parseOracleFusionScmResource(
  resource: OracleFusionScmResource,
  value: unknown
): Record<string, unknown> {
  return oracleFusionScmResourceSchemas[resource].parse(value)
}

/** Returns every fixed provider field, converting omissions to explicit nulls. */
export function projectOracleFusionScmFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, value[field] ?? null]))
}

/** Admits bounded editor JSON before parsing; integer request fields must remain decimal strings. */
export function parseOracleFusionScmBody(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (Buffer.byteLength(value, 'utf8') > MAX_INLINE_MATERIALIZATION_BYTES) {
    throw new z.ZodError([
      { code: 'custom', path: ['body'], message: 'Body exceeds the inline materialization limit' },
    ])
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new z.ZodError([{ code: 'custom', path: ['body'], message: 'Body must be valid JSON' }])
  }
}

/** Numeric Oracle request fields accept decimal strings and become exact numbers only on the server. */
export function oracleFusionScmIntegerInput(format: 'int32' | 'int64' = 'int64') {
  return z
    .string()
    .max(format === 'int32' ? 10 : 19)
    .refine(
      (value) =>
        value === value.trim() &&
        /^(0|[1-9][0-9]*)$/.test(value) &&
        BigInt(value) <= (format === 'int32' ? 2147483647n : 9223372036854775807n),
      'Integer must be a canonical decimal string within the documented Oracle range'
    )
    .transform(oracleFusionExactInteger)
}

/** Validates the selected write's body and keys after trusted credential injection. */
export function oracleFusionScmMutationInputSchema<
  Body extends z.ZodTypeAny,
  const Key extends string = never,
>(bodySchema: Body, keys: readonly Key[] = []) {
  const keyShape = Object.fromEntries(
    keys.map((key) => [key, oracleFusionScmOpaqueKeySchema])
  ) as Record<Key, typeof oracleFusionScmOpaqueKeySchema>
  return z
    .object({
      ...oracleFusionScmAuthShape,
      ...keyShape,
      body: z.preprocess(parseOracleFusionScmBody, bodySchema),
    })
    .strict()
}
