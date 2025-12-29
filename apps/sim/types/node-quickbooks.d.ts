declare module 'node-quickbooks' {
  class QuickBooks {
    constructor(
      consumerKey: string,
      consumerSecret: string,
      accessToken: string,
      accessTokenSecret: string,
      realmId: string,
      useSandbox: boolean,
      debug?: boolean,
      minorVersion?: number,
      oauthVersion?: string,
      refreshToken?: string
    )

    createAccount(account: any, callback: (err: any, data: any) => void): void
    createBill(bill: any, callback: (err: any, data: any) => void): void
    createBillPayment(billPayment: any, callback: (err: any, data: any) => void): void
    createCustomer(customer: any, callback: (err: any, data: any) => void): void
    createEstimate(estimate: any, callback: (err: any, data: any) => void): void
    createPurchase(purchase: any, callback: (err: any, data: any) => void): void
    createInvoice(invoice: any, callback: (err: any, data: any) => void): void
    createPayment(payment: any, callback: (err: any, data: any) => void): void
    createVendor(vendor: any, callback: (err: any, data: any) => void): void
    findAccounts(criteria: any, callback: (err: any, data: any) => void): void
    findBills(criteria: any, callback: (err: any, data: any) => void): void
    findCustomers(criteria: any, callback: (err: any, data: any) => void): void
    findInvoices(criteria: any, callback: (err: any, data: any) => void): void
    findPayments(criteria: any, callback: (err: any, data: any) => void): void
    findPurchases(criteria: any, callback: (err: any, data: any) => void): void
    findVendors(criteria: any, callback: (err: any, data: any) => void): void
    getBill(billId: string, callback: (err: any, data: any) => void): void
    getCompanyInfo(realmId: string, callback: (err: any, data: any) => void): void
    getCustomer(customerId: string, callback: (err: any, data: any) => void): void
    getInvoice(invoiceId: string, callback: (err: any, data: any) => void): void
    getPurchase(purchaseId: string, callback: (err: any, data: any) => void): void
    getVendor(vendorId: string, callback: (err: any, data: any) => void): void
    updatePurchase(purchase: any, callback: (err: any, data: any) => void): void
    reportBalanceSheet(options: any, callback: (err: any, data: any) => void): void
    reportCashFlow(options: any, callback: (err: any, data: any) => void): void
    reportProfitAndLoss(options: any, callback: (err: any, data: any) => void): void
  }

  export = QuickBooks
}
