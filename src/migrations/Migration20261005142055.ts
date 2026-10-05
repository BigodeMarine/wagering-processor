import { Migration } from '@mikro-orm/migrations';

export class Migration20261005142055 extends Migration {
  override name = 'Migration20261005142055';

  override up(): void {
    this.addSql(`
      alter table "wager_transaction"
      add column "resulting_balance" numeric(19,2) null;
    `);

    this.addSql(`
      alter table "wager_transaction"
      add constraint "wager_transaction_resulting_balance_non_negative"
      check (resulting_balance is null or resulting_balance >= 0);
    `);
  }

  override down(): void {
    this.addSql(`
      alter table "wager_transaction"
      drop constraint "wager_transaction_resulting_balance_non_negative";
    `);

    this.addSql(`
      alter table "wager_transaction"
      drop column "resulting_balance";
    `);
  }
}