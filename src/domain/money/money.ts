import { Decimal } from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

/**
 * Value Object imutável que representa um valor monetário.
 */
export class Money {
  private static readonly AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
  private static readonly CURRENCY_PATTERN = /^[A-Z]{3}$/;

  private constructor(
    private readonly amount: Decimal,
    public readonly currency: string,
  ) {}

  /**
   * Cria Money a partir de dados recebidos externamente.
   * Valores negativos, notação científica e mais de duas
   * casas decimais não são aceitos.
   */
  static from(props: MoneyProps): Money {
    const amount = props.amount.trim();
    const currency = props.currency.trim();

    if (!Money.AMOUNT_PATTERN.test(amount)) {
      throw new Error('Invalid monetary amount');
    }

    if (!Money.CURRENCY_PATTERN.test(currency)) {
      throw new Error('Invalid currency');
    }

    const decimal = new Decimal(amount);

    if (!decimal.isFinite() || decimal.isNegative()) {
      throw new Error('Invalid monetary amount');
    }

    return new Money(decimal, currency);
  }

  static zero(currency: string): Money {
    return Money.from({
      amount: '0.00',
      currency,
    });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.amount.minus(other.amount), this.currency);
  }

  negate(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  islessThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.amount.lessThan(other.amount);
  }

  toString(): string {
    return this.amount.toFixed(2);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} and ${other.currency}`,
      );
    }
  }
}
