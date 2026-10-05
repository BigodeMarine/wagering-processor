import { Migration } from '@mikro-orm/migrations';

export class Migration20261005182241 extends Migration {
  override name = 'Migration20261005182241';

  override up(): void {
    this.addSql(`
      alter table "outbox_message"
        add column "claimed_by" varchar(255) null,
        add column "claim_until" timestamptz null;
    `);

    /*
     * Supports efficient lookup of pending messages that are due
     * for publication and whose claim is absent or expired.
     */
    this.addSql(`
      create index "outbox_message_publishable_idx"
      on "outbox_message" (
        "published_at",
        "next_attempt_at",
        "claim_until"
      );
    `);
  }

  override down(): void {
    this.addSql(`
      drop index if exists "outbox_message_publishable_idx";
    `);

    this.addSql(`
      alter table "outbox_message"
        drop column "claimed_by",
        drop column "claim_until";
    `);
  }
}
