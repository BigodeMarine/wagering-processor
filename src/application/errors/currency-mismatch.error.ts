export class CurrencyMismatchError extends Error {
  constructor(
    public readonly walletCurrency: string,
    public readonly transactionCurrency: string,
  ) {
    super(
      `Transaction currency "${transactionCurrency}" does not match wallet currency "${walletCurrency}"`,
    );

    this.name = 'CurrencyMismatchError';
  }
}