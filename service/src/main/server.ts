import { pathToFileURL } from "node:url";
import { createApp } from "../api/app.ts";
import { createContainer } from "../container.ts";

async function main(): Promise<void> {
  const container = await createContainer();
  const app = await createApp(container.dependencies);
  const worker = setInterval(() => {
    const liveReconcile = container.services.settlements
      .reconcileLiveInvoices()
      .then((result) => {
        if (result.settled > 0) {
          app.log.info(
            {
              event: "live.reconciled",
              checked: result.checked,
              settled: result.settled
            },
            "live invoices settled by status polling"
          );
        }
      });
    Promise.all([
      container.services.expiration.expireDueIntents(),
      liveReconcile,
      container.services.webhooks.deliverDue()
    ]).catch((error: unknown) => {
      app.log.error(
        {
          event: "worker.error",
          error: error instanceof Error ? error.message : String(error)
        },
        "worker iteration failed"
      );
    });
  }, container.config.workerIntervalMs);
  worker.unref();

  await app.listen({ host: container.config.host, port: container.config.port });
  console.log(
    JSON.stringify({
      event: "server.listening",
      host: container.config.host,
      port: container.config.port,
      schema: container.config.schema,
      sandbox: container.config.sandboxEnabled,
      console_mode: container.config.consoleMode,
      worker_interval_ms: container.config.workerIntervalMs
    })
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(worker);
    await app.close();
    await container.db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
