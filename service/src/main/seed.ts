import { pathToFileURL } from "node:url";
import { createContainer } from "../container.ts";

async function main(): Promise<void> {
  const container = await createContainer({ autoMigrate: true });
  try {
    const seeded = await container.services.provisioning.bootstrapMerchant({
      organizationName: process.env.PAY_SEED_ORG_NAME ?? "BitOS Pay Local",
      merchantName: process.env.PAY_SEED_MERCHANT_NAME ?? "Local Merchant",
      country: process.env.PAY_SEED_COUNTRY ?? "LA",
      feeBps: container.config.defaultFeeBps,
      livemode: process.env.PAY_SEED_LIVEMODE === "1"
    });
    let webhook: unknown = null;
    if (process.env.PAY_SEED_WEBHOOK_URL) {
      const auth = await container.services.auth.authenticate(`Bearer ${seeded.apiKey}`);
      const registration = await container.services.webhooks.registerEndpoint(
        auth,
        {
          url: process.env.PAY_SEED_WEBHOOK_URL,
          events: ["payment.succeeded", "payment.expired", "payment.quarantined"]
        },
        `seed-webhook-${seeded.merchantId}`
      );
      webhook = {
        id: registration.endpoint.id,
        url: registration.endpoint.url,
        events: registration.endpoint.events,
        status: registration.endpoint.status,
        secret: registration.secret
      };
    }
    console.log(
      JSON.stringify(
        {
          schema: container.config.schema,
          database: container.config.databaseUrl.startsWith("pglite://")
            ? "pglite"
            : new URL(container.config.databaseUrl).host,
          organization_id: seeded.organizationId,
          merchant_id: seeded.merchantId,
          provider_connection_id: seeded.providerConnectionId,
          api_key: seeded.apiKey,
          api_key_note: "shown once; store it in a secret manager, never in the repository",
          livemode: seeded.livemode,
          webhook
        },
        null,
        2
      )
    );
  } finally {
    await container.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
