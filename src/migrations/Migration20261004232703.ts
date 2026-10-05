import { Migration } from '@mikro-orm/migrations';

export class Migration20261004232703 extends Migration {
  override name = 'Migration20261004232703';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "inbox_message" (
      "consumer_name" varchar(255) not null, 
      "message_id" varchar(255) not null, 
      "payload_hash" varchar(255) not null, 
      "received_at" timestamptz not null, 
      "processed_at" timestamptz null, primary key (
      "consumer_name", "message_id"));`,
    );

    this.addSql(`
  create table "outbox_message" (
    "id" uuid not null,
    "aggregate_id" uuid not null,
    "event_type" varchar(255) not null,
    "payload" jsonb not null,
    "occurred_at" timestamptz not null,
    "attempts" int not null,
    "next_attempt_at" timestamptz null,
    "published_at" timestamptz null,

    constraint "outbox_message_pkey"
      primary key ("id"),

    constraint "outbox_message_attempts_non_negative"
      check ("attempts" >= 0)
  );
`);

    this.addSql(`
  create table "wager_transaction" (
    "id" uuid not null,
    "provider_id" varchar(255) not null,
    "external_transaction_id" varchar(255) not null,
    "idempotency_key" varchar(255) not null,
    "payload_hash" varchar(255) not null,
    "wallet_id" uuid not null,
    "player_id" uuid not null,
    "round_id" varchar(255) not null,
    "game_id" varchar(255) not null,
    "kind" varchar(255) not null,
    "amount" numeric(19,2) not null,
    "currency" varchar(3) not null,
    "reference_external_transaction_id" varchar(255) null,
    "reference_transaction_id" uuid null,
    "status" varchar(255) not null,
    "failure_code" varchar(255) null,
    "created_at" timestamptz not null,
    "processed_at" timestamptz null,

    constraint "wager_transaction_pkey"
      primary key ("id"),

    constraint "wager_transaction_idempotency_key_unique"
      unique ("idempotency_key"),

    constraint "wager_transaction_provider_external_unique"
      unique ("provider_id", "external_transaction_id"),

    constraint "wager_transaction_amount_non_negative"
      check ("amount" >= 0),

    constraint "wager_transaction_kind_check"
      check (
        "kind" in (
          'OPENING',
          'BET',
          'WIN',
          'LOSS',
          'REFUND',
          'ROLLBACK'
        )
      ),

    constraint "wager_transaction_status_check"
      check (
        "status" in (
          'PENDING',
          'PENDING_REFERENCE',
          'PROCESSED',
          'REJECTED',
          'FAILED'
        )
      ),

    constraint "wager_transaction_failure_code_check"
      check (
        "failure_code" is null
        or "failure_code" in (
          'INSUFFICIENT_BALANCE',
          'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE',
          'REFERENCE_NOT_FOUND',
          'REFERENCE_MISMATCH',
          'INVALID_REFERENCE_KIND',
          'REVERSAL_AMOUNT_MISMATCH',
          'REFERENCE_ALREADY_REVERSED',
          'PERMANENT_INFRASTRUCTURE_FAILURE'
        )
      ),

    constraint "wager_transaction_reference_fk"
      foreign key ("reference_transaction_id")
      references "wager_transaction" ("id")
  );
`);

    this.addSql(`
  create unique index "wager_transaction_reference_kind_unique"
  on "wager_transaction" ("reference_transaction_id", "kind")
  where "reference_transaction_id" is not null
    and "kind" in ('REFUND', 'ROLLBACK');
`);

    this.addSql(`
  create table "wallet" (
    "id" uuid not null,
    "player_id" uuid not null,
    "currency" varchar(3) not null,
    "balance" numeric(19,2) not null,
    "version" int not null,
    "created_at" timestamptz not null,
    "updated_at" timestamptz not null,

    constraint "wallet_pkey"
      primary key ("id"),

    constraint "wallet_player_currency_unique"
      unique ("player_id", "currency"),

    constraint "wallet_balance_non_negative"
      check ("balance" >= 0),

    constraint "wallet_version_positive"
      check ("version" >= 1)
  );
`);
    this.addSql(`
  create table "wallet_ledger_entry" (
    "id" uuid not null,
    "wallet_id" uuid not null,
    "transaction_id" uuid not null,
    "direction" varchar(255) not null,
    "amount" numeric(19,2) not null,
    "currency" varchar(3) not null,
    "balance_before" numeric(19,2) not null,
    "balance_after" numeric(19,2) not null,
    "created_at" timestamptz not null,

    constraint "wallet_ledger_entry_pkey"
      primary key ("id"),

    constraint "wallet_ledger_entry_wallet_transaction_unique"
      unique ("wallet_id", "transaction_id"),

    constraint "wallet_ledger_entry_direction_check"
      check ("direction" in ('DEBIT', 'CREDIT')),

    constraint "wallet_ledger_entry_amount_non_negative"
      check ("amount" >= 0),

    constraint "wallet_ledger_entry_balance_before_non_negative"
      check ("balance_before" >= 0),

    constraint "wallet_ledger_entry_balance_after_non_negative"
      check ("balance_after" >= 0)
  );
`);
    this.addSql(`
  alter table "wager_transaction"
  add constraint "wager_transaction_wallet_fk"
  foreign key ("wallet_id")
  references "wallet" ("id")
  on update cascade
  on delete restrict;
`);

    this.addSql(`
  alter table "wallet_ledger_entry"
  add constraint "wallet_ledger_entry_wallet_fk"
  foreign key ("wallet_id")
  references "wallet" ("id")
  on update cascade
  on delete restrict;
`);

    this.addSql(`
  alter table "wallet_ledger_entry"
  add constraint "wallet_ledger_entry_transaction_fk"
  foreign key ("transaction_id")
  references "wager_transaction" ("id")
  on update cascade
  on delete restrict;
`);
  }
}
