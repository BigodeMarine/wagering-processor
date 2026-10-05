import { describe, expect, it } from 'vitest';

import { Money } from '../../domain/money/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';
import { WalletMapper } from './wallet.mapper.js';

describe('WalletMapper', () => {
  it('should convert WalletEntity to Wallet domain', () => {
    const entity = new WalletEntity();

    entity.id = '0192f291-27dd-7d3f-8071-5f8685deef37';
    entity.playerId = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
    entity.currency = 'BRL';
    entity.balance = '100.10';
    entity.version = 3;
    entity.createdAt = new Date('2026-10-04T10:00:00.000Z');
    entity.updatedAt = new Date('2026-10-04T11:00:00.000Z');

    const wallet = WalletMapper.toDomain(entity);

    expect(wallet.id).toBe(entity.id);
    expect(wallet.playerId).toBe(entity.playerId);
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balance.toString()).toBe('100.10');
    expect(wallet.version).toBe(3);
    expect(wallet.createdAt).toEqual(entity.createdAt);
    expect(wallet.updatedAt).toEqual(entity.updatedAt);
  });

  it('should convert Wallet domain to WalletEntity', () => {
    const createdAt = new Date('2026-10-04T10:00:00.000Z');

    const wallet = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.10',
        currency: 'BRL',
      }),
      createdAt,
    });

    const entity = WalletMapper.toPersistence(wallet);

    expect(entity).toBeInstanceOf(WalletEntity);
    expect(entity.id).toBe(wallet.id);
    expect(entity.playerId).toBe(wallet.playerId);
    expect(entity.currency).toBe('BRL');
    expect(entity.balance).toBe('100.10');
    expect(entity.version).toBe(1);
    expect(entity.createdAt).toEqual(createdAt);
    expect(entity.updatedAt).toEqual(createdAt);
  });

  it('should preserve monetary value during persistence round-trip', () => {
    const original = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.10',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-04T10:00:00.000Z'),
    });

    const entity = WalletMapper.toPersistence(original);
    const restored = WalletMapper.toDomain(entity);

    expect(entity.balance).toBe('100.10');
    expect(restored.balance.toString()).toBe('100.10');
    expect(restored.balance.equals(original.balance)).toBe(true);
  });
});
