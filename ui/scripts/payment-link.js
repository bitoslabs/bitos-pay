(function () {
  "use strict";

  const { formatSats, t, toast, init } = window.PayUI;
  const params = new URLSearchParams(window.location.search);
  const pathToken = window.location.pathname.match(/^\/pay\/(plk_[^/]+)$/)?.[1] || null;
  const token = params.get("token") || pathToken;
  const storageKey = token ? `pay-link-key-${token}` : "pay-link-key";

  const els = {
    merchant: document.getElementById("merchantName"),
    amount: document.getElementById("amount"),
    referenceRow: document.getElementById("referenceRow"),
    reference: document.getElementById("reference"),
    labelRow: document.getElementById("labelRow"),
    label: document.getElementById("label"),
    lead: document.getElementById("linkLead"),
    banner: document.getElementById("statusBanner"),
    title: document.getElementById("statusTitle"),
    body: document.getElementById("statusBody"),
    create: document.getElementById("createInvoice"),
    status: document.getElementById("linkStatus"),
    envChip: document.getElementById("envChip")
  };

  let idempotencyKey = window.PayStorage.readSession(storageKey);
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID();
    window.PayStorage.writeSession(storageKey, idempotencyKey);
  }

  function fail(message) {
    els.banner.dataset.status = "expired";
    els.title.textContent = t("link.unavailable");
    els.body.textContent = message || t("link.unavailableBody");
    els.create.disabled = true;
    els.create.hidden = true;
  }

  async function load() {
    if (!token) {
      fail(t("link.unavailableBody"));
      return;
    }
    try {
      const response = await fetch(`/v1/payment-links/${encodeURIComponent(token)}`, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(t("link.unavailableBody"));
      const link = await response.json();
      els.merchant.textContent = link.merchant.name;
      els.amount.textContent = formatSats(link.amount);
      els.lead.textContent = t("link.readyLead");
      els.envChip.textContent = t("common.sandbox");
      if (link.external_reference) {
        els.reference.textContent = link.external_reference;
        els.referenceRow.hidden = false;
      }
      if (link.label) {
        els.label.textContent = link.label;
        els.labelRow.hidden = false;
      }
      els.banner.dataset.status = "pending";
      els.title.textContent = t("link.readyTitle");
      els.body.textContent = t("link.readyBody");
      els.create.disabled = false;
    } catch (error) {
      fail(error.message);
    }
  }

  els.create.addEventListener("click", async () => {
    if (!token) return;
    els.create.disabled = true;
    els.create.textContent = t("link.creating");
    window.PayStorage.writeSession(storageKey, idempotencyKey);
    try {
      const response = await fetch(`/v1/payment-links/${encodeURIComponent(token)}/checkout`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "idempotency-key": idempotencyKey
        }
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || t("link.createError"));
      }
      window.PayStorage.removeSession(storageKey);
      window.location.assign(body.checkout_url);
    } catch (error) {
      toast(error.message || t("link.createError"));
      els.create.disabled = false;
      els.create.textContent = t("link.createInvoice");
    }
  });

  document.addEventListener("pay:language", load);
  load();
  init();
})();
