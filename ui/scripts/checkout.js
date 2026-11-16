(function () {
  "use strict";

  const {
    formatSats,
    formatDateTime,
    escapeHtml,
    fakeInvoice,
    t,
    bindCopy,
    toast,
    init
  } = window.PayUI;

  const params = new URLSearchParams(window.location.search);
  const pathToken = window.location.pathname.match(/^\/checkout\/(pcl_[^/]+)$/)?.[1] || null;
  const liveToken = params.get("token") || pathToken;
  const live = Boolean(liveToken);
  const requestedStatus = params.get("status");

  let merchant = live ? "…" : params.get("merchant") || "Sabaidee Coffee";
  let reference = live ? "…" : params.get("reference") || "BNOS-ORDER-1043";
  let paymentId = live ? "…" : params.get("id") || "pi_demo_1043";
  const requestedAmount = Number(params.get("amount"));
  let amount = Number.isSafeInteger(requestedAmount) && requestedAmount > 0 ? requestedAmount : 25000;
  let status = ["pending", "checking", "paid", "expired"].includes(requestedStatus) ? requestedStatus : "pending";
  let invoice = live ? "" : fakeInvoice(amount);
  let expiresAt = new Date(Date.now() + 15 * 60_000);
  let paidAt = null;
  let simulateTimer = null;
  let pollTimer = null;
  let liveView = null;
  const storageKey = `pay-expiry-${paymentId}`;

  const els = {
    merchant: document.getElementById("merchantName"),
    merchantInline: document.getElementById("merchantNameInline"),
    reference: document.getElementById("reference"),
    amount: document.getElementById("amount"),
    invoice: document.getElementById("invoiceText"),
    qr: document.getElementById("qrCanvas"),
    banner: document.getElementById("statusBanner"),
    icon: document.getElementById("statusIcon"),
    title: document.getElementById("statusTitle"),
    body: document.getElementById("statusBody"),
    timeline: document.getElementById("timeline"),
    simulate: document.getElementById("simulate"),
    refresh: document.getElementById("refresh"),
    expire: document.getElementById("expire"),
    newInvoice: document.getElementById("newInvoice"),
    countdown: document.getElementById("countdown"),
    success: document.getElementById("successPanel"),
    receipt: document.getElementById("receipt"),
    copyInvoice: document.getElementById("copyInvoice"),
    openWallet: document.getElementById("openWallet"),
    printReceipt: document.getElementById("printReceipt"),
    lead: document.getElementById("checkoutLead"),
    envChip: document.getElementById("envChip"),
    ticker: document.getElementById("ticker"),
    sandboxNote: document.getElementById("sandboxNote"),
    brandLink: document.getElementById("brandLink"),
    footer: document.getElementById("siteFooter")
  };

  if (!live) {
    if (requestedStatus === "paid") {
      paidAt = new Date();
    } else if (requestedStatus === "expired") {
      expiresAt = new Date(Date.now() - 1000);
    } else if (status === "pending") {
      const storedExpiry = Number(window.PayStorage.readSession(storageKey));
      if (Number.isFinite(storedExpiry) && storedExpiry > Date.now()) {
        expiresAt = new Date(storedExpiry);
      } else if (Number.isFinite(storedExpiry) && storedExpiry > 0) {
        status = "expired";
        expiresAt = new Date(storedExpiry);
      }
    }
  }

  const statusCopy = {
    pending: { titleKey: "checkout.waiting", bodyKey: "checkout.waitingBody" },
    checking: { titleKey: "checkout.checking", bodyKey: "checkout.checkingBody" },
    paid: { titleKey: "checkout.paid", bodyKey: "checkout.paidBody" },
    expired: { titleKey: "checkout.expired", bodyKey: "checkout.expiredBody" }
  };

  const statusIcon = {
    pending: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>',
    checking: '<svg class="i spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M21 3v6h-6" /></svg>',
    paid: '<svg class="i" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>',
    expired: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>'
  };

  const stepOrder = ["invoice", "detected", "verified"];
  const stepStates = {
    pending: { invoice: "done", detected: "active", verified: "" },
    checking: { invoice: "done", detected: "done", verified: "active" },
    paid: { invoice: "done", detected: "done", verified: "done" },
    expired: { invoice: "done", detected: "expired", verified: "" }
  };

  function applyLiveEnvironment() {
    document.body.dataset.live = String(live);
    document.querySelectorAll(".merchant-only").forEach((node) => {
      node.hidden = live;
    });
    if (els.ticker) els.ticker.hidden = live;
    if (els.sandboxNote) els.sandboxNote.hidden = live;
    if (els.footer) els.footer.hidden = live;
    if (live) {
      if (els.brandLink) {
        els.brandLink.setAttribute("href", "/console/");
        els.brandLink.removeAttribute("aria-disabled");
      }
      els.simulate.hidden = true;
      els.expire.hidden = true;
      els.newInvoice.hidden = true;
      els.lead.textContent = t(liveView?.livemode ? "checkout.liveLead" : "checkout.sandboxLead");
      els.envChip.textContent = t(liveView?.livemode ? "checkout.liveMode" : "common.sandbox");
      els.envChip.className = liveView?.livemode ? "chip chip-ok" : "chip chip-warn";
    } else if (els.brandLink) {
      els.brandLink.setAttribute("href", "index.html");
      els.brandLink.removeAttribute("aria-disabled");
    }
  }

  function renderStatic() {
    els.merchant.textContent = merchant;
    els.merchantInline.textContent = merchant;
    els.reference.textContent = reference;
    els.amount.textContent = formatSats(amount);
    els.invoice.textContent = invoice || "—";
    if (invoice) {
      els.openWallet.href = `lightning:${invoice}`;
      els.openWallet.removeAttribute("aria-disabled");
      window.PayQr.draw(els.qr, invoice);
      els.qr.setAttribute("aria-label", t(live ? "checkout.liveQrNote" : "checkout.qrNote"));
    } else {
      els.openWallet.href = "#";
      els.openWallet.setAttribute("aria-disabled", "true");
    }
    applyLiveEnvironment();
  }

  function renderStep(step, state, index) {
    const node = els.timeline.querySelector(`[data-step="${step}"]`);
    if (!node) return;
    node.classList.remove("done", "active", "expired");
    if (state) node.classList.add(state);

    const dot = node.querySelector(".step-dot");
    if (!dot) return;
    if (state === "done") {
      dot.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>';
    } else if (state === "expired") {
      dot.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';
    } else {
      dot.innerHTML = `<span>${index + 1}</span>`;
    }
  }

  function renderTimeline() {
    const states = stepStates[status] || stepStates.pending;
    stepOrder.forEach((step, index) => renderStep(step, states[step], index));
  }

  function renderReceipt() {
    els.receipt.innerHTML = `
      <div class="detail-list">
        <div class="detail-row"><span>${escapeHtml(t("checkout.amount"))}</span><strong>${formatSats(amount)} SAT</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("checkout.paidTo"))}</span><strong>${escapeHtml(merchant)}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("checkout.reference"))}</span><strong>${escapeHtml(reference)}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("checkout.paymentId"))}</span><strong>${escapeHtml(paymentId)}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("checkout.paidAt"))}</span><strong>${escapeHtml(formatDateTime(paidAt || new Date()))}</strong></div>
      </div>
    `;
  }

  function renderCountdown() {
    if (status === "paid") {
      els.countdown.textContent = "—";
      return;
    }
    if (status === "expired") {
      els.countdown.textContent = "00:00";
      return;
    }
    const remaining = Math.max(0, expiresAt.getTime() - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    els.countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderStatus() {
    const copy = statusCopy[status] || statusCopy.pending;
    els.banner.dataset.status = status;
    els.title.textContent = t(copy.titleKey);
    els.body.textContent =
      live && liveView?.status === "FAILED" ? t("checkout.failedBody") : t(copy.bodyKey);
    els.icon.innerHTML = statusIcon[status] || statusIcon.pending;

    els.simulate.hidden = live || status === "paid" || status === "expired";
    els.simulate.disabled = status === "checking";
    els.refresh.hidden = status === "paid";
    els.expire.hidden = live || (status !== "pending" && status !== "checking");
    els.newInvoice.hidden = live || status !== "expired";
    els.success.hidden = status !== "paid";
    els.countdown.parentElement.hidden = status === "paid";
    document.body.classList.toggle("is-paid", status === "paid");

    renderTimeline();
    renderCountdown();
    if (status === "paid") renderReceipt();
  }

  function setStatus(next) {
    status = next;
    if (status === "paid" && !paidAt) paidAt = new Date();
    if (status === "expired") {
      expiresAt = new Date();
      window.PayStorage.removeSession(storageKey);
    }
    renderStatus();
  }

  function tick() {
    if (status === "pending" || status === "checking") {
      if (!live && Date.now() >= expiresAt.getTime()) {
        setStatus("expired");
        toast(t("checkout.expiredToast"));
      } else {
        renderCountdown();
      }
    }
  }

  function mapLiveStatus(next) {
    if (next === "SUCCEEDED") return "paid";
    if (next === "EXPIRED" || next === "CANCELLED" || next === "FAILED") return "expired";
    return "pending";
  }

  function applyLiveView(view) {
    liveView = view;
    merchant = view.merchant?.name || merchant;
    reference = view.external_reference || view.payment_id;
    paymentId = view.payment_id;
    amount = view.amount;
    invoice = view.invoice?.bolt11 || "";
    expiresAt = new Date(view.expires_at);
    paidAt = view.paid_at ? new Date(view.paid_at) : null;
    status = mapLiveStatus(view.status);
    renderStatic();
    renderStatus();
  }

  async function loadLive(notify) {
    if (!live) return false;
    try {
      const response = await fetch(`/v1/checkout/${encodeURIComponent(liveToken)}`, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error("checkout unavailable");
      applyLiveView(await response.json());
      if (notify) toast(t("checkout.refreshed"));
      return true;
    } catch {
      if (notify) toast(t("checkout.loadError"));
      return false;
    }
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    if (!live || status === "paid" || status === "expired") return;
    pollTimer = window.setTimeout(async () => {
      await loadLive(false);
      schedulePoll();
    }, 3000);
  }

  els.simulate.addEventListener("click", () => {
    if (live || status !== "pending") return;
    window.clearTimeout(simulateTimer);
    setStatus("checking");
    simulateTimer = window.setTimeout(() => {
      setStatus("paid");
    }, 1600);
  });

  els.refresh.addEventListener("click", () => {
    if (live) {
      void loadLive(true).then(schedulePoll);
      return;
    }
    if (status === "pending") {
      toast(t("checkout.noPayment"));
    } else if (status === "checking") {
      toast(t("checkout.checkingToast"));
    } else if (status === "paid") {
      toast(t("checkout.alreadyPaid"));
    } else {
      toast(t("checkout.expiredToast"));
    }
  });

  els.expire.addEventListener("click", () => {
    if (live) return;
    window.clearTimeout(simulateTimer);
    setStatus("expired");
    toast(t("checkout.expiredToast"));
  });

  els.newInvoice.addEventListener("click", () => {
    if (live) return;
    window.clearTimeout(simulateTimer);
    invoice = fakeInvoice(amount);
    paidAt = null;
    expiresAt = new Date(Date.now() + 15 * 60_000);
    window.PayStorage.writeSession(storageKey, String(expiresAt.getTime()));
    setStatus("pending");
    renderStatic();
  });

  els.printReceipt.addEventListener("click", () => {
    window.print();
  });

  bindCopy(els.copyInvoice, () => invoice);

  document.addEventListener("pay:language", () => {
    renderStatic();
    renderStatus();
  });

  renderStatic();
  setStatus(status);

  if (live) {
    els.title.textContent = t("checkout.loading");
    els.body.textContent = t("checkout.loadingBody");
    void loadLive(false).then((ok) => {
      if (ok) schedulePoll();
    });
  } else if (status === "pending" || status === "checking") {
    window.PayStorage.writeSession(storageKey, String(expiresAt.getTime()));
    window.setInterval(tick, 1000);
    tick();
  }

  init();
})();
