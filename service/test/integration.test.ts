import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { createContainer, type Container } from "../src/container.ts";
import { testConfig } from "./helpers.ts";

const enabled = process.env.PAY_RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const schema = `pay_it_${Date.now()}`;

describe(
  "PostgreSQL integration",
  { skip: !enabled ? "set PAY_RUN_INTEGRATION=1 and DATABASE_URL" : false },
  () => {
    let container: Container;
    let apiKey: string;
    let merchantId: string;

    before(async () => {
      const config = loadConfig({
        ...testConfig(),
        databaseUrl: process.env.DATABASE_URL,
        schema
      });
      container = await createContainer({ config, autoMigrate: true });
      const seeded = await container.services.provisioning.bootstrapMerchant({
        organizationName: "Integration Organization",
        merchantName: "Integration Merchant",
        feeBps: 100,
        livemode: false
      });
      apiKey = seeded.apiKey;
      merchantId = seeded.merchantId;
    });

    after(async () => {
      if (container) {
        await container.db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await container.db.close();
      }
    });

    it("runs intent to settled ledger and reports balances", async () => {
      assert.ok(merchantId.startsWith("mer_"));
      const auth = await container.services.auth.authenticate(`Bearer ${apiKey}`);
      const created = await container.services.paymentIntents.createPaymentIntent(
        auth,
        {
          amount: 2500,
          currency: "SAT",
          scale: 0,
          payment_method: "lightning",
          external_reference: "IT-ORDER-001",
          metadata: { source: "integration" }
        },
        "it-idem-0001",
        "it-request-1"
      );
      assert.equal(created.status, "PENDING");
      const settled = await container.services.settlements.sandboxSettle(
        created.payment.payment_hash
      );
      assert.equal(settled.status, "SETTLED");
      const balances = await container.services.ledgerQuery.getBalances(auth);
      assert.equal(
        balances.find((line) => line.account_code === "merchant_payable")?.balance_msat,
        "2475000"
      );
      assert.equal(
        balances.find((line) => line.account_code === "platform_fee_revenue")?.balance_msat,
        "25000"
      );
    });
  }
);
