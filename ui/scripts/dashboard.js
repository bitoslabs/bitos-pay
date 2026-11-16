(function () {
  "use strict";

  const { formatSats, formatTime, formatDateTime, escapeHtml, fakeId, fakeInvoice, checkoutUrl, t } = window.PayUI;

  const { createPayments, minutesFromNow } = window.PayDemoData;
  const payments = createPayments();

  const paymentsBody = document.getElementById("paymentsBody");
  const paymentsEmpty = document.getElementById("paymentsEmpty");
  const paymentsStatus = document.getElementById("paymentsStatus");
  const filterTabs = document.getElementById("filterTabs");
  const createForm = document.getElementById("createForm");
  const amountInput = document.getElementById("amount");
  const amountError = document.getElementById("amountError");
  const createButton = document.getElementById("createButton");
  const preview = document.getElementById("preview");
  const previewQr = document.getElementById("previewQr");
  const previewAmount = document.getElementById("previewAmount");
  const previewReference = document.getElementById("previewReference");
  const previewInvoice = document.getElementById("previewInvoice");
  const previewOpen = document.getElementById("previewOpen");
  const copyPreview = document.getElementById("copyPreview");
  const copyPreviewLink = document.getElementById("copyPreviewLink");
  const drawer = document.getElementById("drawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const drawerBody = document.getElementById("drawerBody");
  const drawerClose = document.getElementById("drawerClose");

  let filter = "all";
  let activePayment = null;
  let previewPayment = null;
  let lastTrigger = null;
  let drawerOpen = false;
  let closeTimer = null;
  let creating = false;

  function filteredPayments() {
    if (filter === "all") return payments;
    if (filter === "pending") return payments.filter((payment) => payment.status === "pending" || payment.status === "checking");
    return payments.filter((payment) => payment.status === filter);
  }

  function statusMarkup(status) {
    return `<span class="status status-${escapeHtml(status)}">${escapeHtml(t(`status.${status}`))}</span>`;
  }

  function renderTable() {
    const visible = filteredPayments();
    paymentsBody.innerHTML = visible
      .map(
        (payment) => `
          <tr class="pay-row" data-payment-id="${escapeHtml(payment.id)}" tabindex="0">
            <td>
              <span>${escapeHtml(payment.reference || "No reference")}</span>
              <span class="ref">${escapeHtml(payment.id)} · ${escapeHtml(payment.memo)}</span>
            </td>
            <td>${statusMarkup(payment.status)}</td>
            <td class="amount-cell">${formatSats(payment.amount)} SAT</td>
            <td class="mono">${escapeHtml(formatTime(payment.createdAt))}</td>
          </tr>
        `
      )
      .join("");
    paymentsEmpty.hidden = visible.length > 0;
    paymentsStatus.textContent = `Showing ${visible.length} of ${payments.length} synthetic payments.`;
  }

  function renderStats() {
    const paid = payments.filter((payment) => payment.status === "paid");
    const pending = payments.filter((payment) => payment.status === "pending" || payment.status === "checking");
    const gross = paid.reduce((total, payment) => total + payment.amount, 0);
    const fees = paid.reduce((total, payment) => total + payment.fee, 0);

    document.getElementById("statVolume").textContent = formatSats(gross);
    document.getElementById("statSuccess").textContent = String(paid.length);
    document.getElementById("statPending").textContent = String(pending.length);
    document.getElementById("settlementGross").textContent = `${formatSats(gross)} SAT`;
    document.getElementById("settlementFees").textContent = `${formatSats(fees)} SAT`;
    document.getElementById("settlementNet").textContent = `${formatSats(gross - fees)} SAT`;
  }

  function showPreview(payment) {
    previewPayment = payment || null;
    if (!payment) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    previewAmount.textContent = formatSats(payment.amount);
    previewReference.textContent = `${payment.reference || "No reference"} · ${payment.memo}`;
    previewInvoice.textContent = payment.invoice;
    previewOpen.href = checkoutUrl(payment);
    window.PayQr.draw(previewQr, payment.invoice);
  }

  function openDrawer(payment, trigger) {
    activePayment = payment;
    lastTrigger = trigger || null;
    window.clearTimeout(closeTimer);
    drawerBody.innerHTML = renderDrawer(payment);
    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    drawerOpen = true;

    const copyInvoice = drawerBody.querySelector("[data-copy-invoice]");
    if (copyInvoice) {
      window.PayUI.bindCopy(copyInvoice, () => payment.invoice);
    }

    drawerClose.focus();
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    drawer.classList.remove("is-open");
    document.body.style.overflow = "";
    closeTimer = window.setTimeout(() => {
      drawer.hidden = true;
      drawerBackdrop.hidden = true;
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    }, 220);
  }

  function renderDrawer(payment) {
    const canCheckout = ["pending", "paid", "expired"].includes(payment.status);
    const checkoutLink = canCheckout
      ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(checkoutUrl(payment))}">${escapeHtml(t("detail.openCheckout"))}</a>`
      : "";
    const quarantine =
      payment.status === "quarantined"
        ? `<div class="detail-note">${escapeHtml(t("detail.quarantine"))}</div>`
        : "";

    return `
      ${statusMarkup(payment.status)}
      <div class="drawer-amount">${formatSats(payment.amount)}<small>SAT</small></div>
      <p class="hint">${escapeHtml(payment.reference || "No reference")} · ${escapeHtml(payment.memo)}</p>
      <div class="detail-list">
        <div class="detail-row"><span>${escapeHtml(t("detail.fee"))}</span><strong>${formatSats(payment.fee)} SAT</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.net"))}</span><strong>${formatSats(payment.net)} SAT</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.created"))}</span><strong>${escapeHtml(formatDateTime(payment.createdAt))}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.expires"))}</span><strong>${escapeHtml(formatDateTime(payment.expiresAt))}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.method"))}</span><strong>${escapeHtml(payment.method)}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.delivery"))}</span><strong>${escapeHtml(payment.delivery)}</strong></div>
      </div>
      ${quarantine}
      <div class="detail-section">
        <h3>${escapeHtml(t("detail.invoice"))}</h3>
        <div class="invoice">
          <code>${escapeHtml(payment.invoice)}</code>
          <button class="btn btn-glass btn-sm" type="button" data-copy-invoice>${escapeHtml(t("detail.copyInvoice"))}</button>
        </div>
      </div>
      <div class="detail-section">
        <h3>${escapeHtml(t("detail.ledger"))}</h3>
        <div class="detail-note">${escapeHtml(t("detail.ledgerNote"))}</div>
      </div>
      <div class="preview-actions">${checkoutLink}</div>
    `;
  }

  function setFilter(nextFilter) {
    filter = nextFilter;
    filterTabs.querySelectorAll("[data-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    });
    renderTable();
  }

  function renderAll() {
    renderTable();
    renderStats();
    if (drawerOpen && activePayment) {
      drawerBody.innerHTML = renderDrawer(activePayment);
      const copyInvoice = drawerBody.querySelector("[data-copy-invoice]");
      if (copyInvoice) window.PayUI.bindCopy(copyInvoice, () => activePayment.invoice);
    }
  }

  function validateAmount(raw) {
    const amount = Number(raw);
    return Number.isSafeInteger(amount) && amount >= 1 && amount <= 100_000_000;
  }

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (creating) return;
    const raw = amountInput.value.trim();
    const valid = validateAmount(raw);

    amountError.hidden = valid;
    amountInput.setAttribute("aria-invalid", String(!valid));
    if (!valid) {
      amountInput.focus();
      return;
    }

    const amount = Number(raw);
    const reference = document.getElementById("reference").value.trim() || `ORDER-${window.PayUI.randomHex(2).toUpperCase()}`;
    const memo = document.getElementById("memo").value.trim() || "Synthetic request";
    const expiry = Number(document.getElementById("expiry").value) || 15;
    const fee = Math.round(amount * 0.01);

    const payment = {
      id: fakeId("pi"),
      reference,
      merchant: "Sabaidee Coffee",
      amount,
      fee,
      net: amount - fee,
      status: "pending",
      createdAt: new Date(),
      expiresAt: minutesFromNow(expiry),
      memo,
      delivery: "pending",
      invoice: fakeInvoice(amount),
      method: "lightning"
    };

    creating = true;
    createButton.disabled = true;
    createButton.textContent = t("dash.creating");
    window.setTimeout(() => {
      payments.unshift(payment);
      setFilter("all");
      renderStats();
      showPreview(payment);
      window.PayUI.toast(t("dash.createdToast"));
      creating = false;
      createButton.disabled = false;
      createButton.textContent = t("dash.create");
      amountInput.removeAttribute("aria-invalid");
      amountError.hidden = true;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 280);
  });

  amountInput.addEventListener("input", () => {
    if (!amountInput.value.trim()) return;
    const valid = validateAmount(amountInput.value.trim());
    amountError.hidden = valid;
    amountInput.setAttribute("aria-invalid", String(!valid));
  });

  paymentsBody.addEventListener("click", (event) => {
    const row = event.target.closest("[data-payment-id]");
    if (!row) return;
    const payment = payments.find((item) => item.id === row.dataset.paymentId);
    if (payment) openDrawer(payment, row);
  });

  paymentsBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-payment-id]");
    if (!row) return;
    event.preventDefault();
    const payment = payments.find((item) => item.id === row.dataset.paymentId);
    if (payment) openDrawer(payment, row);
  });

  filterTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) setFilter(button.dataset.filter);
  });

  drawerClose.addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (event) => {
    if (!drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((node) => !node.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("pay:language", () => {
    renderAll();
    if (!creating) createButton.textContent = t("dash.create");
    showPreview(previewPayment);
  });

  window.PayUI.bindCopy(copyPreview, () => previewInvoice.textContent);
  window.PayUI.bindCopy(copyPreviewLink, () => new URL(previewOpen.getAttribute("href"), window.location.href).href);

  window.PayUI.init();
  renderAll();
  showPreview(payments.find((payment) => payment.status === "pending") || payments[0]);
})();
