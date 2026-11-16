(function () {
  "use strict";

  const { t, lang, applyLanguage } = window.PayI18n;

  function applyTheme(next) {
    const theme = next === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    window.PayStorage.write("pay-theme", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", t("common.theme"));
      button.setAttribute("aria-pressed", String(theme === "light"));
    });
  }

  function formatSats(value) {
    return new Intl.NumberFormat(lang() === "lo" ? "lo-LA" : "en-US").format(value);
  }

  function formatTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(lang() === "lo" ? "lo-LA" : "en-US", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(lang() === "lo" ? "lo-LA" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  function randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function fakeId(prefix) {
    return `${prefix}_${randomHex(8)}`;
  }

  function fakeInvoice(amount) {
    return `lnbc${amount}n1synthetic${randomHex(22)}`;
  }

  function checkoutUrl(payment) {
    const params = new URLSearchParams({
      amount: String(payment.amount),
      reference: payment.reference,
      merchant: payment.merchant,
      id: payment.id,
      status: payment.status
    });
    return `checkout.html?${params.toString()}`;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand("copy");
      input.remove();
      return ok;
    }
  }

  let toastTimer;
  function toast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 2800);
  }

  function bindCopy(button, getText) {
    if (!button) return;
    button.addEventListener("click", async () => {
      const value = typeof getText === "function" ? getText() : getText;
      if (!value) return;
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      const ok = await copyText(value);
      button.textContent = ok ? t("common.copied") : original;
      setTimeout(() => {
        button.textContent = button.dataset.label || original;
      }, 1200);
    });
  }

  function init() {
    applyTheme(window.PayStorage.read("pay-theme") || "dark");

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
      });
    });

    document.querySelectorAll("[data-lang-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        applyLanguage(lang() === "en" ? "lo" : "en");
      });
    });

    const navToggle = document.querySelector("[data-nav-toggle]");
    const navLinks = document.querySelector("[data-nav-links]");
    if (navToggle && navLinks) {
      navToggle.addEventListener("click", () => {
        const open = navLinks.classList.toggle("is-open");
        navToggle.setAttribute("aria-expanded", String(open));
      });
      navLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
          navLinks.classList.remove("is-open");
          navToggle.setAttribute("aria-expanded", "false");
        });
      });
    }

    applyLanguage(lang());
  }

  window.PayUI = {
    t,
    lang,
    applyLanguage,
    applyTheme,
    formatSats,
    formatTime,
    formatDateTime,
    escapeHtml,
    randomHex,
    fakeId,
    fakeInvoice,
    checkoutUrl,
    copyText,
    toast,
    bindCopy,
    init
  };
})();
