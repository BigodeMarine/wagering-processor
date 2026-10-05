import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  describe('from', () => {
    it('should create money from a valid amount', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      expect(money.toJSON()).toEqual({
        amount: '25.00',
        currency: 'BRL',
      });
    });

    it('should normalize valid amounts to two decimal places', () => {
      const money = Money.from({
        amount: '25',
        currency: 'BRL',
      });

      expect(money.toString()).toBe('25.00');
    });

    it('should accept one decimal place and serialize with two', () => {
      const money = Money.from({
        amount: '25.5',
        currency: 'BRL',
      });

      expect(money.toString()).toBe('25.50');
    });

    it.each([
      '',
      ' ',
      '-10.00',
      '10.001',
      '1e3',
      '1E3',
      'NaN',
      'Infinity',
      '-Infinity',
      '.50',
      '10.',
      'abc',
    ])('should reject invalid external amount "%s"', (amount) => {
      expect(() =>
        Money.from({
          amount,
          currency: 'BRL',
        }),
      ).toThrow('Invalid monetary amount');
    });

    it.each(['brl', 'BR', 'BRLL', '', '123'])(
      'should reject invalid currency "%s"',
      (currency) => {
        expect(() =>
          Money.from({
            amount: '10.00',
            currency,
          }),
        ).toThrow('Invalid currency');
      },
    );
  });

  describe('arithmetic', () => {
    it('should add money with the same currency exactly', () => {
      const first = Money.from({
        amount: '0.10',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '0.20',
        currency: 'BRL',
      });

      expect(first.add(second).toString()).toBe('0.30');
    });

    it('should subtract money with the same currency exactly', () => {
      const balance = Money.from({
        amount: '100.00',
        currency: 'BRL',
      });

      const bet = Money.from({
        amount: '80.00',
        currency: 'BRL',
      });

      expect(balance.subtract(bet).toString()).toBe('20.00');
    });

    it('should allow an internal operation to produce a negative value', () => {
      const balance = Money.from({
        amount: '20.00',
        currency: 'BRL',
      });

      const amount = Money.from({
        amount: '30.00',
        currency: 'BRL',
      });

      expect(balance.subtract(amount).toString()).toBe('-10.00');
    });

    it('should negate money', () => {
      const money = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      expect(money.negate().toString()).toBe('-10.00');
    });

    it('should reject arithmetic between different currencies', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '10.00',
        currency: 'USD',
      });

      expect(() => brl.add(usd)).toThrow('Currency mismatch');
      expect(() => brl.subtract(usd)).toThrow('Currency mismatch');
    });
  });

  describe('comparison', () => {
    it('should compare monetary values', () => {
      const ten = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const twenty = Money.from({
        amount: '20.00',
        currency: 'BRL',
      });

      expect(ten.islessThan(twenty)).toBe(true);
      expect(twenty.islessThan(ten)).toBe(false);
    });

    it('should identify zero, positive and negative values', () => {
      const zero = Money.zero('BRL');
      const positive = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });
      const negative = positive.negate();

      expect(zero.isZero()).toBe(true);
      expect(positive.isPositive()).toBe(true);
      expect(negative.isNegative()).toBe(true);
    });

    it('should reject comparisons between different currencies', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '10.00',
        currency: 'USD',
      });

      expect(() => brl.islessThan(usd)).toThrow('Currency mismatch');
    });
  });

  describe('equality', () => {
    it('should consider equal values with the same currency equal', () => {
      const first = Money.from({
        amount: '10',
        currency: 'BRL',
      });

      const second = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      expect(first.equals(second)).toBe(true);
    });

    it('should not consider different currencies equal', () => {
      const brl = Money.from({
        amount: '10.00',
        currency: 'BRL',
      });

      const usd = Money.from({
        amount: '10.00',
        currency: 'USD',
      });

      expect(brl.equals(usd)).toBe(false);
    });
  });
});