(function () {
  "use strict";

  const {
    formatSats,
    formatDateTime,
    copyText,
    lang,
    escapeHtml,
    t,
    toast,
    bindCopy,
    init
  } = window.PayUI;

  const state = {
    session: null,
    csrf: "",
    consoleMode: "sandbox",
    consoleConfig: null,
    overview: null,
    payments: [],
    recentPayments: [],
    paymentCursor: null,
    hasMorePayments: false,
    paymentRequest: 0,
    filter: "all",
    lastTrigger: null,
    drawerOpen: false,
    closeTimer: null,
    creating: false,
    creatingKey: false,
    linkedNostrPubkey: null,
    nostrConfig: { nip07: true, nsec: false, remote: false, relay: null },
    onboardingEnabled: false,
    planSubscriptionId: null,
    welcomeKey: null,
    welcomeNpub: null,
    generatedKey: null,
    creatingWithKey: false,
    authMode: "signin",
    query: "",
    pendingFocus: null,
    pendingScroll: null,
    apiReference: null,
    apiReferenceQuery: "",
    editingWebhookId: null
  };

  const els = {
    envChip: document.getElementById("envChip"),
    envToggle: document.getElementById("envToggle"),
    brandLead: document.getElementById("brandLead"),
    brandStep2: document.getElementById("brandStep2"),
    loginView: document.getElementById("loginView"),
    loginTitle: document.getElementById("loginTitle"),
    loginLead: document.getElementById("loginLead"),
    loginAlert: document.getElementById("loginAlert"),
    authMode: document.getElementById("authMode"),
    signInMode: document.getElementById("signInMode"),
    createAccountMode: document.getElementById("createAccountMode"),
    authModeHint: document.getElementById("authModeHint"),
    generateKeyPanel: document.getElementById("generateKeyPanel"),
    generateKeyButton: document.getElementById("generateKeyButton"),
    backupPanel: document.getElementById("backupPanel"),
    backupNpub: document.getElementById("backupNpub"),
    backupNsec: document.getElementById("backupNsec"),
    copyNpubButton: document.getElementById("copyNpubButton"),
    copyNsecButton: document.getElementById("copyNsecButton"),
    revealNsecButton: document.getElementById("revealNsecButton"),
    downloadNsecButton: document.getElementById("downloadNsecButton"),
    backupAck: document.getElementById("backupAck"),
    createWithKeyButton: document.getElementById("createWithKeyButton"),
    generateAgainButton: document.getElementById("generateAgainButton"),
    backupError: document.getElementById("backupError"),
    backupStatus: document.getElementById("backupStatus"),
    existingAuthPanel: document.getElementById("existingAuthPanel"),
    existingDivider: document.getElementById("existingDivider"),
    consoleView: document.getElementById("consoleView"),
    loginForm: document.getElementById("loginForm"),
    apiKey: document.getElementById("apiKey"),
    loginButton: document.getElementById("loginButton"),
    loginError: document.getElementById("loginError"),
    keyLabel: document.getElementById("keyLabel"),
    securityNote: document.getElementById("securityNote"),
    nostrLoginButton: document.getElementById("nostrLoginButton"),
    nostrLoginHelp: document.getElementById("nostrLoginHelp"),
    nostrLoginStatus: document.getElementById("nostrLoginStatus"),
    nsecLoginPanel: document.getElementById("nsecLoginPanel"),
    nsecKey: document.getElementById("nsecKey"),
    nsecLoginButton: document.getElementById("nsecLoginButton"),
    nsecLoginHint: document.getElementById("nsecLoginHint"),
    nsecLoginStatus: document.getElementById("nsecLoginStatus"),
    remoteLoginPanel: document.getElementById("remoteLoginPanel"),
    bunkerUrl: document.getElementById("bunkerUrl"),
    remoteLoginButton: document.getElementById("remoteLoginButton"),
    remoteQrButton: document.getElementById("remoteQrButton"),
    remoteQrPanel: document.getElementById("remoteQrPanel"),
    remoteQr: document.getElementById("remoteQr"),
    remoteQrStatus: document.getElementById("remoteQrStatus"),
    remoteQrCancel: document.getElementById("remoteQrCancel"),
    remoteLoginHint: document.getElementById("remoteLoginHint"),
    remoteLoginStatus: document.getElementById("remoteLoginStatus"),
    onboardOrg: document.getElementById("onboardOrg"),
    onboardMerchant: document.getElementById("onboardMerchant"),
    workspaceDetails: document.getElementById("workspaceDetails"),
    apiKeyDetails: document.getElementById("apiKeyDetails"),
    remoteLoginToggle: document.getElementById("remoteLoginToggle"),
    nsecLoginToggle: document.getElementById("nsecLoginToggle"),
    welcomeKeyPanel: document.getElementById("welcomeKeyPanel"),
    welcomeKeyValue: document.getElementById("welcomeKeyValue"),
    welcomeNpubLine: document.getElementById("welcomeNpubLine"),
    welcomeNpub: document.getElementById("welcomeNpub"),
    copyWelcomeKey: document.getElementById("copyWelcomeKey"),
    dismissWelcomeKey: document.getElementById("dismissWelcomeKey"),
    nostrAuthState: document.getElementById("nostrAuthState"),
    nostrPubkey: document.getElementById("nostrPubkey"),
    linkNostrButton: document.getElementById("linkNostrButton"),
    nsecLinkPanel: document.getElementById("nsecLinkPanel"),
    linkNsecKey: document.getElementById("linkNsecKey"),
    linkNsecButton: document.getElementById("linkNsecButton"),
    nsecLinkHint: document.getElementById("nsecLinkHint"),
    remoteLinkPanel: document.getElementById("remoteLinkPanel"),
    linkBunkerUrl: document.getElementById("linkBunkerUrl"),
    linkRemoteButton: document.getElementById("linkRemoteButton"),
    linkRemoteQrButton: document.getElementById("linkRemoteQrButton"),
    linkRemoteQrPanel: document.getElementById("linkRemoteQrPanel"),
    linkRemoteQr: document.getElementById("linkRemoteQr"),
    linkRemoteQrStatus: document.getElementById("linkRemoteQrStatus"),
    linkRemoteQrCancel: document.getElementById("linkRemoteQrCancel"),
    remoteLinkHint: document.getElementById("remoteLinkHint"),
    nostrLinkStatus: document.getElementById("nostrLinkStatus"),
    signOut: document.getElementById("signOut"),
    refresh: document.getElementById("refresh"),
    greeting: document.getElementById("greeting"),
    todayLabel: document.getElementById("todayLabel"),
    merchantName: document.getElementById("merchantName"),
    merchantMeta: document.getElementById("merchantMeta"),
    accountAvatar: document.getElementById("accountAvatar"),
    topbarMerchant: document.getElementById("topbarMerchant"),
    topbarMeta: document.getElementById("topbarMeta"),
    balanceTotal: document.getElementById("balanceTotal"),
    balanceHint: document.getElementById("balanceHint"),
    chartBars: document.getElementById("chartBars"),
    chartEmpty: document.getElementById("chartEmpty"),
    chartTotal: document.getElementById("chartTotal"),
    paymentSearch: document.getElementById("paymentSearch"),
    statVolume: document.getElementById("statVolume"),
    statSuccess: document.getElementById("statSuccess"),
    statPending: document.getElementById("statPending"),
    statLedger: document.getElementById("statLedger"),
    ledgerDot: document.getElementById("ledgerDot"),
    ledgerStatus: document.getElementById("ledgerStatus"),
    statsRange: document.getElementById("statsRange"),
    settlementGross: document.getElementById("settlementGross"),
    settlementFees: document.getElementById("settlementFees"),
    settlementNet: document.getElementById("settlementNet"),
    settlementChip: document.getElementById("settlementChip"),
    settlementBar: document.getElementById("settlementBar"),
    settlementPeriod: document.getElementById("settlementPeriod"),
    settlementLead: document.getElementById("settlementLead"),
    reconcileForm: document.getElementById("reconcileForm"),
    reconcileFrom: document.getElementById("reconcileFrom"),
    reconcileTo: document.getElementById("reconcileTo"),
    reconcileSubmit: document.getElementById("reconcileSubmit"),
    reconcileStatus: document.getElementById("reconcileStatus"),
    copyOpenApiUrl: document.getElementById("copyOpenApiUrl"),
    apiReferenceSearch: document.getElementById("apiReferenceSearch"),
    apiReferenceCount: document.getElementById("apiReferenceCount"),
    apiReferenceStatus: document.getElementById("apiReferenceStatus"),
    apiReferenceGroups: document.getElementById("apiReferenceGroups"),
    reconcileNote: document.getElementById("reconcileNote"),
    reconciliationList: document.getElementById("reconciliationList"),
    reconciliationEmpty: document.getElementById("reconciliationEmpty"),
    planName: document.getElementById("planName"),
    planChip: document.getElementById("planChip"),
    planRevision: document.getElementById("planRevision"),
    planLimits: document.getElementById("planLimits"),
    planUpgradeActions: document.getElementById("planUpgradeActions"),
    planInvoicePanel: document.getElementById("planInvoicePanel"),
    planQr: document.getElementById("planQr"),
    planInvoiceStatus: document.getElementById("planInvoiceStatus"),
    planSettle: document.getElementById("planSettle"),
    planCancel: document.getElementById("planCancel"),
    planStatus: document.getElementById("planStatus"),
    balanceList: document.getElementById("balanceList"),
    workspaceOrg: document.getElementById("workspaceOrg"),
    workspaceMerchant: document.getElementById("workspaceMerchant"),
    routingChip: document.getElementById("routingChip"),
    routingList: document.getElementById("routingList"),
    workspaceBase: document.getElementById("workspaceBase"),
    workspaceLiveValue: document.getElementById("workspaceLiveValue"),
    sessionAuth: document.getElementById("sessionAuth"),
    sessionExpiry: document.getElementById("sessionExpiry"),
    sessionScopes: document.getElementById("sessionScopes"),
    sessionScopeCount: document.getElementById("sessionScopeCount"),
    paymentsBody: document.getElementById("paymentsBody"),
    paymentsEmpty: document.getElementById("paymentsEmpty"),
    paymentsStatus: document.getElementById("paymentsStatus"),
    paymentsMore: document.getElementById("paymentsMore"),
    recentList: document.getElementById("recentList"),
    recentEmpty: document.getElementById("recentEmpty"),
    filterTabs: document.getElementById("filterTabs"),
    createForm: document.getElementById("createForm"),
    amount: document.getElementById("amount"),
    amountError: document.getElementById("amountError"),
    createButton: document.getElementById("createButton"),
    createStatus: document.getElementById("createStatus"),
    createLead: document.getElementById("createLead"),
    createNote: document.getElementById("createNote"),
    preview: document.getElementById("preview"),
    previewQr: document.getElementById("previewQr"),
    previewAmount: document.getElementById("previewAmount"),
    previewReference: document.getElementById("previewReference"),
    previewInvoice: document.getElementById("previewInvoice"),
    copyPreview: document.getElementById("copyPreview"),
    openWallet: document.getElementById("openWallet"),
    openCheckout: document.getElementById("openCheckout"),
    addPaymentLinkButton: document.getElementById("addPaymentLinkButton"),
    paymentLinkForm: document.getElementById("paymentLinkForm"),
    paymentLinkSubmit: document.getElementById("paymentLinkSubmit"),
    paymentLinkCancel: document.getElementById("paymentLinkCancel"),
    paymentLinkStatus: document.getElementById("paymentLinkStatus"),
    linkAmount: document.getElementById("linkAmount"),
    linkAmountError: document.getElementById("linkAmountError"),
    newPaymentLinkPanel: document.getElementById("newPaymentLinkPanel"),
    newPaymentLinkUrl: document.getElementById("newPaymentLinkUrl"),
    copyPaymentLinkUrl: document.getElementById("copyPaymentLinkUrl"),
    openPaymentLink: document.getElementById("openPaymentLink"),
    paymentLinks: document.getElementById("paymentLinks"),
    profileForm: document.getElementById("profileForm"),
    profileName: document.getElementById("profileName"),
    profileNameError: document.getElementById("profileNameError"),
    profileEmail: document.getElementById("profileEmail"),
    profileWebsite: document.getElementById("profileWebsite"),
    profileStatus: document.getElementById("profileStatus"),
    profileSave: document.getElementById("profileSave"),
    teamCard: document.getElementById("teamCard"),
    teamChip: document.getElementById("teamChip"),
    memberForm: document.getElementById("memberForm"),
    memberPubkey: document.getElementById("memberPubkey"),
    memberPubkeyError: document.getElementById("memberPubkeyError"),
    memberRole: document.getElementById("memberRole"),
    memberLabel: document.getElementById("memberLabel"),
    memberSubmit: document.getElementById("memberSubmit"),
    memberStatus: document.getElementById("memberStatus"),
    locationsCard: document.getElementById("locationsCard"),
    locationsChip: document.getElementById("locationsChip"),
    locationForm: document.getElementById("locationForm"),
    locationName: document.getElementById("locationName"),
    locationCode: document.getElementById("locationCode"),
    locationError: document.getElementById("locationError"),
    locationSubmit: document.getElementById("locationSubmit"),
    locationStatus: document.getElementById("locationStatus"),
    locationList: document.getElementById("locationList"),
    locationSelect: document.getElementById("location"),
    memberList: document.getElementById("memberList"),
    profileStatusMessage: document.getElementById("profileStatusMessage"),
    profileNote: document.getElementById("profileNote"),
    apiKeys: document.getElementById("apiKeys"),
    keyHealthStrip: document.getElementById("keyHealthStrip"),
    createKeyButton: document.getElementById("createKeyButton"),
    keyForm: document.getElementById("keyForm"),
    keyLabel: document.getElementById("keyLabel"),
    keySubmit: document.getElementById("keySubmit"),
    keyExpiry: document.getElementById("keyExpiry"),
    keyCancel: document.getElementById("keyCancel"),
    keyStatus: document.getElementById("keyStatus"),
    healthAlertBanner: document.getElementById("healthAlertBanner"),
    healthAlertChips: document.getElementById("healthAlertChips"),
    riskLimitsCard: document.getElementById("riskLimitsCard"),
    riskStatusChip: document.getElementById("riskStatusChip"),
    riskDailyLabel: document.getElementById("riskDailyLabel"),
    riskDailyBar: document.getElementById("riskDailyBar"),
    riskVelocityLabel: document.getElementById("riskVelocityLabel"),
    riskVelocityBar: document.getElementById("riskVelocityBar"),
    riskMaxPayment: document.getElementById("riskMaxPayment"),
    riskFeeRate: document.getElementById("riskFeeRate"),
    auditLogCard: document.getElementById("auditLogCard"),
    auditFilterGroup: document.getElementById("auditFilterGroup"),
    auditLogList: document.getElementById("auditLogList"),
    auditLogEmpty: document.getElementById("auditLogEmpty"),
    scopeCount: document.getElementById("scopeCount"),
    eventCount: document.getElementById("eventCount"),
    keyPanel: document.getElementById("newKeyPanel"),
    keyValue: document.getElementById("newKeyValue"),
    copyNewKey: document.getElementById("copyNewKey"),
    webhookChip: document.getElementById("webhookChip"),
    addWebhookButton: document.getElementById("addWebhookButton"),
    webhookForm: document.getElementById("webhookForm"),
    webhookUrl: document.getElementById("webhookUrl"),
    webhookUrlError: document.getElementById("webhookUrlError"),
    webhookSubmit: document.getElementById("webhookSubmit"),
    webhookCancel: document.getElementById("webhookCancel"),
    webhookStatus: document.getElementById("webhookStatus"),
    newWebhookPanel: document.getElementById("newWebhookPanel"),
    newWebhookSecret: document.getElementById("newWebhookSecret"),
    copyWebhookSecret: document.getElementById("copyWebhookSecret"),
    webhookEndpoints: document.getElementById("webhookEndpoints"),
    webhookDeliveries: document.getElementById("webhookDeliveries"),
    drawer: document.getElementById("drawer"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    drawerBody: document.getElementById("drawerBody"),
    drawerClose: document.getElementById("drawerClose")
  };

  class ApiError extends Error {
    constructor(status, payload) {
      super(payload?.error?.message || `HTTP ${status}`);
      this.status = status;
      this.code = payload?.error?.code || "PAY_INTERNAL";
    }
  }

  async function api(path, options = {}) {
    const method = options.method || (options.body ? "POST" : "GET");
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (options.body) headers["content-type"] = "application/json";
    if (method !== "GET" && state.csrf) headers["x-pay-csrf"] = state.csrf;
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      if (
        response.status === 401 &&
        path !== "/console/api/session" &&
        path !== "/console/api/nostr/login" &&
        path !== "/console/api/nostr/enter"
      ) {
        showLogin(t("console.sessionExpired"));
      }
      throw new ApiError(response.status, payload);
    }
    return payload;
  }

  function hasScope(scope) {
    return Boolean(state.session && (state.session.scopes.includes("*") || state.session.scopes.includes(scope)));
  }

  function consoleModes() {
    const modes = state.consoleConfig?.modes;
    if (Array.isArray(modes) && modes.length) {
      return modes.filter((mode) => mode === "sandbox" || mode === "live");
    }
    return [state.consoleMode];
  }

  function isLiveConsole() {
    return state.consoleMode === "live";
  }

  function modeLabel(mode = state.consoleMode) {
    return t(mode === "live" ? "common.live" : "common.sandbox");
  }

  function setModeCopy(node, key) {
    if (!node) return;
    node.dataset.i18n = key;
    node.textContent = t(key);
  }

  function applyConsoleMode(mode) {
    const available = consoleModes();
    const next = available.includes(mode) ? mode : available[0] || "sandbox";
    state.consoleMode = next;
    const live = next === "live";
    document.body.dataset.consoleMode = next;
    document.title = t(live ? "meta.liveConsoleTitle" : "meta.consoleTitle");
    if (els.envChip) {
      els.envChip.textContent = modeLabel(next);
      els.envChip.classList.toggle("is-live", live);
    }
    document.querySelectorAll("[data-env-label]").forEach((node) => {
      node.textContent = modeLabel(next);
      node.classList.toggle("is-live", live);
    });
    if (els.envToggle) {
      const toggle = available.length > 1;
      els.envToggle.hidden = !toggle;
      els.envToggle.querySelectorAll("[data-console-mode]").forEach((button) => {
        const selected = button.dataset.consoleMode === next;
        button.setAttribute("aria-pressed", String(selected));
        button.textContent = modeLabel(button.dataset.consoleMode);
      });
    }
    if (els.envChip) {
      els.envChip.hidden = available.length > 1;
      els.envChip.classList.toggle("console-sandbox", available.length <= 1);
    }
    setModeCopy(els.brandLead, live ? "console.liveBrandLead" : "console.brandLead");
    setModeCopy(els.brandStep2, live ? "console.liveBrandStep2" : "console.brandStep2");
    setModeCopy(els.loginLead, live ? "console.liveLoginLead" : "console.loginLead");
    setModeCopy(els.keyLabel, live ? "console.liveKeyLabel" : "console.keyLabel");
    setModeCopy(els.securityNote, live ? "console.liveSecurityNote" : "console.securityNote");
    setModeCopy(els.createLead, live ? "console.liveCreateLead" : "console.createLead");
    setModeCopy(els.createNote, live ? "console.liveCreateNote" : "console.createNote");
    setModeCopy(els.balanceHint, live ? "console.liveBalanceHint" : "console.balanceHint");
    setModeCopy(els.settlementLead, live ? "console.liveSettlementLead" : "dash.settlementLead");
    setModeCopy(els.profileNote, "console.profileNote");
    if (els.workspaceLiveValue) {
      els.workspaceLiveValue.dataset.i18n = live
        ? "console.liveWorkspaceEnabled"
        : "console.workspaceDisabled";
      els.workspaceLiveValue.textContent = t(
        live ? "console.liveWorkspaceEnabled" : "console.workspaceDisabled"
      );
    }
    renderAuthMode();
    if (!state.session && live && els.apiKeyDetails) {
      els.apiKeyDetails.open = true;
    }
    if (state.session) {
      renderTopbarMode();
      renderPlan();
    }
  }

  async function loadConsoleConfig() {
    try {
      const config = await api("/console/api/config");
      state.consoleConfig = config;
      applyConsoleMode(config.default_mode || config.mode || "sandbox");
    } catch {
      state.consoleConfig = null;
      applyConsoleMode("sandbox");
    }
  }

  async function selectConsoleMode(mode) {
    if (!consoleModes().includes(mode) || mode === state.consoleMode) return;
    if (state.session) {
      const message = mode === "live"
        ? t("console.switchLiveConfirm")
        : t("console.switchSandboxConfirm");
      if (!window.confirm(message)) return;
      try {
        await api("/console/api/session", { method: "DELETE" });
      } catch {
        // The local view still resets below.
      }
      showLogin(t("console.modeSwitchSignIn"));
    }
    applyConsoleMode(mode);
    if (els.apiKey) els.apiKey.focus();
  }

  function nostrSignerAvailable() {
    return Boolean(
      window.nostr &&
        typeof window.nostr.getPublicKey === "function" &&
        typeof window.nostr.signEvent === "function"
    );
  }

  function shortPubkey(pubkey) {
    if (typeof pubkey !== "string" || pubkey.length < 16) return "—";
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
  }

  function nostrStateText(key) {
    const template = t("console.nostrLinkedAs");
    return template.replace("{key}", shortPubkey(key));
  }

  function authIdleKey(kind) {
    return state.authMode === "create" ? `console.${kind}Create` : `console.${kind}SignIn`;
  }

  function canGenerateKey() {
    return Boolean(
      state.onboardingEnabled &&
        !isLiveConsole() &&
        state.nostrConfig?.nsec &&
        window.PayNostrTools?.generateSecretKey &&
        window.PayNostrTools?.nsecEncode &&
        window.PayNostrTools?.npubEncode
    );
  }

  function npubFor(pubkey) {
    if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/.test(pubkey)) return "";
    try {
      return window.PayNostrTools?.npubEncode?.(pubkey) || "";
    } catch {
      return "";
    }
  }

  function renderAuthMode() {
    const enabled = state.onboardingEnabled && !isLiveConsole();
    if (!enabled) state.authMode = "signin";
    const creating = state.authMode === "create";
    const backupOpen = Boolean(state.generatedKey);
    const generating = creating && canGenerateKey();
    const titleKey = creating ? "console.authCreateTitle" : "console.authSignInTitle";
    els.authMode.hidden = !enabled;
    els.authModeHint.hidden = !enabled || backupOpen;
    const live = isLiveConsole();
    els.authModeHint.textContent = t(
      creating
        ? "console.createModeHint"
        : live
          ? "console.liveAuthHint"
          : "console.signInModeHint"
    );
    els.loginTitle.dataset.i18n = titleKey;
    els.loginTitle.textContent = t(titleKey);
    els.loginLead.dataset.i18n = creating
      ? "console.authCreateLead"
      : live
        ? "console.liveLoginLead"
        : "console.authSignInLead";
    els.loginLead.textContent = t(els.loginLead.dataset.i18n);
    els.signInMode.setAttribute("aria-pressed", String(!creating));
    els.createAccountMode.setAttribute("aria-pressed", String(creating));
    els.generateKeyPanel.hidden = !generating || backupOpen;
    els.backupPanel.hidden = !backupOpen;
    els.existingAuthPanel.hidden = backupOpen;
    els.existingDivider.hidden = !generating || backupOpen;
    els.nostrLoginButton.textContent = t(
      creating ? "console.nostrCreate" : "console.nostrSignIn"
    );
    els.nsecLoginButton.textContent = t(
      creating ? "console.nsecCreate" : "console.nsecContinue"
    );
    els.remoteLoginButton.textContent = t(
      creating ? "console.remoteCreate" : "console.remoteContinue"
    );
    const revealed = els.backupNsec.type === "text";
    els.revealNsecButton.textContent = t(
      revealed ? "console.backupHide" : "console.backupReveal"
    );
    els.revealNsecButton.dataset.i18n = revealed
      ? "console.backupHide"
      : "console.backupReveal";
    els.createWithKeyButton.disabled =
      !backupOpen || !els.backupAck.checked || state.creatingWithKey;
    els.workspaceDetails.hidden = !creating;
    if (creating && !backupOpen) els.workspaceDetails.open = true;
    els.apiKeyDetails.hidden = creating;
  }

  function clearGeneratedKey() {
    state.generatedKey = null;
    state.creatingWithKey = false;
    els.backupNsec.value = "";
    els.backupNpub.textContent = "";
    els.backupNsec.type = "password";
    els.revealNsecButton.setAttribute("aria-pressed", "false");
    els.revealNsecButton.textContent = t("console.backupReveal");
    els.revealNsecButton.dataset.i18n = "console.backupReveal";
    els.backupAck.checked = false;
    els.createWithKeyButton.disabled = true;
    els.backupError.hidden = true;
    els.backupError.textContent = "";
    setStatus(els.backupStatus, "");
  }

  function setAuthMode(mode) {
    const next = mode === "create" ? "create" : "signin";
    if (state.generatedKey && next !== state.authMode) clearGeneratedKey();
    state.authMode = next;
    renderAuthMode();
    if (state.authMode === "create" && !els.generateKeyPanel.hidden) {
      els.generateKeyButton.focus();
    }
  }

  function generateAccountKey() {
    els.loginAlert.hidden = true;
    els.loginAlert.textContent = "";
    if (!canGenerateKey()) {
      els.loginAlert.hidden = false;
      els.loginAlert.textContent = t("console.keygenUnavailable");
      return;
    }
    try {
      const secret = window.PayNostrTools.generateSecretKey();
      const nsec = window.PayNostrTools.nsecEncode(secret);
      const pubkey = window.PayNostrTools.getPublicKey(secret);
      const npub = window.PayNostrTools.npubEncode(pubkey);
      secret.fill(0);
      state.generatedKey = { nsec, pubkey, npub };
      els.backupNpub.textContent = npub;
      els.backupNsec.value = nsec;
      els.backupNsec.type = "password";
      els.revealNsecButton.setAttribute("aria-pressed", "false");
      els.backupAck.checked = false;
      els.backupError.hidden = true;
      els.backupError.textContent = "";
      setStatus(els.backupStatus, "");
      renderAuthMode();
      els.revealNsecButton.focus();
    } catch {
      els.loginAlert.hidden = false;
      els.loginAlert.textContent = t("console.keygenError");
    }
  }

  function toggleNsecVisibility() {
    const reveal = els.backupNsec.type === "password";
    els.backupNsec.type = reveal ? "text" : "password";
    els.revealNsecButton.setAttribute("aria-pressed", String(reveal));
    els.revealNsecButton.textContent = t(
      reveal ? "console.backupHide" : "console.backupReveal"
    );
    els.revealNsecButton.dataset.i18n = reveal
      ? "console.backupHide"
      : "console.backupReveal";
    els.backupNsec.focus();
  }

  function downloadGeneratedKey() {
    if (!state.generatedKey) {
      setStatus(els.backupStatus, t("console.backupMissing"), true);
      return;
    }
    const { nsec, npub } = state.generatedKey;
    const text = [
      "BitOS Pay — Nostr account backup",
      "",
      `Public key: ${npub}`,
      `Secret key: ${nsec}`,
      "",
      "This nsec controls the sandbox account created in the BitOS Pay console.",
      "Keep it offline and never share it. BitOS cannot recover a lost nsec.",
      "",
      `Created: ${new Date().toISOString()}`
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bitos-pay-nsec-${npub.slice(5, 13)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(els.backupStatus, t("console.backupDownloaded"));
  }

  async function createWithGeneratedKey() {
    if (!state.generatedKey || state.creatingWithKey) return;
    if (!els.backupAck.checked) {
      els.backupError.hidden = false;
      els.backupError.textContent = t("console.backupRequired");
      els.backupAck.focus();
      return;
    }
    state.creatingWithKey = true;
    els.backupError.hidden = true;
    setStatus(els.backupStatus, "");
    setButton(
      els.createWithKeyButton,
      true,
      "console.backupCreating",
      "console.backupCreate"
    );
    try {
      const challenge = await api("/console/api/nostr/challenge", { method: "POST" });
      const event = await signWithNsec(state.generatedKey.nsec, challenge);
      const result = await enterWithEvent(event);
      clearGeneratedKey();
      state.authMode = "signin";
      renderAuthMode();
      if (result.created) toast(t("console.accountCreated"));
    } catch (error) {
      els.backupError.hidden = false;
      els.backupError.textContent = error.message || t("console.nsecLoginError");
    } finally {
      state.creatingWithKey = false;
      setButton(
        els.createWithKeyButton,
        false,
        "console.backupCreating",
        "console.backupCreate"
      );
      els.createWithKeyButton.disabled =
        !state.generatedKey || !els.backupAck.checked;
    }
  }

  function renderNostr() {
    const config = state.nostrConfig || {};
    const available = Boolean(config.nip07) && nostrSignerAvailable();
    const session = state.session;
    if (!session) {
      els.nostrLoginButton.hidden = !available;
      els.remoteLoginToggle.hidden = !config.remote;
      els.nsecLoginToggle.hidden = !config.nsec;
      els.nostrLoginHelp.hidden = available;
      els.nostrLoginHelp.dataset.i18n = isLiveConsole()
        ? "console.liveNostrHelp"
        : "console.nostrNoExtension";
      els.nostrLoginHelp.textContent = t(els.nostrLoginHelp.dataset.i18n);
      els.workspaceDetails.hidden = !state.onboardingEnabled || isLiveConsole();
      els.nsecKey.disabled = !config.nsec;
      els.nsecLoginButton.disabled = !config.nsec;
      els.nsecLoginHint.hidden = Boolean(config.nsec);
      els.bunkerUrl.disabled = !config.remote;
      els.remoteLoginButton.disabled = !config.remote;
      els.remoteQrButton.disabled = !config.remote;
      els.remoteLoginHint.hidden = Boolean(config.remote);
      renderAuthMode();
      return;
    }
    els.nostrAuthState.textContent = "";
    els.nostrPubkey.textContent = "";
    els.linkNostrButton.hidden = true;
    els.nsecLinkPanel.hidden = true;
    els.remoteLinkPanel.hidden = true;
    const key = session.nostr_pubkey || session.linked_nostr_pubkey || state.linkedNostrPubkey;
    const linked = Boolean(key);
    if (session.auth_method === "nostr" && key) {
      els.nostrAuthState.textContent = nostrStateText(key);
      els.nostrPubkey.textContent = key;
    } else if (key) {
      els.nostrAuthState.textContent = t("console.nostrLinkedKey").replace("{key}", shortPubkey(key));
      els.nostrPubkey.textContent = key;
    } else {
      els.nostrAuthState.textContent = t("console.nostrLinkHint");
      els.nostrPubkey.textContent = "";
    }
    const canLink = !linked && session.auth_method !== "nostr" && hasScope("keys:write");
    els.linkNostrButton.hidden = !canLink || !available;
    els.nsecLinkPanel.hidden = !canLink;
    els.remoteLinkPanel.hidden = !canLink;
    els.linkNsecKey.disabled = !config.nsec;
    els.linkNsecButton.disabled = !config.nsec;
    els.nsecLinkHint.hidden = Boolean(config.nsec);
    els.linkBunkerUrl.disabled = !config.remote;
    els.linkRemoteButton.disabled = !config.remote;
    els.linkRemoteQrButton.disabled = !config.remote;
    els.remoteLinkHint.hidden = Boolean(config.remote);
  }

  async function loadOnboardingConfig() {
    try {
      const config = await api("/console/api/onboarding/config");
      state.onboardingEnabled = Boolean(config.enabled);
    } catch {
      state.onboardingEnabled = false;
    }
    renderNostr();
  }

  function workspaceNames() {
    const organizationName = els.onboardOrg.value.trim();
    const merchantName = els.onboardMerchant.value.trim();
    return {
      ...(organizationName.length >= 2 ? { organization_name: organizationName } : {}),
      ...(merchantName.length >= 2 ? { merchant_name: merchantName } : {})
    };
  }

  async function enterWithEvent(event) {
    const requestedCreate = state.authMode === "create";
    const result = await api("/console/api/nostr/enter", {
      body: { event, mode: state.consoleMode, ...workspaceNames() }
    });
    state.session = result;
    state.csrf = result.csrf_token;
    applyConsoleMode(result.livemode ? "live" : "sandbox");
    state.linkedNostrPubkey = result.nostr_pubkey;
    state.welcomeKey = result.created ? result.api_key : null;
    state.welcomeNpub = result.created ? npubFor(result.nostr_pubkey) : null;
    await loadOverview();
    if (requestedCreate && !result.created) toast(t("console.accountExists"));
    return result;
  }

  function renderWelcomeKey() {
    const key = state.welcomeKey;
    els.welcomeKeyPanel.hidden = !key;
    els.welcomeKeyValue.textContent = key || "";
    els.welcomeNpubLine.hidden = !state.welcomeNpub;
    els.welcomeNpub.textContent = state.welcomeNpub || "";
  }

  function dismissWelcomeKey() {
    state.welcomeKey = null;
    state.welcomeNpub = null;
    els.welcomeKeyValue.textContent = "";
    els.welcomeNpub.textContent = "";
    els.welcomeNpubLine.hidden = true;
    els.welcomeKeyPanel.hidden = true;
  }

  async function loadNostrConfig() {
    try {
      state.nostrConfig = await api("/console/api/nostr/config");
    } catch {
      state.nostrConfig = { nip07: true, nsec: false, remote: false, relay: null };
    }
    renderNostr();
  }

  function signWithNsec(nsec, challenge) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker("scripts/nostr-worker.js");
      } catch {
        reject(new Error(t("console.nsecLoginError")));
        return;
      }
      const timer = window.setTimeout(() => {
        worker.terminate();
        reject(new Error(t("console.nsecLoginError")));
      }, 15000);
      worker.onmessage = (message) => {
        window.clearTimeout(timer);
        worker.terminate();
        const result = message.data || {};
        if (result.ok) resolve(result.event);
        else reject(new Error(result.error || t("console.nsecLoginError")));
      };
      worker.onerror = () => {
        window.clearTimeout(timer);
        worker.terminate();
        reject(new Error(t("console.nsecLoginError")));
      };
      worker.postMessage({
        nsec,
        challenge: challenge.challenge,
        origin: challenge.origin
      });
    });
  }

  async function signRemoteChallenge(signer, challenge) {
    const pubkey = await signer.getPublicKey();
    const event = await signer.signEvent({
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", challenge.origin],
        ["challenge", challenge.challenge]
      ],
      content: ""
    });
    return { event, pubkey };
  }

  async function openRemoteQr(canvas, panel, qrStatus, statusNode, controller) {
    const tools = window.PayNostrTools;
    const relay = state.nostrConfig?.relay;
    if (!tools) throw new Error(t("console.remoteLoginError"));
    if (!relay) throw new Error(t("console.remoteNoRelay"));
    const clientSecretKey = tools.generateSecretKey();
    const clientPubkey = tools.getPublicKey(clientSecretKey);
    const uri = tools.createNostrConnectURI({
      clientPubkey,
      relays: [relay],
      secret: crypto.randomUUID(),
      perms: ["sign_event:22242"],
      name: "BitOS Pay console",
      url: location.origin
    });
    window.PayQr.draw(canvas, uri);
    panel.hidden = false;
    setStatus(qrStatus, t("console.remoteQrWait"));
    setStatus(statusNode, "");
    return await tools.BunkerSigner.fromURI(
      clientSecretKey,
      uri,
      {
        timeout: 90000,
        authTimeout: 300000,
        onauth: () => setStatus(qrStatus, t("console.remoteAuth"))
      },
      controller.signal
    );
  }

  async function signWithRemote(bunkerUrl, challenge, statusNode) {
    const tools = window.PayNostrTools;
    const relay = state.nostrConfig?.relay;
    if (!tools) throw new Error(t("console.remoteLoginError"));
    if (!relay) throw new Error(t("console.remoteNoRelay"));
    if (!/^bunker:\/\//i.test(bunkerUrl)) throw new Error(t("console.remoteRelayMismatch"));
    const pointer = await tools.parseBunkerInput(bunkerUrl);
    if (!pointer || !pointer.relays.length) throw new Error(t("console.remoteLoginError"));
    const allowed = new URL(relay).origin;
    if (pointer.relays.some((url) => new URL(url).origin !== allowed)) {
      throw new Error(t("console.remoteRelayMismatch"));
    }
    const signer = tools.BunkerSigner.fromBunker(tools.generateSecretKey(), pointer, {
      timeout: 90000,
      authTimeout: 300000,
      onauth: () => {
        setStatus(statusNode, t("console.remoteAuth"));
      }
    });
    try {
      await signer.connect({ name: "BitOS Pay console", url: location.origin });
      return await signRemoteChallenge(signer, challenge);
    } finally {
      await signer.close().catch(() => {});
    }
  }

  async function loginWithNsec() {
    if (els.nsecLoginButton.disabled) return;
    const nsec = els.nsecKey.value.trim();
    if (!nsec) {
      setStatus(els.nsecLoginStatus, t("console.nsecLoginError"), true);
      return;
    }
    setButton(els.nsecLoginButton, true, "console.nsecSigning", authIdleKey("nsec"));
    setStatus(els.nsecLoginStatus, "");
    try {
      const challenge = await api("/console/api/nostr/challenge", { method: "POST" });
      const signing = signWithNsec(nsec, challenge);
      els.nsecKey.value = "";
      const event = await signing;
      await enterWithEvent(event);
      setStatus(els.nostrLoginStatus, "");
    } catch (error) {
      setStatus(els.nsecLoginStatus, error.message || t("console.nsecLoginError"), true);
    } finally {
      els.nsecKey.value = "";
      setButton(els.nsecLoginButton, false, "console.nsecSigning", authIdleKey("nsec"));
    }
  }

  async function loginWithRemoteQr() {
    if (els.remoteQrButton.disabled) return;
    const controller = new AbortController();
    state.remoteQrAbort = controller;
    let signer = null;
    setButton(els.remoteQrButton, true, "console.remoteSigning", "console.remoteQr");
    setStatus(els.remoteLoginStatus, "");
    try {
      signer = await openRemoteQr(
        els.remoteQr,
        els.remoteQrPanel,
        els.remoteQrStatus,
        els.remoteLoginStatus,
        controller
      );
      const challenge = await api("/console/api/nostr/challenge", { method: "POST" });
      const { event } = await signRemoteChallenge(signer, challenge);
      els.remoteQrPanel.hidden = true;
      await enterWithEvent(event);
      setStatus(els.nostrLoginStatus, "");
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(els.remoteQrStatus, error.message || t("console.remoteQrError"), true);
      }
    } finally {
      if (signer) await signer.close().catch(() => {});
      state.remoteQrAbort = null;
      els.remoteQrPanel.hidden = true;
      setButton(els.remoteQrButton, false, "console.remoteSigning", "console.remoteQr");
    }
  }

  function cancelRemoteQr() {
    state.remoteQrAbort?.abort();
    state.remoteQrAbort = null;
    els.remoteQrPanel.hidden = true;
    els.linkRemoteQrPanel.hidden = true;
    setStatus(els.remoteQrStatus, "");
    setStatus(els.linkRemoteQrStatus, "");
  }

  async function loginWithRemote() {
    if (els.remoteLoginButton.disabled) return;
    const bunkerUrl = els.bunkerUrl.value.trim();
    if (!bunkerUrl) {
      setStatus(els.remoteLoginStatus, t("console.remoteLoginError"), true);
      return;
    }
    setButton(els.remoteLoginButton, true, "console.remoteSigning", authIdleKey("remote"));
    setStatus(els.remoteLoginStatus, "");
    try {
      const challenge = await api("/console/api/nostr/challenge", { method: "POST" });
      const { event } = await signWithRemote(bunkerUrl, challenge, els.remoteLoginStatus);
      els.bunkerUrl.value = "";
      await enterWithEvent(event);
      setStatus(els.nostrLoginStatus, "");
    } catch (error) {
      setStatus(els.remoteLoginStatus, error.message || t("console.remoteLoginError"), true);
    } finally {
      els.bunkerUrl.value = "";
      setButton(els.remoteLoginButton, false, "console.remoteSigning", authIdleKey("remote"));
    }
  }

  async function signNostrChallenge(challenge) {
    if (!nostrSignerAvailable()) throw new Error(t("console.nostrNoExtension"));
    const pubkey = await window.nostr.getPublicKey();
    if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/.test(pubkey)) {
      throw new Error("The Nostr signer returned an invalid public key.");
    }
    const event = await window.nostr.signEvent({
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", challenge.origin],
        ["challenge", challenge.challenge]
      ],
      content: ""
    });
    if (
      !event ||
      event.kind !== 22242 ||
      event.pubkey !== pubkey ||
      typeof event.id !== "string" ||
      typeof event.sig !== "string"
    ) {
      throw new Error("The Nostr signer returned an invalid challenge event.");
    }
    return event;
  }

  async function loginWithNostr() {
    if (els.nostrLoginButton.disabled) return;
    setButton(els.nostrLoginButton, true, "console.nostrSigningIn", authIdleKey("nostr"));
    setStatus(els.nostrLoginStatus, "");
    try {
      const challenge = await api("/console/api/nostr/challenge", { method: "POST" });
      const event = await signNostrChallenge(challenge);
      await enterWithEvent(event);
      setStatus(els.nostrLoginStatus, "");
    } catch (error) {
      setStatus(els.nostrLoginStatus, error.message || t("console.nostrLoginError"), true);
    } finally {
      setButton(els.nostrLoginButton, false, "console.nostrSigningIn", authIdleKey("nostr"));
    }
  }

  async function linkNostr() {
    if (els.linkNostrButton.disabled) return;
    setButton(els.linkNostrButton, true, "console.nostrLinking", "console.nostrLink");
    setStatus(els.nostrLinkStatus, "");
    try {
      const challenge = await api("/console/api/nostr/link", { method: "POST" });
      const event = await signNostrChallenge(challenge);
      const linked = await api("/console/api/nostr/link/proof", { body: { event } });
      state.linkedNostrPubkey = linked.pubkey;
      setStatus(els.nostrLinkStatus, t("console.nostrLinked"));
      renderNostr();
    } catch (error) {
      setStatus(els.nostrLinkStatus, error.message || t("console.nostrLoginError"), true);
    } finally {
      setButton(els.linkNostrButton, false, "console.nostrLinking", "console.nostrLink");
    }
  }

  function formatMsat(raw) {
    const msat = BigInt(raw);
    return formatSats(Number(msat) / 1000);
  }

  function statusKey(status) {
    switch (status) {
      case "SUCCEEDED":
        return "paid";
      case "PENDING":
        return "pending";
      case "EXPIRED":
        return "expired";
      case "FAILED":
        return "failed";
      case "CANCELLED":
        return "cancelled";
      default:
        return "created";
    }
  }

  function statusMarkup(status) {
    const key = statusKey(status);
    return `<span class="status status-${escapeHtml(key)}">${escapeHtml(t(`status.${key}`))}</span>`;
  }

  function shortId(value) {
    if (typeof value !== "string" || value.length < 14) return value || "—";
    return `${value.slice(0, 8)}…${value.slice(-4)}`;
  }

  function greetingKey() {
    const hour = new Date().getHours();
    if (hour < 12) return "console.greetingMorning";
    if (hour < 18) return "console.greetingAfternoon";
    return "console.greetingEvening";
  }

  function renderGreeting() {
    const key = greetingKey();
    els.greeting.dataset.i18n = key;
    els.greeting.textContent = t(key);
    els.todayLabel.textContent = new Intl.DateTimeFormat(lang() === "lo" ? "lo-LA" : "en-US", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(new Date());
  }

  function renderTopbarIdle() {
    els.topbarMerchant.textContent = t(
      isLiveConsole() ? "console.accountLive" : "console.accountSandbox"
    );
    els.topbarMeta.textContent = t("console.accountReference");
    els.accountAvatar.textContent = "BP";
  }

  function renderTopbarMode() {
    if (!state.session) return;
    els.topbarMeta.textContent = `${modeLabel()} · ${shortId(state.session.merchant.id)}`;
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function renderChart() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const days = [];
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - index);
      days.push({ date, paid: 0, pending: 0 });
    }
    const buckets = new Map(days.map((day) => [dayKey(day.date), day]));
    for (const payment of state.payments) {
      const created = new Date(payment.created_at);
      const bucket = buckets.get(dayKey(created));
      const amount = Number(payment.amount);
      if (!bucket || !Number.isFinite(amount)) continue;
      if (payment.status === "SUCCEEDED") bucket.paid += amount;
      if (payment.status === "PENDING") bucket.pending += amount;
    }
    const max = Math.max(...days.map((day) => day.paid + day.pending), 1);
    const weekday = new Intl.DateTimeFormat(lang() === "lo" ? "lo-LA" : "en-US", {
      weekday: "short"
    });
    const fullDate = new Intl.DateTimeFormat(lang() === "lo" ? "lo-LA" : "en-US", {
      day: "numeric",
      month: "short"
    });
    els.chartBars.innerHTML = days
      .map((day) => {
        const paid = Math.ceil((day.paid / max) * 20);
        const pending = Math.ceil((day.pending / max) * 20);
        const label = `${fullDate.format(day.date)}: ${formatSats(day.paid)} ${t("common.sats")} ${t("console.chartPaid").toLowerCase()}, ${formatSats(day.pending)} ${t("common.sats")} ${t("console.chartPending").toLowerCase()}`;
        return `
          <div class="chart-col" role="img" aria-label="${escapeHtml(label)}">
            <div class="chart-stack">
              <i class="bar bar-paid bar-level-${paid}"></i>
              <i class="bar bar-pending bar-level-${pending}"></i>
            </div>
            <small>${escapeHtml(weekday.format(day.date))}</small>
          </div>
        `;
      })
      .join("");
    const total = days.reduce((sum, day) => sum + day.paid + day.pending, 0);
    els.chartEmpty.hidden = total > 0;
    els.chartTotal.textContent = `${formatSats(total)} SAT`;
  }

  function showLogin(message = "") {
    state.session = null;
    state.csrf = "";
    state.overview = null;
    state.payments = [];
    state.query = "";
    document.body.classList.remove("is-authenticated");
    els.paymentSearch.value = "";
    els.consoleView.hidden = true;
    els.loginView.hidden = false;
    els.signOut.hidden = true;
    renderTopbarIdle();
    state.linkedNostrPubkey = null;
    els.loginError.hidden = true;
    els.loginError.textContent = "";
    els.loginAlert.hidden = !message;
    els.loginAlert.textContent = message || "";
    els.nostrLoginStatus.textContent = "";
    els.nsecLoginStatus.textContent = "";
    els.remoteLoginStatus.textContent = "";
    els.nsecKey.value = "";
    els.bunkerUrl.value = "";
    els.remoteQrPanel.hidden = true;
    els.linkRemoteQrPanel.hidden = true;
    state.planSubscriptionId = null;
    els.planInvoicePanel.hidden = true;
    state.remoteQrAbort?.abort();
    state.remoteQrAbort = null;
    state.welcomeKey = null;
    state.welcomeNpub = null;
    els.welcomeKeyPanel.hidden = true;
    els.welcomeKeyValue.textContent = "";
    els.welcomeNpub.textContent = "";
    els.welcomeNpubLine.hidden = true;
    clearGeneratedKey();
    state.authMode = "signin";
    els.remoteLoginPanel.hidden = true;
    els.nsecLoginPanel.hidden = true;
    els.onboardOrg.value = "";
    els.onboardMerchant.value = "";
    els.workspaceDetails.open = false;
    els.apiKeyDetails.open = false;
    renderNostr();
    if (!els.nostrLoginButton.hidden) els.nostrLoginButton.focus();
    else els.apiKey.focus();
  }

  const VIEWS = new Set(["overview", "payments", "developers", "settings"]);

  function viewFromHash() {
    const value = window.location.hash.replace(/^#\//, "");
    return VIEWS.has(value) ? value : "overview";
  }

  function setActiveNav(view, scrollTo) {
    document.querySelectorAll(".console-tabs a[data-view]").forEach((link) => {
      if (link.dataset.view === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.querySelectorAll(".console-rail .rail-link").forEach((link) => {
      const matchesScroll = Boolean(scrollTo && link.dataset.scrollTo === scrollTo);
      const matchesView = !scrollTo && link.dataset.nav === view;
      link.classList.toggle("is-active", matchesScroll || matchesView);
    });
  }

  function showView(view, options = {}) {
    const safe = VIEWS.has(view) ? view : "overview";
    document.querySelectorAll("[data-console-view]").forEach((page) => {
      page.hidden = page.dataset.consoleView !== safe;
    });
    const focus = state.pendingFocus;
    const scrollTo = state.pendingScroll;
    state.pendingFocus = null;
    state.pendingScroll = null;
    setActiveNav(safe, scrollTo);
    if (options.scroll !== false) {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      if (scrollTo) {
        document.getElementById(scrollTo)?.scrollIntoView({ behavior, block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior });
      }
    }
    if (focus) {
      window.requestAnimationFrame(() => {
        document.getElementById(focus)?.focus({ preventScroll: true });
      });
    }
  }

  function navigateTo(view, options = {}) {
    state.pendingFocus = options.focus || null;
    state.pendingScroll = options.scrollTo || null;
    const hash = `#/${view}`;
    if (window.location.hash === hash) showView(view);
    else window.location.hash = hash;
  }

  function showConsole() {
    document.body.classList.add("is-authenticated");
    els.loginView.hidden = true;
    els.consoleView.hidden = false;
    els.signOut.hidden = false;
    els.loginError.hidden = true;
    els.loginAlert.hidden = true;
    els.loginAlert.textContent = "";
    renderWelcomeKey();
    renderGreeting();
    showView(viewFromHash(), { scroll: false });
  }

  function setStatus(node, message, error = false) {
    node.textContent = message || "";
    node.classList.toggle("is-error", error);
  }

  function setButton(button, busy, busyKey, idleKey) {
    button.disabled = busy;
    button.textContent = busy ? t(busyKey) : t(idleKey);
  }

  function renderSession() {
    if (!state.session) return;
    const merchant = state.session.merchant;
    const name = merchant.name || "Sandbox workspace";
    els.merchantName.textContent = name;
    els.merchantMeta.textContent = `${merchant.id} · ${merchant.organization_id}`;
    els.topbarMerchant.textContent = name;
    els.topbarMeta.textContent = `${modeLabel()} · ${shortId(merchant.id)}`;
    els.workspaceOrg.textContent = merchant.organization_id;
    els.workspaceMerchant.textContent = merchant.id;
    els.workspaceBase.textContent = window.location.origin;
    els.accountAvatar.textContent = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "BP";
    const method =
      state.session.auth_method === "nostr"
        ? t("console.sessionAuthNostr")
        : t("console.sessionAuthKey");
    const signer = state.session.nostr_pubkey || state.session.linked_nostr_pubkey;
    els.sessionAuth.textContent = signer
      ? `${method} · ${shortPubkey(signer)}`
      : method;
    els.sessionExpiry.textContent = formatDateTime(state.session.expires_at);
    els.sessionScopeCount.textContent = String(state.session.scopes.length);
    els.sessionScopes.textContent = state.session.scopes.join(", ");
  }

  function renderStats() {
    const overview = state.overview;
    if (!overview) return;
    const settlement = overview.settlement;
    els.statVolume.textContent = formatSats(Number(settlement.gross));
    els.statSuccess.textContent = String(overview.stats.successful_recent);
    els.statPending.textContent = String(overview.stats.pending_recent);
    els.statsRange.textContent = `${overview.stats.payments_recent} recent`;
    els.statLedger.textContent = settlement.ledger_balanced ? t("console.balanced") : t("console.unbalanced");
    els.ledgerDot.classList.toggle("warn", !settlement.ledger_balanced);
    els.ledgerStatus.textContent = `${settlement.transaction_count} transactions`;
    els.settlementGross.textContent = `${formatSats(Number(settlement.gross))} SAT`;
    els.settlementFees.textContent = `${formatSats(Number(settlement.fees))} SAT`;
    els.settlementNet.textContent = `${formatSats(Number(settlement.net))} SAT`;
    els.settlementChip.textContent = settlement.ledger_balanced ? t("dash.reconciled") : t("console.unbalanced");
    els.settlementChip.className = `chip ${settlement.ledger_balanced ? "chip-ok" : "chip-warn"}`;
    els.settlementPeriod.textContent = `${formatDateTime(settlement.period_start)} → ${formatDateTime(settlement.period_end)}`;
    els.balanceTotal.textContent = formatSats(Number(settlement.net));
    const gross = Number(settlement.gross);
    const net = Number(settlement.net);
    const ratio = gross > 0 ? Math.max(0, Math.min(100, (net / gross) * 100)) : 0;
    els.settlementBar.value = Number(ratio.toFixed(1));
  }

  function renderBalances() {
    const balances = state.overview?.balances || [];
    if (!balances.length) {
      els.balanceList.innerHTML = `<p class="hint">${escapeHtml(t("console.noBalances"))}</p>`;
      return;
    }
    els.balanceList.innerHTML = balances
      .map(
        (line) => `
          <div class="wallet-card">
            <span class="wallet-mark" aria-hidden="true">SAT</span>
            <strong>${escapeHtml(formatMsat(line.balance_msat))}</strong>
            <small>${escapeHtml(line.account_code)}</small>
          </div>
        `
      )
      .join("");
  }

  function formatMessage(key, values) {
    return t(key).replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match
    );
  }

  function filteredPayments() {
    const query = state.query.trim().toLowerCase();
    return state.payments.filter((payment) => {
      if (!query) return true;
      const memo = typeof payment.metadata?.memo === "string" ? payment.metadata.memo : "";
      return `${payment.id} ${payment.external_reference || ""} ${memo}`.toLowerCase().includes(query);
    });
  }

  function renderPayments() {
    const visible = filteredPayments();
    els.paymentsBody.innerHTML = visible
      .map((payment) => {
        const memo = typeof payment.metadata?.memo === "string" ? payment.metadata.memo : "";
        return `
          <tr class="pay-row" data-payment-id="${escapeHtml(payment.id)}" tabindex="0">
            <td>
              <span class="pay-cell">
                <span class="pay-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
                </span>
                <span class="pay-copy">
                  <strong>${escapeHtml(payment.external_reference || "No reference")}</strong>
                  <small>${escapeHtml(payment.id)}</small>
                </span>
              </span>
            </td>
            <td class="pay-memo">${escapeHtml(memo || "—")}</td>
            <td class="amount-cell">${escapeHtml(formatSats(payment.amount))} <small>SAT</small></td>
            <td>${statusMarkup(payment.status)}</td>
            <td class="mono pay-date">${escapeHtml(formatDateTime(payment.created_at))}</td>
            <td class="row-actions">
              <button class="row-more" type="button" data-open-payment="${escapeHtml(payment.id)}" aria-label="${escapeHtml(t("console.openPayment"))}" title="${escapeHtml(t("console.openPayment"))}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
    els.paymentsEmpty.hidden = visible.length > 0;
    els.paymentsMore.hidden = !state.hasMorePayments;
    els.paymentsMore.disabled = false;
    els.paymentsMore.textContent = t("console.loadMore");
    els.paymentsStatus.textContent = formatMessage(
      state.hasMorePayments ? "console.showingPaymentsMore" : "console.showingPayments",
      { visible: visible.length, loaded: state.payments.length }
    );
  }

  function renderRecentPayments() {
    const recent = state.recentPayments;
    els.recentList.innerHTML = recent
      .map((payment) => {
        const memo = typeof payment.metadata?.memo === "string" ? payment.metadata.memo : "";
        return `
          <button class="recent-row" type="button" data-payment-id="${escapeHtml(payment.id)}">
            <span class="pay-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
            </span>
            <span class="recent-main">
              <strong>${escapeHtml(payment.external_reference || "No reference")}</strong>
              <small>${escapeHtml(memo || payment.id)}</small>
            </span>
            <span class="recent-amount">${escapeHtml(formatSats(payment.amount))} <small>SAT</small></span>
            ${statusMarkup(payment.status)}
          </button>
        `;
      })
      .join("");
    els.recentEmpty.hidden = recent.length > 0;
  }

  function renderHealthAndRisk() {
    const health = state.overview?.health;
    if (!health) {
      if (els.healthAlertBanner) els.healthAlertBanner.hidden = true;
      if (els.riskLimitsCard) els.riskLimitsCard.hidden = true;
      return;
    }

    const alerts = health.alerts || {};
    const alertChips = [];
    if (alerts.quarantined_payments > 0) {
      alertChips.push(`<span class="chip chip-warn">${escapeHtml(String(alerts.quarantined_payments))} quarantined</span>`);
    }
    if (alerts.dead_webhooks > 0) {
      alertChips.push(`<span class="chip chip-warn">${escapeHtml(String(alerts.dead_webhooks))} dead webhooks</span>`);
    }
    if (alerts.degraded_connections > 0) {
      alertChips.push(`<span class="chip chip-warn">${escapeHtml(String(alerts.degraded_connections))} degraded provider</span>`);
    }
    if (alerts.expiring_keys > 0) {
      alertChips.push(`<span class="chip chip-warn">${escapeHtml(String(alerts.expiring_keys))} expiring keys</span>`);
    }
    if (alerts.stale_keys > 0) {
      alertChips.push(`<span class="chip">${escapeHtml(String(alerts.stale_keys))} unused keys</span>`);
    }
    els.healthAlertChips.innerHTML = alertChips.join("");
    els.healthAlertBanner.hidden = alertChips.length === 0;

    const risk = health.risk || {};
    els.riskLimitsCard.hidden = false;
    els.riskStatusChip.textContent = health.merchant_status || "ACTIVE";
    els.riskStatusChip.className = `chip ${health.merchant_status === "ACTIVE" ? "chip-ok" : "chip-warn"}`;

    const dayUsed = Number(risk.day_volume_sat || 0);
    const dayLimit = Number(risk.daily_volume_limit_sat || 0);
    const dayPct = dayLimit > 0 ? Math.min(100, Math.round((dayUsed / dayLimit) * 100)) : 0;
    els.riskDailyLabel.textContent = `${formatSats(dayUsed)} / ${formatSats(dayLimit)} SAT`;
    els.riskDailyBar.value = dayPct;
    els.riskDailyBar.classList.toggle("is-warn", dayPct >= 80 && dayPct < 95);
    els.riskDailyBar.classList.toggle("is-danger", dayPct >= 95);

    const minUsed = Number(risk.minute_count || 0);
    const minLimit = Number(risk.max_payments_per_minute || 0);
    const minPct = minLimit > 0 ? Math.min(100, Math.round((minUsed / minLimit) * 100)) : 0;
    els.riskVelocityLabel.textContent = `${minUsed} / ${minLimit} req`;
    els.riskVelocityBar.value = minPct;
    els.riskVelocityBar.classList.toggle("is-warn", minPct >= 80 && minPct < 95);
    els.riskVelocityBar.classList.toggle("is-danger", minPct >= 95);

    els.riskMaxPayment.textContent = `${formatSats(Number(risk.max_payment_sat || 0))} SAT`;
    els.riskFeeRate.textContent = `${Number(risk.fee_bps || 0)} bps (${(Number(risk.fee_bps || 0) / 100).toFixed(2)}%)`;
  }

  function renderAuditLogs(entries) {
    if (!els.auditLogCard) return;
    if (!hasScope("keys:read")) {
      els.auditLogCard.hidden = true;
      return;
    }
    els.auditLogCard.hidden = false;
    const rows = entries || state.overview?.audit_logs || [];
    els.auditLogEmpty.hidden = rows.length > 0;
    els.auditLogList.innerHTML = rows
      .map(
        (entry) => `
          <div class="audit-row">
            <div>
              <strong>${escapeHtml(entry.action)}</strong>
              <span class="hint"> · <code>${escapeHtml(entry.target_ref)}</code></span>
            </div>
            <div class="hint">
              <span>${escapeHtml(entry.actor_ref)}</span> ·
              <span>${escapeHtml(entry.result)}</span> ·
              <span>${escapeHtml(formatDateTime(entry.occurred_at))}</span>
            </div>
          </div>
        `
      )
      .join("");
  }

  function renderKeys() {
    const overview = state.overview;
    const card = document.getElementById("api-keys");
    if (!overview || !hasScope("keys:read")) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    els.createKeyButton.hidden = !hasScope("keys:write");
    const keys = overview.api_keys || [];
    const nowMs = Date.now();
    let activeCount = 0;
    let expiringCount = 0;
    let staleCount = 0;
    let inactiveCount = 0;
    for (const key of keys) {
      const expired = Boolean(key.expires_at) && new Date(key.expires_at).getTime() <= nowMs;
      if (key.status !== "ACTIVE" || expired) {
        inactiveCount += 1;
        continue;
      }
      activeCount += 1;
      if (key.expires_at) {
        const remaining = new Date(key.expires_at).getTime() - nowMs;
        if (remaining > 0 && remaining <= 7 * 24 * 60 * 60 * 1000) expiringCount += 1;
      }
      const refMs = new Date(key.last_used_at || key.created_at).getTime();
      if (nowMs - refMs >= 30 * 24 * 60 * 60 * 1000) staleCount += 1;
    }
    els.keyHealthStrip.hidden = keys.length === 0;
    els.keyHealthStrip.innerHTML = `
      <div class="key-health-pill"><span>${escapeHtml(t("console.keyHealthActive"))}</span><strong>${activeCount}</strong></div>
      <div class="key-health-pill ${expiringCount > 0 ? "is-warn" : ""}"><span>${escapeHtml(t("console.keyHealthExpiring"))}</span><strong>${expiringCount}</strong></div>
      <div class="key-health-pill"><span>${escapeHtml(t("console.keyHealthStale"))}</span><strong>${staleCount}</strong></div>
      <div class="key-health-pill"><span>${escapeHtml(t("console.keyHealthInactive"))}</span><strong>${inactiveCount}</strong></div>
    `;
    if (!keys.length) {
      els.apiKeys.innerHTML = `<p class="hint">${escapeHtml(t("console.noKeys"))}</p>`;
      return;
    }
    els.apiKeys.innerHTML = keys
      .map((key) => {
        const current = key.id === state.session.api_key_id;
        const canManage = hasScope("keys:write") && key.status === "ACTIVE" && !current;
        const expired = Boolean(key.expires_at) && new Date(key.expires_at) <= new Date();
        const canRevoke = canManage;
        const canRotate = canManage && !expired;
        const inspect = `<button class="btn btn-glass btn-sm" type="button" data-inspect-key="${escapeHtml(key.id)}">${escapeHtml(t("console.keyInspect"))}</button>`;
        const revoke = canRevoke
          ? `<button class="btn btn-ghost btn-sm" type="button" data-revoke-key="${escapeHtml(key.id)}">${escapeHtml(t("console.revoke"))}</button>`
          : "";
        const rotate = canRotate
          ? `<button class="btn btn-ghost btn-sm" type="button" data-rotate-key="${escapeHtml(key.id)}">${escapeHtml(t("console.rotate"))}</button>`
          : "";
        const stateLabel = expired ? t("console.keyExpired") : key.status;
        const expiryLabel = key.expires_at
          ? `${t("console.keyExpires")} ${formatDateTime(key.expires_at)}`
          : t("console.keyNoExpiry");
        const labelHtml = key.label ? `<strong class="key-label-title">${escapeHtml(key.label)}</strong>` : "";
        const usedHtml = key.last_used_at ? ` · Last used ${formatDateTime(key.last_used_at)}` : "";
        return `
          <div class="console-key-row">
            <div class="console-key-meta">
              <div>${labelHtml}<code>${escapeHtml(key.key_prefix)}…</code></div>
              <span>${escapeHtml(key.scopes.join(", "))}</span>
              <span>${escapeHtml(stateLabel)} · ${escapeHtml(expiryLabel)}${escapeHtml(usedHtml)}${current ? ` · ${escapeHtml(t("console.currentKey"))}` : ""}</span>
            </div>
            <div class="console-key-actions">${inspect}${rotate}${revoke}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderLocations() {
    const locations = state.overview?.locations || [];
    const canManage = hasScope("merchants:write");
    els.locationsCard.hidden = !hasScope("payments:read");
    if (!els.locationsCard.hidden) {
      els.locationForm.hidden = !canManage;
      const active = locations.filter((location) => location.status === "ACTIVE");
      els.locationsChip.textContent = `${active.length} ${t("console.activeLocations")}`;
      els.locationList.innerHTML = locations.length
        ? locations
            .map((location) => {
              const actions = canManage
                ? ` <button class="btn btn-ghost btn-sm" type="button" data-location-action="rename" data-location-id="${escapeHtml(location.id)}">${escapeHtml(t("console.rename"))}</button>
                    <button class="btn btn-ghost btn-sm" type="button" data-location-action="toggle" data-location-id="${escapeHtml(location.id)}" data-location-active="${String(location.status === "ACTIVE")}">${escapeHtml(location.status === "ACTIVE" ? t("console.disable") : t("console.enable"))}</button>`
                : "";
              return `<li><strong>${escapeHtml(location.code)}</strong> · ${escapeHtml(location.name)} · ${escapeHtml(location.status)}${actions}</li>`;
            })
            .join("")
        : `<li>${escapeHtml(t("console.noLocations"))}</li>`;
    }
    const current = els.locationSelect.value;
    els.locationSelect.innerHTML = `<option value="">${escapeHtml(t("console.noLocation"))}</option>${locations
      .filter((location) => location.status === "ACTIVE")
      .map(
        (location) =>
          `<option value="${escapeHtml(location.id)}">${escapeHtml(location.code)} · ${escapeHtml(location.name)}</option>`
      )
      .join("")}`;
    if (Array.from(els.locationSelect.options).some((option) => option.value === current)) {
      els.locationSelect.value = current;
    }
  }

  async function createLocation(event) {
    event.preventDefault();
    const name = els.locationName.value.trim();
    const code = els.locationCode.value.trim().toUpperCase();
    const locationValid = Boolean(name) && /^[A-Z0-9_-]{2,24}$/.test(code);
    setControlValidity(els.locationCode, els.locationError, !locationValid);
    if (!locationValid) {
      (name ? els.locationCode : els.locationName).focus();
      return;
    }
    setStatus(els.locationStatus, "");
    setButton(els.locationSubmit, true, "console.addingLocation", "console.addLocation");
    try {
      await api("/console/api/locations", { body: { name, code } });
      els.locationForm.reset();
      await loadOverview();
      setStatus(els.locationStatus, t("console.locationAdded"));
    } catch (error) {
      setStatus(els.locationStatus, error.message || t("console.error"), true);
    } finally {
      setButton(els.locationSubmit, false, "console.addingLocation", "console.addLocation");
    }
  }

  function memberRoleLabel(role) {
    const key = {
      OWNER: "console.roleOwner",
      ADMIN: "console.roleAdmin",
      MANAGER: "console.roleManager",
      CASHIER: "console.roleCashier",
      VIEWER: "console.roleViewer"
    }[role];
    return key ? t(key) : role;
  }

  function renderMembers() {
    const canRead = hasScope("keys:read");
    els.teamCard.hidden = !canRead;
    if (!canRead) return;
    const members = state.overview?.members || [];
    const canManage = hasScope("keys:write");
    els.memberForm.hidden = !canManage;
    els.teamChip.textContent = `${members.length} ${t("console.membersCount")}`;
    if (!members.length) {
      els.memberList.innerHTML = `<li>${escapeHtml(t("console.noMembers"))}</li>`;
      return;
    }
    els.memberList.innerHTML = members
      .map((member) => {
        const active = member.status === "ACTIVE";
        const canRevoke = canManage && active && member.role !== "OWNER";
        const revoke = canRevoke
          ? ` <button class="btn btn-ghost btn-sm" type="button" data-revoke-member="${escapeHtml(member.id)}">${escapeHtml(t("console.revoke"))}</button>`
          : "";
        const label = member.label ? ` · ${escapeHtml(member.label)}` : "";
        return `<li><strong>${escapeHtml(memberRoleLabel(member.role))}</strong>${label} · <code>${escapeHtml(member.pubkey.slice(0, 12))}…</code> · ${escapeHtml(member.status)}${revoke}</li>`;
      })
      .join("");
  }

  async function inviteMember(event) {
    event.preventDefault();
    const pubkey = els.memberPubkey.value.trim().toLowerCase();
    const pubkeyValid = /^[0-9a-f]{64}$/.test(pubkey);
    setControlValidity(els.memberPubkey, els.memberPubkeyError, !pubkeyValid);
    if (!pubkeyValid) {
      els.memberPubkey.focus();
      return;
    }
    setStatus(els.memberStatus, "");
    setButton(els.memberSubmit, true, "console.inviting", "console.inviteMember");
    try {
      await api("/console/api/members", {
        body: {
          pubkey,
          role: els.memberRole.value,
          label: els.memberLabel.value.trim() || null
        }
      });
      els.memberForm.reset();
      els.memberRole.value = "CASHIER";
      await loadOverview();
      setStatus(els.memberStatus, t("console.memberInvited"));
    } catch (error) {
      setStatus(els.memberStatus, error.message || t("console.error"), true);
    } finally {
      setButton(els.memberSubmit, false, "console.inviting", "console.inviteMember");
    }
  }

  function renderProfile() {
    const merchant = state.overview?.merchant;
    if (!merchant) return;
    const canEdit = hasScope("merchants:write");
    els.profileName.value = merchant.name || "";
    els.profileEmail.value = merchant.support_email || "";
    els.profileWebsite.value = merchant.website || "";
    els.profileStatus.textContent = merchant.status || "—";
    for (const input of els.profileForm.querySelectorAll("input")) {
      input.disabled = !canEdit;
    }
    els.profileSave.hidden = !canEdit;
  }

  function renderPaymentLinks() {
    const links = state.overview?.payment_links || [];
    const canManage = hasScope("payments:write");
    els.addPaymentLinkButton.hidden = !canManage;
    if (!links.length) {
      els.paymentLinks.innerHTML = `<li>${escapeHtml(t("console.noPaymentLinks"))}</li>`;
      return;
    }
    els.paymentLinks.innerHTML = links
      .map((link) => {
        const disable = canManage && link.status === "ACTIVE"
          ? ` <button class="btn btn-ghost btn-sm" type="button" data-disable-payment-link="${escapeHtml(link.id)}">${escapeHtml(t("console.disableEndpoint"))}</button>`
          : "";
        return `
          <li>
            <strong>${escapeHtml(formatSats(link.amount))} SAT</strong>
            · ${escapeHtml(link.status)}
            ${link.label ? ` · ${escapeHtml(link.label)}` : ""}
            ${link.reference ? ` · ${escapeHtml(link.reference)}` : ""}
            <span class="console-key-actions">
              <a class="btn btn-ghost btn-sm" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(t("console.openPaymentLink"))}</a>
              <button class="btn btn-ghost btn-sm" type="button" data-copy-payment-link="${escapeHtml(link.url)}">${escapeHtml(t("common.copy"))}</button>
              ${disable}
            </span>
          </li>
        `;
      })
      .join("");
  }

  function resetWebhookForm() {
    state.editingWebhookId = null;
    els.webhookForm.reset();
    els.webhookUrl.readOnly = false;
    els.webhookSubmit.textContent = t("console.addEndpoint");
    els.webhookSubmit.dataset.i18n = "console.addEndpoint";
    els.webhookForm.hidden = true;
    setControlValidity(els.webhookUrl, els.webhookUrlError, false);
    setStatus(els.webhookStatus, "");
    updatePresetCount(els.webhookForm, els.eventCount);
    updateWebhookControls();
  }

  function openWebhookEditor(endpoint) {
    if (!endpoint) return;
    state.editingWebhookId = endpoint.id;
    els.webhookForm.hidden = false;
    els.webhookUrl.value = endpoint.url;
    els.webhookUrl.readOnly = true;
    els.webhookForm.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = endpoint.events.includes(input.value);
    });
    els.webhookSubmit.textContent = t("console.saveEvents");
    els.webhookSubmit.dataset.i18n = "console.saveEvents";
    setControlValidity(els.webhookUrl, els.webhookUrlError, false);
    setStatus(els.webhookStatus, "");
    updatePresetCount(els.webhookForm, els.eventCount);
    updateWebhookControls();
    els.webhookForm.querySelector('input[type="checkbox"]')?.focus();
  }

  function updateWebhookControls() {
    const canManage = hasScope("webhooks:write");
    const canRead = hasScope("webhooks:read");
    if (!canRead) els.webhookForm.hidden = true;
    els.addWebhookButton.hidden = !canManage || !els.webhookForm.hidden;
    els.webhookChip.textContent = canManage ? t("console.manage") : t("console.readOnly");
  }

  function renderWebhooks() {
    const webhooks = state.overview?.webhooks;
    const canManage = hasScope("webhooks:write");
    updateWebhookControls();
    if (!webhooks || !webhooks.read) {
      els.webhookEndpoints.innerHTML = `<li>${escapeHtml(t("console.noWebhooks"))}</li>`;
      els.webhookDeliveries.innerHTML = `<li>${escapeHtml(t("console.noDeliveries"))}</li>`;
      return;
    }
    els.webhookEndpoints.innerHTML = webhooks.endpoints.length
      ? webhooks.endpoints
          .map((endpoint) => {
            const disable = canManage && endpoint.status === "ACTIVE"
              ? ` <button class="btn btn-ghost btn-sm" type="button" data-disable-webhook="${escapeHtml(endpoint.id)}">${escapeHtml(t("console.disableEndpoint"))}</button>`
              : "";
            const rotate = canManage && endpoint.status === "ACTIVE"
              ? ` <button class="btn btn-ghost btn-sm" type="button" data-rotate-webhook="${escapeHtml(endpoint.id)}">${escapeHtml(t("console.rotateSecret"))}</button>`
              : "";
            const edit = canManage && endpoint.status === "ACTIVE"
              ? ` <button class="btn btn-ghost btn-sm" type="button" data-edit-webhook="${escapeHtml(endpoint.id)}">${escapeHtml(t("console.editEvents"))}</button>`
              : "";
            return `
              <li><strong>${escapeHtml(endpoint.status)}</strong> · ${escapeHtml(endpoint.url)} · ${escapeHtml(endpoint.events.join(", "))}${edit}${rotate}${disable}</li>
            `;
          })
          .join("")
      : `<li>${escapeHtml(t("console.noWebhooks"))}</li>`;
    els.webhookDeliveries.innerHTML = webhooks.deliveries.length
      ? webhooks.deliveries
          .map((delivery) => {
            const replay = canManage
              ? ` <button class="btn btn-ghost btn-sm" type="button" data-replay-delivery="${escapeHtml(delivery.id)}">${escapeHtml(t("console.replay"))}</button>`
              : "";
            return `
              <li><strong>${escapeHtml(delivery.status)}</strong> · ${escapeHtml(delivery.event_type)} · attempt ${escapeHtml(String(delivery.attempt))}${replay}</li>
            `;
          })
          .join("")
      : `<li>${escapeHtml(t("console.noDeliveries"))}</li>`;
  }

  function renderPermissions() {
    const canCreatePayment = hasScope("payments:write");
    document.getElementById("create").hidden = !canCreatePayment;
    document.querySelectorAll("[data-open-create]").forEach((node) => {
      node.hidden = !canCreatePayment;
    });
  }

  async function linkNsec() {
    if (els.linkNsecButton.disabled) return;
    const nsec = els.linkNsecKey.value.trim();
    if (!nsec) {
      setStatus(els.nostrLinkStatus, t("console.nsecLoginError"), true);
      return;
    }
    setButton(els.linkNsecButton, true, "console.nsecLinking", "console.nsecLink");
    setStatus(els.nostrLinkStatus, "");
    try {
      const challenge = await api("/console/api/nostr/link", { method: "POST" });
      const signing = signWithNsec(nsec, challenge);
      els.linkNsecKey.value = "";
      const event = await signing;
      const linked = await api("/console/api/nostr/link/proof", { body: { event } });
      state.linkedNostrPubkey = linked.pubkey;
      setStatus(els.nostrLinkStatus, t("console.nsecLinked"));
      renderNostr();
    } catch (error) {
      setStatus(els.nostrLinkStatus, error.message || t("console.nsecLoginError"), true);
    } finally {
      els.linkNsecKey.value = "";
      setButton(els.linkNsecButton, false, "console.nsecLinking", "console.nsecLink");
    }
  }

  async function linkRemote() {
    if (els.linkRemoteButton.disabled) return;
    const bunkerUrl = els.linkBunkerUrl.value.trim();
    if (!bunkerUrl) {
      setStatus(els.nostrLinkStatus, t("console.remoteLoginError"), true);
      return;
    }
    setButton(els.linkRemoteButton, true, "console.remoteLinking", "console.remoteLink");
    setStatus(els.nostrLinkStatus, "");
    try {
      const challenge = await api("/console/api/nostr/link", { method: "POST" });
      const { event } = await signWithRemote(bunkerUrl, challenge, els.nostrLinkStatus);
      els.linkBunkerUrl.value = "";
      const linked = await api("/console/api/nostr/link/proof", { body: { event } });
      state.linkedNostrPubkey = linked.pubkey;
      setStatus(els.nostrLinkStatus, t("console.remoteLinked"));
      renderNostr();
    } catch (error) {
      setStatus(els.nostrLinkStatus, error.message || t("console.remoteLoginError"), true);
    } finally {
      els.linkBunkerUrl.value = "";
      setButton(els.linkRemoteButton, false, "console.remoteLinking", "console.remoteLink");
    }
  }

  async function linkRemoteQr() {
    if (els.linkRemoteQrButton.disabled) return;
    const controller = new AbortController();
    state.remoteQrAbort = controller;
    let signer = null;
    setButton(els.linkRemoteQrButton, true, "console.remoteSigning", "console.remoteQr");
    setStatus(els.nostrLinkStatus, "");
    try {
      signer = await openRemoteQr(
        els.linkRemoteQr,
        els.linkRemoteQrPanel,
        els.linkRemoteQrStatus,
        els.nostrLinkStatus,
        controller
      );
      const challenge = await api("/console/api/nostr/link", { method: "POST" });
      const { event } = await signRemoteChallenge(signer, challenge);
      els.linkRemoteQrPanel.hidden = true;
      const linked = await api("/console/api/nostr/link/proof", { body: { event } });
      state.linkedNostrPubkey = linked.pubkey;
      setStatus(els.nostrLinkStatus, t("console.remoteLinked"));
      renderNostr();
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(els.nostrLinkStatus, error.message || t("console.remoteQrError"), true);
      }
    } finally {
      if (signer) await signer.close().catch(() => {});
      state.remoteQrAbort = null;
      els.linkRemoteQrPanel.hidden = true;
      setButton(els.linkRemoteQrButton, false, "console.remoteSigning", "console.remoteQr");
    }
  }

  function providerLabel(provider) {
    if (provider === "mock-lightning") return t("console.routingMock");
    if (provider === "lnbits") return t("console.routingLnbits");
    return provider;
  }

  function providerModeLabel(mode) {
    if (mode === "sandbox") return t("console.routingModeSandbox");
    if (mode === "live") return t("console.routingModeLive");
    return t("console.routingModeUnknown");
  }

  function providerStatus(status) {
    const labels = {
      ACTIVE: "console.routingStatusActive",
      UNVERIFIED: "console.routingStatusUnverified",
      DEGRADED: "console.routingStatusDegraded",
      DISABLED: "console.routingStatusDisabled"
    };
    const chip = status === "ACTIVE"
      ? "chip chip-ok"
      : status === "DISABLED"
        ? "chip"
        : "chip chip-warn";
    return { label: t(labels[status] || "console.routingStatusUnverified"), chip };
  }

  function renderConnections() {
    const connections = state.overview?.connections || [];
    const selected = connections.find((connection) => connection.selected);
    els.routingChip.textContent = selected
      ? t("console.routingActive")
      : t("console.routingNoRoute");
    els.routingChip.className = `chip ${selected ? "chip-ok" : "chip-warn"}`;
    if (!connections.length) {
      els.routingList.innerHTML = `<p class="hint">${escapeHtml(t("console.routingEmpty"))}</p>`;
      return;
    }
    els.routingList.innerHTML = connections
      .map((connection) => {
        const status = providerStatus(connection.status);
        return `
          <div class="routing-row">
            <div class="routing-main">
              <strong>${escapeHtml(providerLabel(connection.provider))}</strong>
              <small>${escapeHtml(providerModeLabel(connection.mode))} · ${escapeHtml(connection.id)}</small>
            </div>
            <div class="routing-badges">
              ${connection.selected ? `<span class="chip chip-brand">${escapeHtml(t("console.routingSelected"))}</span>` : ""}
              <span class="${status.chip}">${escapeHtml(status.label)}</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderPlan() {
    const entitlement = state.overview?.entitlement;
    els.planName.textContent = entitlement?.plan || "—";
    els.planChip.textContent = entitlement?.status || "—";
    els.planRevision.textContent = String(entitlement?.revision ?? 0);
    const limits = entitlement?.limits || {};
    els.planLimits.textContent = Object.entries(limits)
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");
    const live = isLiveConsole();
    const canUpgrade = hasScope("keys:write") && !live;
    els.planUpgradeActions.hidden = !canUpgrade;
    els.planUpgradeActions.querySelectorAll("[data-plan]").forEach((button) => {
      button.disabled = !canUpgrade || entitlement?.plan === button.dataset.plan;
    });
    if (live) {
      els.planInvoicePanel.hidden = true;
      state.planSubscriptionId = null;
      els.planStatus.textContent = t("console.livePlanUnavailable");
    } else if (els.planStatus.textContent === t("console.livePlanUnavailable")) {
      els.planStatus.textContent = "";
    }
  }

  async function upgradePlan(planCode) {
    if (!planCode) return;
    setStatus(els.planStatus, "");
    try {
      const result = await api("/console/api/subscriptions", {
        body: { plan_code: planCode }
      });
      state.planSubscriptionId = result.id;
      window.PayQr.draw(els.planQr, result.invoice.bolt11);
      els.planInvoicePanel.hidden = false;
      setStatus(els.planInvoiceStatus, t("console.planInvoiceCreated"));
    } catch (error) {
      setStatus(els.planStatus, error.message || t("console.planError"), true);
    }
  }

  async function settlePlanInvoice() {
    if (!state.planSubscriptionId) return;
    setButton(els.planSettle, true, "console.planSettling", "console.planSimulate");
    try {
      await api(`/console/api/subscriptions/${state.planSubscriptionId}/settle`, {
        method: "POST"
      });
      els.planInvoicePanel.hidden = true;
      state.planSubscriptionId = null;
      await loadOverview();
      setStatus(els.planStatus, t("console.planActivated"));
    } catch (error) {
      setStatus(els.planStatus, error.message || t("console.planError"), true);
    } finally {
      setButton(els.planSettle, false, "console.planSettling", "console.planSimulate");
    }
  }

  function cancelPlanInvoice() {
    state.planSubscriptionId = null;
    els.planInvoicePanel.hidden = true;
    setStatus(els.planInvoiceStatus, "");
  }

  function renderAll() {
    renderSession();
    renderGreeting();
    renderWelcomeKey();
    renderNostr();
    renderPermissions();
    renderHealthAndRisk();
    renderStats();
    renderBalances();
    renderPlan();
    renderProfile();
    renderMembers();
    renderLocations();
    renderConnections();
    renderPayments();
    renderRecentPayments();
    renderChart();
    renderKeys();
    renderPaymentLinks();
    renderReconciliations();
    renderApiReference();
    renderWebhooks();
    renderAuditLogs();
  }

  function apiReferenceGroup(path) {
    if (path.startsWith("/v1/payment-links")) return "Payment links";
    if (path.startsWith("/v1/payment-intents") || path === "/v1/payments") return "Payments";
    if (path.startsWith("/v1/checkout")) return "Hosted checkout";
    if (path.startsWith("/v1/invoices")) return "Invoices";
    if (path.startsWith("/v1/refunds")) return "Refunds";
    if (path.startsWith("/v1/settlements") || path.startsWith("/v1/transactions") || path.startsWith("/v1/balances")) return "Ledger";
    if (path.startsWith("/v1/webhook-endpoints")) return "Webhooks";
    if (path.startsWith("/v1/api-keys")) return "API keys";
    if (path.startsWith("/v1/merchants")) return "Merchant";
    if (path.startsWith("/v1/locations")) return "Locations";
    if (path.startsWith("/v1/quotes")) return "Quotes";
    if (path.startsWith("/v1/plans") || path.startsWith("/v1/subscriptions")) return "Plans";
    if (path.startsWith("/v1/onboarding")) return "Onboarding";
    if (path.startsWith("/v1/providers") || path.startsWith("/v1/sandbox")) return "Sandbox";
    return "Other";
  }

  function renderApiReference() {
    const document = state.apiReference;
    if (!document) return;
    const query = state.apiReferenceQuery.trim().toLowerCase();
    const groups = new Map();
    let total = 0;
    for (const [path, operations] of Object.entries(document.paths || {})) {
      for (const method of ["get", "post", "patch", "put", "delete"]) {
        const operation = operations?.[method];
        if (!operation) continue;
        const summary = operation.summary || "";
        const haystack = `${method} ${path} ${summary}`.toLowerCase();
        if (query && !haystack.includes(query)) continue;
        const group = apiReferenceGroup(path);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push({ method, path, summary });
        total += 1;
      }
    }
    els.apiReferenceCount.textContent = total === 1 ? t("console.apiReferenceOne") : `${total} ${t("console.apiReferenceCount")}`;
    els.apiReferenceStatus.textContent = total === 0 ? t("console.apiReferenceEmpty") : "";
    const ordered = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    els.apiReferenceGroups.innerHTML = ordered
      .map(([group, endpoints]) => {
        endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
        return `<section class="api-reference-group"><h3>${escapeHtml(group)}</h3><ul>${endpoints
          .map(
            (endpoint) =>
              `<li><span class="method method-${endpoint.method}">${endpoint.method.toUpperCase()}</span><code>${escapeHtml(endpoint.path)}</code><span class="api-summary">${escapeHtml(endpoint.summary)}</span></li>`
          )
          .join("")}</ul></section>`;
      })
      .join("");
  }

  async function loadApiReference() {
    setStatus(els.apiReferenceStatus, "");
    try {
      state.apiReference = await api("/openapi.json");
      renderApiReference();
    } catch (error) {
      setStatus(els.apiReferenceStatus, error.message || t("console.apiReferenceError"), true);
    }
  }

  function dateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function initReconcileDates() {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60_000);
    els.reconcileFrom.value = dateInputValue(weekAgo);
    els.reconcileTo.value = dateInputValue(today);
  }

  function renderReconciliations() {
    const records = state.overview?.reconciliations || [];
    const canManage = hasScope("payments:write");
    els.reconcileSubmit.disabled = !canManage;
    els.reconcileNote.textContent = canManage
      ? t("console.reconcileHint")
      : t("console.reconcileReadOnly");
    els.reconciliationEmpty.hidden = records.length > 0;
    els.reconciliationList.innerHTML = records
      .map((record) => {
        const balanced = record.ledger_balanced === true;
        const status = balanced ? t("dash.reconciled") : t("console.needsReview");
        const period = `${formatDateTime(record.period_start)} → ${formatDateTime(record.period_end)}`;
        return `<li><strong>${escapeHtml(record.id || "—")}</strong> · ${escapeHtml(period)} · ${formatSats(Number(record.net))} SAT · ${escapeHtml(String(record.transaction_count))} tx · <span class="chip ${balanced ? "chip-ok" : "chip-warn"}">${escapeHtml(status)}</span></li>`;
      })
      .join("");
  }

  async function runReconciliation(event) {
    event.preventDefault();
    const from = els.reconcileFrom.value;
    const to = els.reconcileTo.value;
    if (!from || !to) {
      setStatus(els.reconcileStatus, t("console.reconcileRangeRequired"), true);
      return;
    }
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      setStatus(els.reconcileStatus, t("console.reconcileInvalidRange"), true);
      return;
    }
    setStatus(els.reconcileStatus, "");
    setButton(els.reconcileSubmit, true, "console.reconciling", "console.runReconciliation");
    try {
      await api("/console/api/reconciliations", {
        body: {
          period_start: start.toISOString(),
          period_end: end.toISOString()
        }
      });
      await loadOverview();
      setStatus(els.reconcileStatus, t("console.reconcileDone"));
    } catch (error) {
      setStatus(els.reconcileStatus, error.message || t("console.reconcileError"), true);
    } finally {
      setButton(els.reconcileSubmit, false, "console.reconciling", "console.runReconciliation");
    }
  }

  async function loadOverview(options = {}) {
    const overview = await api("/console/api/overview");
    state.overview = overview;
    state.payments = overview.payments || [];
    state.recentPayments = (overview.payments || []).slice(0, 5);
    state.paymentCursor = overview.next_payment_cursor || null;
    state.hasMorePayments = Boolean(overview.has_more_payments);
    if (state.filter !== "all") await loadPaymentPage(false);
    if (state.session) {
      state.session.merchant = overview.merchant || state.session.merchant;
      state.session.scopes = overview.scopes || state.session.scopes;
      state.session.expires_at = overview.session_expires_at || state.session.expires_at;
    }
    showConsole();
    renderAll();
    if (options.notify) toast(t("console.refreshDone"));
  }

  async function loadSession() {
    setStatus(els.loginError, "");
    try {
      const session = await api("/console/api/session");
      state.session = session;
      state.csrf = session.csrf_token;
      applyConsoleMode(session.livemode ? "live" : "sandbox");
      await loadOverview();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        showLogin();
        return;
      }
      showLogin(t("console.error"));
    }
  }

  async function loadPaymentPage(append) {
    const request = ++state.paymentRequest;
    const status = { paid: "SUCCEEDED", pending: "PENDING", expired: "EXPIRED" }[state.filter];
    const params = new URLSearchParams({ limit: "20" });
    if (status) params.set("status", status);
    if (append && state.paymentCursor) params.set("starting_after", state.paymentCursor);
    const page = await api(`/console/api/payments?${params.toString()}`);
    if (request !== state.paymentRequest) return;
    const incoming = page.data || [];
    state.payments = append
      ? [...state.payments, ...incoming.filter((item) => !state.payments.some((current) => current.id === item.id))]
      : incoming;
    state.paymentCursor = page.next_cursor || null;
    state.hasMorePayments = Boolean(page.has_more);
  }

  async function setFilter(next) {
    state.filter = next;
    els.filterTabs.querySelectorAll("[data-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filter === next));
    });
    try {
      await loadPaymentPage(false);
      renderPayments();
    } catch (error) {
      toast(error.message || t("console.error"));
    }
  }

  async function loadMorePayments() {
    if (!state.hasMorePayments) return;
    els.paymentsMore.disabled = true;
    els.paymentsMore.textContent = t("console.loadingMore");
    try {
      await loadPaymentPage(true);
      renderPayments();
    } catch (error) {
      toast(error.message || t("console.error"));
      els.paymentsMore.disabled = false;
      els.paymentsMore.textContent = t("console.loadMore");
    }
  }

  async function openKeyInspector(keyId, trigger) {
    state.lastTrigger = trigger || null;
    window.clearTimeout(state.closeTimer);
    try {
      const telemetry = await api(`/console/api/api-keys/${encodeURIComponent(keyId)}/telemetry?hours=24`);
      const k = telemetry.key;
      const totals = telemetry.totals || {};
      const buckets = telemetry.buckets || [];
      const maxBucket = Math.max(1, ...buckets.map((b) => Number(b.total_count || 0)));
      const highPriv = new Set(["payments:refund", "keys:write", "merchants:write", "*"]);
      const scopeBadges = (k.scopes || [])
        .map((s) => `<span class="chip ${highPriv.has(s) ? "chip-warn" : ""}">${escapeHtml(s)}</span>`)
        .join("");
      const barsHtml = buckets.length
        ? `<div class="telemetry-bars">${buckets
            .map((b) => {
              const pct = Math.max(10, Math.round((Number(b.total_count || 0) / maxBucket) * 100));
              const hasErr = (b.auth_error_count || 0) + (b.rate_limit_count || 0) + (b.server_error_count || 0) > 0;
              return `<div class="telemetry-bar ${hasErr ? "has-errors" : ""}" style="height:${pct}%" title="${escapeHtml(formatDateTime(b.bucket_start))}: ${b.total_count} req"></div>`;
            })
            .join("")}</div>`
        : `<p class="hint">No API requests recorded in the last 24 hours.</p>`;
      const auditHtml = (telemetry.recent_audit || []).length
        ? `<div class="audit-list">${telemetry.recent_audit
            .map(
              (a) => `<div class="audit-row"><strong>${escapeHtml(a.action)}</strong><span class="hint">${escapeHtml(a.result)} · ${escapeHtml(formatDateTime(a.occurred_at))}</span></div>`
            )
            .join("")}</div>`
        : `<p class="hint">${escapeHtml(t("console.auditEmpty"))}</p>`;

      const drawerTitle = document.getElementById("drawerTitle");
      if (drawerTitle) drawerTitle.textContent = t("console.keyTelemetryTitle");
      const canRename = hasScope("keys:write");
      els.drawerBody.innerHTML = `
        <div class="detail-section">
          <div class="settlement-row"><span>ID</span><code class="mono">${escapeHtml(k.id)}</code></div>
          <div class="settlement-row"><span>Prefix</span><code class="mono">${escapeHtml(k.key_prefix)}…</code></div>
          <div class="settlement-row"><span>Status</span><strong>${escapeHtml(k.status)}</strong></div>
          <div class="settlement-row"><span>Last used</span><strong>${escapeHtml(k.last_used_at ? formatDateTime(k.last_used_at) : "Never")}</strong></div>
          <div class="settlement-row"><span>Expires</span><strong>${escapeHtml(k.expires_at ? formatDateTime(k.expires_at) : t("console.keyNoExpiry"))}</strong></div>
        </div>
        ${
          canRename
            ? `<form id="keyRenameForm" class="refund-form">
                <div class="field">
                  <label for="keyRenameInput">${escapeHtml(t("console.keyLabel"))}</label>
                  <input id="keyRenameInput" type="text" maxlength="80" value="${escapeHtml(k.label || "")}" placeholder="e.g. BNOS Checkout Prod" />
                </div>
                <div class="preview-actions">
                  <button class="btn btn-primary btn-sm" type="submit">${escapeHtml(t("console.keySaveLabel"))}</button>
                </div>
                <p class="console-status" id="keyRenameStatus" role="status" aria-live="polite"></p>
              </form>`
            : ""
        }
        <div class="detail-section">
          <h3>${escapeHtml(t("console.scopes"))}</h3>
          <div class="drawer-scope-list">${scopeBadges}</div>
        </div>
        <div class="detail-section">
          <h3>${escapeHtml(t("console.keyUsage24h"))}</h3>
          <div class="telemetry-grid">
            <div class="telemetry-stat"><span>${escapeHtml(t("console.keyRequests"))}</span><strong>${Number(totals.total_count || 0)}</strong></div>
            <div class="telemetry-stat"><span>${escapeHtml(t("console.keySuccess"))}</span><strong>${Number(totals.success_count || 0)}</strong></div>
            <div class="telemetry-stat"><span>${escapeHtml(t("console.keyAuthErrors"))}</span><strong>${Number(totals.auth_error_count || 0)}</strong></div>
            <div class="telemetry-stat"><span>${escapeHtml(t("console.keyRateLimited"))}</span><strong>${Number(totals.rate_limit_count || 0)}</strong></div>
          </div>
          ${barsHtml}
          <p class="hint">${escapeHtml(t("console.keyLastEndpoint"))}: <code>${escapeHtml(totals.last_endpoint || "—")}</code></p>
        </div>
        <div class="detail-section">
          <h3>${escapeHtml(t("console.auditTitle"))}</h3>
          ${auditHtml}
        </div>
      `;
      els.drawer.hidden = false;
      els.drawerBackdrop.hidden = false;
      document.body.classList.add("drawer-open");
      requestAnimationFrame(() => els.drawer.classList.add("is-open"));
      state.drawerOpen = true;
      const renameForm = document.getElementById("keyRenameForm");
      if (renameForm) {
        renameForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const input = document.getElementById("keyRenameInput");
          const statusEl = document.getElementById("keyRenameStatus");
          try {
            await api(`/console/api/api-keys/${encodeURIComponent(k.id)}`, {
              method: "PATCH",
              body: { label: input.value.trim() || null }
            });
            setStatus(statusEl, t("console.keyLabelSaved"));
            await loadOverview();
          } catch (err) {
            setStatus(statusEl, err.message || t("console.error"), true);
          }
        });
      }
      els.drawerClose.focus();
    } catch (error) {
      setStatus(els.keyStatus, error.message || t("console.error"), true);
    }
  }

  function openDrawer(payment, trigger) {
    state.lastTrigger = trigger || null;
    window.clearTimeout(state.closeTimer);
    const drawerTitle = document.getElementById("drawerTitle");
    if (drawerTitle) drawerTitle.textContent = t("detail.title");
    els.drawerBody.innerHTML = renderDrawer(payment);
    els.drawer.hidden = false;
    els.drawerBackdrop.hidden = false;
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => els.drawer.classList.add("is-open"));
    state.drawerOpen = true;
    const copy = els.drawerBody.querySelector("[data-copy-invoice]");
    if (copy) bindCopy(copy, () => payment.invoice?.bolt11 || "");
    bindRefundForm(payment);
    bindCancelPayment(payment);
    els.drawerClose.focus();
  }

  function closeDrawer() {
    if (!state.drawerOpen) return;
    state.drawerOpen = false;
    els.drawer.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    state.closeTimer = window.setTimeout(() => {
      els.drawer.hidden = true;
      els.drawerBackdrop.hidden = true;
      if (state.lastTrigger && document.contains(state.lastTrigger)) state.lastTrigger.focus();
    }, 220);
  }

  function bindRefundForm(payment) {
    const form = els.drawerBody.querySelector("[data-refund-form]");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const amount = Number(form.querySelector("[data-refund-amount]").value);
      const reason = form.querySelector("[data-refund-reason]").value.trim();
      const status = form.querySelector("[data-refund-status]");
      const submit = form.querySelector("[data-refund-submit]");
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > payment.refundable) {
        setStatus(status, t("console.refundInvalid"), true);
        return;
      }
      submit.disabled = true;
      setStatus(status, "");
      try {
        await api("/console/api/refunds", {
          body: {
            transaction_id: payment.transaction.id,
            amount,
            reason: reason || null
          },
          headers: { "idempotency-key": crypto.randomUUID() }
        });
        const detail = await api(
          `/console/api/payment-intents/${encodeURIComponent(payment.id)}`
        );
        openDrawer(detail, state.lastTrigger);
        toast(t("console.refundRecorded"));
      } catch (error) {
        setStatus(status, error.message || t("console.error"), true);
        submit.disabled = false;
      }
    });
  }

  function bindCancelPayment(payment) {
    const button = els.drawerBody.querySelector("[data-cancel-payment]");
    if (!button) return;
    button.addEventListener("click", async () => {
      if (!window.confirm(t("console.cancelPaymentConfirm"))) return;
      button.disabled = true;
      try {
        await api(`/console/api/payment-intents/${encodeURIComponent(payment.id)}/cancel`, {
          method: "POST"
        });
        closeDrawer();
        await loadOverview();
        toast(t("console.paymentCancelled"));
      } catch (error) {
        toast(error.message || t("console.error"));
        button.disabled = false;
      }
    });
  }

  function renderDrawer(payment) {
    const invoice = payment.invoice?.bolt11 || "";
    const transaction = payment.transaction;
    const canCancel = hasScope("payments:write") && (payment.status === "CREATED" || payment.status === "PENDING");
    return `
      ${statusMarkup(payment.status)}
      <div class="drawer-amount">${escapeHtml(formatSats(payment.amount))}<small>SAT</small></div>
      <p class="hint">${escapeHtml(payment.external_reference || "No reference")} · ${escapeHtml(payment.id)}</p>
      <div class="detail-list">
        <div class="detail-row"><span>${escapeHtml(t("detail.created"))}</span><strong>${escapeHtml(formatDateTime(payment.created_at))}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.expires"))}</span><strong>${escapeHtml(formatDateTime(payment.expires_at))}</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.method"))}</span><strong>lightning</strong></div>
        <div class="detail-row"><span>${escapeHtml(t("detail.delivery"))}</span><strong>${escapeHtml(payment.attempt?.status || "—")}</strong></div>
        ${transaction ? `<div class="detail-row"><span>Transaction</span><strong>${escapeHtml(transaction.id)}</strong></div>` : ""}
        ${transaction ? `<div class="detail-row"><span>${escapeHtml(t("detail.fee"))}</span><strong>${escapeHtml(formatMsat(transaction.fee_msat))} SAT</strong></div>` : ""}
        ${transaction ? `<div class="detail-row"><span>${escapeHtml(t("detail.net"))}</span><strong>${escapeHtml(formatMsat(transaction.net_msat))} SAT</strong></div>` : ""}
      </div>
      <div class="detail-section">
        <h3>${escapeHtml(t("detail.invoice"))}</h3>
        <div class="invoice">
          <code>${escapeHtml(invoice || "—")}</code>
          <button class="btn btn-glass btn-sm" type="button" data-copy-invoice>${escapeHtml(t("detail.copyInvoice"))}</button>
        </div>
      </div>
      ${payment.refunds?.length ? `
      <div class="detail-section">
        <h3>${escapeHtml(t("console.refunds"))}</h3>
        <div class="refund-list">
          ${payment.refunds.map((refund) => `
            <div class="refund-row">
              <strong>${escapeHtml(formatSats(refund.amount))} SAT</strong>
              <span>${escapeHtml(refund.status)} · ${escapeHtml(formatDateTime(refund.created_at))}${refund.reason ? ` · ${escapeHtml(refund.reason)}` : ""}</span>
            </div>
          `).join("")}
        </div>
      </div>` : ""}
      ${!isLiveConsole() && hasScope("payments:refund") && transaction?.status === "SETTLED" && payment.refundable > 0 ? `
      <div class="detail-section">
        <h3>${escapeHtml(t("console.refund"))}</h3>
        <div class="detail-note">${escapeHtml(t("console.refundable"))}: ${escapeHtml(formatSats(payment.refundable))} SAT</div>
        <form class="refund-form" data-refund-form novalidate>
          <div class="field">
            <label for="refundAmount">${escapeHtml(t("console.refundAmount"))}</label>
            <input id="refundAmount" data-refund-amount type="number" inputmode="numeric" min="1" max="${payment.refundable}" step="1" value="${payment.refundable}" required />
          </div>
          <div class="field">
            <label for="refundReason">${escapeHtml(t("console.refundReason"))}</label>
            <input id="refundReason" data-refund-reason type="text" maxlength="200" />
          </div>
          <div class="preview-actions">
            <button class="btn btn-primary btn-sm" type="submit" data-refund-submit>${escapeHtml(t("console.refund"))}</button>
          </div>
          <p class="console-status" data-refund-status role="status" aria-live="polite"></p>
        </form>
      </div>` : ""}
      ${isLiveConsole() && hasScope("payments:refund") && transaction?.status === "SETTLED" && payment.refundable > 0 ? `
      <div class="detail-section">
        <h3>${escapeHtml(t("console.refund"))}</h3>
        <div class="detail-note">${escapeHtml(t("console.liveRefundUnavailable"))}</div>
      </div>` : ""}
      ${canCancel ? `
      <div class="detail-section">
        <h3>${escapeHtml(t("console.cancelPayment"))}</h3>
        <div class="detail-note">${escapeHtml(t("console.cancelPaymentNote"))}</div>
        <button class="btn btn-glass btn-sm" type="button" data-cancel-payment>${escapeHtml(t("console.cancelPayment"))}</button>
      </div>` : ""}
      ${payment.checkout_url ? `
      <div class="detail-section">
        <h3>${escapeHtml(t("console.openCheckout"))}</h3>
        <div class="detail-note">${escapeHtml(t("console.checkoutNote"))}</div>
        <a class="btn btn-glass btn-sm" href="${escapeHtml(payment.checkout_url)}" target="_blank" rel="noopener">${escapeHtml(t("console.openCheckout"))}</a>
      </div>` : ""}
      <div class="detail-section">
        <h3>${escapeHtml(t("detail.ledger"))}</h3>
        <div class="detail-note">${escapeHtml(t("detail.ledgerNote"))}</div>
      </div>
    `;
  }

  async function openPayment(id, trigger) {
    try {
      const detail = await api(`/console/api/payment-intents/${encodeURIComponent(id)}`);
      openDrawer({ ...detail, invoice: detail.invoice, attempt: detail.attempt, transaction: detail.transaction }, trigger);
    } catch (error) {
      toast(error.message || t("console.error"));
    }
  }

  function validateAmount(raw) {
    const amount = Number(raw);
    return Number.isSafeInteger(amount) && amount >= 1 && amount <= 100_000_000;
  }

  function setControlValidity(control, message, invalid) {
    if (control) {
      if (invalid) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
    if (message) message.hidden = !invalid;
  }

  const SCOPE_PRESETS = {
    recommended: ["payments:read", "payments:write", "payments:refund", "webhooks:read", "webhooks:write", "quotes:read"]
  };

  const EVENT_PRESETS = {
    recommended: ["payment.succeeded", "payment.failed", "payment.expired", "refund.succeeded"]
  };

  function presetValues(container, preset, recommended) {
    if (preset === "none") return [];
    if (preset === "recommended") return recommended;
    return Array.from(container.querySelectorAll('input[type="checkbox"]')).map((input) => input.value);
  }

  function applyCheckboxPreset(container, preset, recommended) {
    if (!container) return;
    const values = new Set(presetValues(container, preset, recommended));
    container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = values.has(input.value);
    });
  }

  function updatePresetCount(container, target) {
    if (!container || !target) return;
    const count = container.querySelectorAll('input[type="checkbox"]:checked').length;
    target.textContent = count ? `${count} ${t("console.scopeCount")}` : "";
  }

  function bindPresetButtons(selector, container, recommended, target) {
    document.querySelectorAll(selector).forEach((button) => {
      button.addEventListener("click", () => {
        applyCheckboxPreset(container, button.dataset.scopePreset || button.dataset.eventPreset, recommended);
        updatePresetCount(container, target);
      });
    });
    container?.addEventListener("change", () => updatePresetCount(container, target));
  }

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.loginButton.disabled) return;
    const key = els.apiKey.value.trim();
    if (key.length < 20) {
      setStatus(els.loginError, t("console.loginError"), true);
      els.apiKey.focus();
      return;
    }
    setButton(els.loginButton, true, "console.signingIn", "console.signIn");
    try {
      const session = await api("/console/api/session", {
        body: { api_key: key, mode: state.consoleMode }
      });
      els.apiKey.value = "";
      state.session = session;
      state.csrf = session.csrf_token;
      applyConsoleMode(session.livemode ? "live" : "sandbox");
      await loadOverview();
    } catch (error) {
      setStatus(els.loginError, error.message || t("console.loginError"), true);
      els.apiKey.focus();
    } finally {
      setButton(els.loginButton, false, "console.signingIn", "console.signIn");
    }
  });

  els.planUpgradeActions.querySelectorAll("[data-plan]").forEach((button) => {
    button.addEventListener("click", () => upgradePlan(button.dataset.plan));
  });
  els.planSettle.addEventListener("click", settlePlanInvoice);
  els.planCancel.addEventListener("click", cancelPlanInvoice);
  els.signInMode.addEventListener("click", () => setAuthMode("signin"));
  els.createAccountMode.addEventListener("click", () => setAuthMode("create"));
  els.generateKeyButton.addEventListener("click", generateAccountKey);
  els.generateAgainButton.addEventListener("click", () => {
    clearGeneratedKey();
    generateAccountKey();
  });
  els.revealNsecButton.addEventListener("click", toggleNsecVisibility);
  els.downloadNsecButton.addEventListener("click", downloadGeneratedKey);
  els.createWithKeyButton.addEventListener("click", createWithGeneratedKey);
  els.backupAck.addEventListener("change", () => {
    els.createWithKeyButton.disabled =
      !els.backupAck.checked || state.creatingWithKey;
  });
  els.remoteLoginToggle.addEventListener("click", () => {
    els.remoteLoginPanel.hidden = !els.remoteLoginPanel.hidden;
    if (!els.remoteLoginPanel.hidden) els.bunkerUrl.focus();
  });
  els.nsecLoginToggle.addEventListener("click", () => {
    els.nsecLoginPanel.hidden = !els.nsecLoginPanel.hidden;
    if (!els.nsecLoginPanel.hidden) els.nsecKey.focus();
  });
  els.dismissWelcomeKey.addEventListener("click", dismissWelcomeKey);
  els.nostrLoginButton.addEventListener("click", loginWithNostr);
  els.nsecLoginButton.addEventListener("click", loginWithNsec);
  els.remoteLoginButton.addEventListener("click", loginWithRemote);
  els.remoteQrButton.addEventListener("click", loginWithRemoteQr);
  els.remoteQrCancel.addEventListener("click", cancelRemoteQr);
  els.linkNostrButton.addEventListener("click", linkNostr);
  els.linkNsecButton.addEventListener("click", linkNsec);
  els.linkRemoteButton.addEventListener("click", linkRemote);
  els.linkRemoteQrButton.addEventListener("click", linkRemoteQr);
  els.linkRemoteQrCancel.addEventListener("click", cancelRemoteQr);

  els.signOut.addEventListener("click", async () => {
    try {
      await api("/console/api/session", { method: "DELETE" });
      toast(t("console.signOutDone"));
    } catch {
      // The local view is cleared even when the session already expired.
    } finally {
      showLogin();
    }
  });

  els.refresh.addEventListener("click", async () => {
    els.refresh.disabled = true;
    try {
      await loadOverview({ notify: true });
    } catch (error) {
      toast(error.message || t("console.error"));
    } finally {
      els.refresh.disabled = false;
    }
  });

  els.reconcileForm.addEventListener("submit", runReconciliation);
  els.apiReferenceSearch.addEventListener("input", () => {
    state.apiReferenceQuery = els.apiReferenceSearch.value;
    renderApiReference();
  });
  bindCopy(els.copyOpenApiUrl, () => `${window.location.origin}/openapi.json`);

  els.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.creating) return;
    const raw = els.amount.value.trim();
    const amountValid = validateAmount(raw);
    setControlValidity(els.amount, els.amountError, !amountValid);
    if (!amountValid) {
      els.amount.focus();
      return;
    }
    state.creating = true;
    els.openCheckout.hidden = true;
    els.openCheckout.removeAttribute("href");
    setButton(els.createButton, true, "dash.creating", "dash.create");
    setStatus(els.createStatus, "");
    try {
      const created = await api("/console/api/payment-intents", {
        body: {
          amount: Number(raw),
          currency: "SAT",
          scale: 0,
          payment_method: "lightning",
          external_reference: document.getElementById("reference").value.trim() || null,
          location_id: els.locationSelect.value || null,
          metadata: {
            memo: document.getElementById("memo").value.trim(),
            source: "console"
          }
        },
        headers: { "idempotency-key": crypto.randomUUID() }
      });
      els.preview.hidden = false;
      els.previewAmount.textContent = formatSats(created.amount);
      els.previewReference.textContent = created.external_reference || created.id;
      els.previewInvoice.textContent = created.payment.invoice;
      els.openWallet.href = `lightning:${created.payment.invoice}`;
      if (created.checkout_url) {
        els.openCheckout.href = created.checkout_url;
        els.openCheckout.hidden = false;
      }
      window.PayQr.draw(els.previewQr, created.payment.invoice);
      setStatus(els.createStatus, t("console.paymentCreated"));
      await loadOverview();
    } catch (error) {
      setStatus(els.createStatus, error.message || t("console.error"), true);
    } finally {
      state.creating = false;
      setButton(els.createButton, false, "dash.creating", "dash.create");
    }
  });

  els.amount.addEventListener("input", () => {
    if (!els.amount.value.trim()) return;
    const valid = validateAmount(els.amount.value.trim());
    setControlValidity(els.amount, els.amountError, !valid);
  });

  els.linkAmount.addEventListener("input", () => {
    if (!els.linkAmount.value.trim()) return;
    setControlValidity(els.linkAmount, els.linkAmountError, !validateAmount(els.linkAmount.value));
  });

  els.profileName.addEventListener("input", () => {
    const name = els.profileName.value.trim();
    setControlValidity(els.profileName, els.profileNameError, name.length < 1 || name.length > 120);
  });

  els.memberPubkey.addEventListener("input", () => {
    const pubkey = els.memberPubkey.value.trim();
    if (!pubkey) {
      setControlValidity(els.memberPubkey, els.memberPubkeyError, false);
      return;
    }
    setControlValidity(els.memberPubkey, els.memberPubkeyError, !/^[0-9a-fA-F]{64}$/.test(pubkey));
  });

  els.locationForm.addEventListener("input", () => {
    const name = els.locationName.value.trim();
    const code = els.locationCode.value.trim();
    if (!name && !code) {
      setControlValidity(els.locationCode, els.locationError, false);
      return;
    }
    setControlValidity(
      els.locationCode,
      els.locationError,
      !name || !/^[A-Za-z0-9_-]{2,24}$/.test(code)
    );
  });

  bindPresetButtons("[data-scope-preset]", els.keyForm, SCOPE_PRESETS.recommended, els.scopeCount);
  bindPresetButtons("[data-event-preset]", els.webhookForm, EVENT_PRESETS.recommended, els.eventCount);
  updatePresetCount(els.keyForm, els.scopeCount);
  updatePresetCount(els.webhookForm, els.eventCount);

  els.paymentsBody.addEventListener("click", (event) => {
    const row = event.target.closest("[data-payment-id]");
    if (row) openPayment(row.dataset.paymentId, row);
  });

  els.paymentsBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-payment-id]");
    if (!row) return;
    event.preventDefault();
    openPayment(row.dataset.paymentId, row);
  });

  els.filterTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) setFilter(button.dataset.filter);
  });

  els.paymentsMore.addEventListener("click", loadMorePayments);

  els.paymentSearch.addEventListener("input", () => {
    state.query = els.paymentSearch.value;
    renderPayments();
  });

  document.getElementById("topSearch").addEventListener("click", () => {
    navigateTo("payments", { focus: "paymentSearch", scrollTo: "payments" });
  });

  document.addEventListener("keydown", (event) => {
    if (!state.session || state.drawerOpen) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      navigateTo("payments", { focus: "paymentSearch", scrollTo: "payments" });
    }
  });

  document.getElementById("helpButton").addEventListener("click", () => {
    toast(t("console.helpToast"));
  });

  document.querySelectorAll("[data-goto]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(link.dataset.goto, {
        scrollTo: link.dataset.scrollTo || null
      });
    });
  });

  document.querySelectorAll("[data-open-create]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo("payments", { focus: "amount", scrollTo: "create" });
    });
  });

  window.addEventListener("hashchange", () => {
    if (state.session) showView(viewFromHash());
  });

  els.recentList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-payment-id]");
    if (row) openPayment(row.dataset.paymentId, row);
  });

  els.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = els.profileName.value.trim();
    const nameValid = name.length >= 1 && name.length <= 120;
    setControlValidity(els.profileName, els.profileNameError, !nameValid);
    if (!nameValid) {
      els.profileName.focus();
      return;
    }
    els.profileSave.disabled = true;
    setStatus(els.profileStatusMessage, "");
    try {
      await api("/console/api/merchants/me", {
        method: "PATCH",
        body: {
          name,
          support_email: els.profileEmail.value.trim() || null,
          website: els.profileWebsite.value.trim() || null
        }
      });
      await loadOverview();
      setStatus(els.profileStatusMessage, t("console.profileSaved"));
    } catch (error) {
      setStatus(els.profileStatusMessage, error.message || t("console.error"), true);
    } finally {
      els.profileSave.disabled = false;
    }
  });

  els.addPaymentLinkButton.addEventListener("click", () => {
    els.paymentLinkForm.hidden = false;
    els.addPaymentLinkButton.hidden = true;
    els.paymentLinkStatus.textContent = "";
    setControlValidity(els.linkAmount, els.linkAmountError, false);
    els.linkAmount.focus();
  });

  els.paymentLinkCancel.addEventListener("click", () => {
    els.paymentLinkForm.hidden = true;
    els.addPaymentLinkButton.hidden = !hasScope("payments:write");
    setControlValidity(els.linkAmount, els.linkAmountError, false);
    setStatus(els.paymentLinkStatus, "");
  });

  els.paymentLinkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = Number(els.linkAmount.value);
    const amountValid = validateAmount(String(amount));
    setControlValidity(els.linkAmount, els.linkAmountError, !amountValid);
    if (!amountValid) {
      els.linkAmount.focus();
      return;
    }
    els.paymentLinkSubmit.disabled = true;
    setStatus(els.paymentLinkStatus, "");
    try {
      const created = await api("/console/api/payment-links", {
        body: {
          amount,
          currency: "SAT",
          scale: 0,
          reference: document.getElementById("linkReference").value.trim() || null,
          label: document.getElementById("linkLabel").value.trim() || null
        },
        headers: { "idempotency-key": crypto.randomUUID() }
      });
      els.newPaymentLinkPanel.hidden = false;
      els.newPaymentLinkUrl.textContent = created.url;
      els.openPaymentLink.href = created.url;
      els.paymentLinkForm.hidden = true;
      setStatus(els.paymentLinkStatus, t("console.paymentLinkCreated"));
      await loadOverview();
    } catch (error) {
      setStatus(els.paymentLinkStatus, error.message || t("console.error"), true);
    } finally {
      els.paymentLinkSubmit.disabled = false;
    }
  });

  els.copyPaymentLinkUrl.addEventListener("click", async () => {
    const ok = await copyText(els.newPaymentLinkUrl.textContent || "");
    toast(ok ? t("common.copied") : t("console.error"));
  });

  document.getElementById("paymentLinksCard").addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy-payment-link]");
    const disable = event.target.closest("[data-disable-payment-link]");
    if (!copy && !disable) return;
    if (copy) {
      const ok = await copyText(copy.dataset.copyPaymentLink || "");
      toast(ok ? t("common.copied") : t("console.error"));
      return;
    }
    if (!window.confirm(t("console.disablePaymentLinkConfirm"))) return;
    disable.disabled = true;
    try {
      await api(`/console/api/payment-links/${encodeURIComponent(disable.dataset.disablePaymentLink)}/disable`, { method: "POST" });
      setStatus(els.paymentLinkStatus, t("console.paymentLinkDisabled"));
      await loadOverview();
    } catch (error) {
      setStatus(els.paymentLinkStatus, error.message || t("console.error"), true);
      disable.disabled = false;
    }
  });

  els.addWebhookButton.addEventListener("click", () => {
    resetWebhookForm();
    els.webhookForm.hidden = false;
    updateWebhookControls();
    els.webhookUrl.focus();
  });

  els.webhookCancel.addEventListener("click", () => {
    resetWebhookForm();
  });

  els.webhookUrl.addEventListener("input", () => {
    if (!els.webhookUrl.value.trim()) {
      setControlValidity(els.webhookUrl, els.webhookUrlError, false);
      return;
    }
    try {
      const parsed = new URL(els.webhookUrl.value.trim());
      setControlValidity(
        els.webhookUrl,
        els.webhookUrlError,
        parsed.protocol !== "https:" && parsed.protocol !== "http:"
      );
    } catch {
      setControlValidity(els.webhookUrl, els.webhookUrlError, true);
    }
  });

  els.webhookForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = els.webhookUrl.value.trim();
    let urlValid = false;
    try {
      const parsed = new URL(url);
      urlValid = parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      urlValid = false;
    }
    setControlValidity(els.webhookUrl, els.webhookUrlError, !urlValid);
    if (!urlValid) {
      els.webhookUrl.focus();
      return;
    }
    const events = Array.from(
      els.webhookForm.querySelectorAll('input[type="checkbox"]:checked')
    ).map((input) => input.value);
    if (!events.length) {
      setStatus(els.webhookStatus, t("console.noEvents"), true);
      return;
    }
    els.webhookSubmit.disabled = true;
    setStatus(els.webhookStatus, "");
    try {
      if (state.editingWebhookId) {
        await api(
          `/console/api/webhook-endpoints/${encodeURIComponent(state.editingWebhookId)}`,
          { method: "PATCH", body: { events } }
        );
        await loadOverview();
        resetWebhookForm();
        setStatus(els.webhookStatus, t("console.webhookUpdated"));
      } else {
        const created = await api("/console/api/webhook-endpoints", {
          body: { url, events },
          headers: { "idempotency-key": crypto.randomUUID() }
        });
        els.newWebhookPanel.hidden = false;
        const title = els.newWebhookPanel.querySelector("h3");
        title.dataset.i18n = "console.endpointCreated";
        title.textContent = t("console.endpointCreated");
        els.newWebhookSecret.textContent = created.secret;
        els.webhookForm.hidden = true;
        setStatus(els.webhookStatus, t("console.webhookCreated"));
        await loadOverview();
      }
    } catch (error) {
      setStatus(els.webhookStatus, error.message || t("console.error"), true);
    } finally {
      els.webhookSubmit.disabled = false;
      updateWebhookControls();
    }
  });

  document.getElementById("webhooks").addEventListener("click", async (event) => {
    const rotate = event.target.closest("[data-rotate-webhook]");
    const disable = event.target.closest("[data-disable-webhook]");
    const replay = event.target.closest("[data-replay-delivery]");
    const edit = event.target.closest("[data-edit-webhook]");
    if (edit) {
      const endpoint = state.overview?.webhooks?.endpoints.find(
        (item) => item.id === edit.dataset.editWebhook
      );
      openWebhookEditor(endpoint);
      return;
    }
    if (!rotate && !disable && !replay) return;
    const button = rotate || disable || replay;
    if (rotate && !window.confirm(t("console.rotateSecretConfirm"))) return;
    button.disabled = true;
    try {
      if (rotate) {
        const rotation = await api(
          `/console/api/webhook-endpoints/${encodeURIComponent(rotate.dataset.rotateWebhook)}/rotate`,
          { method: "POST" }
        );
        els.newWebhookPanel.hidden = false;
        const title = els.newWebhookPanel.querySelector("h3");
        title.dataset.i18n = "console.secretRotated";
        title.textContent = t("console.secretRotated");
        els.newWebhookSecret.textContent = rotation.secret;
        setStatus(
          els.webhookStatus,
          t("console.webhookRotated").replace("{date}", formatDateTime(rotation.previous_secret_expires_at))
        );
      } else if (disable) {
        await api(`/console/api/webhook-endpoints/${encodeURIComponent(disable.dataset.disableWebhook)}/disable`, { method: "POST" });
        setStatus(els.webhookStatus, t("console.webhookDisabled"));
      } else {
        await api(`/console/api/webhook-deliveries/${encodeURIComponent(replay.dataset.replayDelivery)}/replay`, { method: "POST" });
        setStatus(els.webhookStatus, t("console.webhookReplayed"));
      }
      await loadOverview();
    } catch (error) {
      setStatus(els.webhookStatus, error.message || t("console.error"), true);
      button.disabled = false;
    }
  });

  els.createKeyButton.addEventListener("click", () => {
    els.keyForm.hidden = false;
    els.createKeyButton.hidden = true;
    els.keyStatus.textContent = "";
  });

  els.keyCancel.addEventListener("click", () => {
    els.keyForm.hidden = true;
    els.createKeyButton.hidden = !hasScope("keys:write");
  });

  els.locationForm.addEventListener("submit", createLocation);

  els.locationForm.addEventListener("reset", () => {
    setControlValidity(els.locationCode, els.locationError, false);
    setStatus(els.locationStatus, "");
  });

  els.locationList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-location-action]");
    if (!button) return;
    let body;
    let message;
    if (button.dataset.locationAction === "rename") {
      const current = button.closest("li").textContent.split(" · ")[1] || "";
      const name = window.prompt(t("console.renameLocationPrompt"), current);
      if (name === null) return;
      body = { name: name.trim() };
      message = t("console.locationRenamed");
    } else {
      const active = button.dataset.locationActive !== "true";
      if (!active && !window.confirm(t("console.disableLocationConfirm"))) return;
      body = { active };
      message = t(active ? "console.locationEnabled" : "console.locationDisabled");
    }
    button.disabled = true;
    try {
      await api(`/console/api/locations/${encodeURIComponent(button.dataset.locationId)}`, {
        method: "PATCH",
        body
      });
      await loadOverview();
      setStatus(els.locationStatus, message);
    } catch (error) {
      setStatus(els.locationStatus, error.message || t("console.error"), true);
      button.disabled = false;
    }
  });

  els.memberForm.addEventListener("submit", inviteMember);

  els.memberForm.addEventListener("reset", () => {
    setControlValidity(els.memberPubkey, els.memberPubkeyError, false);
    setStatus(els.memberStatus, "");
  });

  els.memberList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-revoke-member]");
    if (!button) return;
    if (!window.confirm(t("console.revokeMemberConfirm"))) return;
    button.disabled = true;
    try {
      await api(`/console/api/members/${encodeURIComponent(button.dataset.revokeMember)}/revoke`, {
        method: "POST"
      });
      await loadOverview();
      setStatus(els.memberStatus, t("console.memberRevoked"));
    } catch (error) {
      setStatus(els.memberStatus, error.message || t("console.error"), true);
      button.disabled = false;
    }
  });

  els.keyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.creatingKey) return;
    const scopes = Array.from(els.keyForm.querySelectorAll('input[type="checkbox"]:checked')).map(
      (input) => input.value
    );
    if (!scopes.length) {
      setStatus(els.keyStatus, t("console.noScopes"), true);
      els.keyForm.querySelector('input[type="checkbox"]')?.focus();
      return;
    }
    state.creatingKey = true;
    setButton(els.keySubmit, true, "dash.creating", "console.createKey");
    try {
      const expiresInDays = els.keyExpiry.value ? Number(els.keyExpiry.value) : null;
      const label = els.keyLabel ? els.keyLabel.value.trim() || null : null;
      const created = await api("/console/api/api-keys", {
        body: { label, scopes, expires_in_days: expiresInDays }
      });
      if (els.keyLabel) els.keyLabel.value = "";
      const title = els.keyPanel.querySelector("h3");
      title.dataset.i18n = "console.keyCreated";
      title.textContent = t("console.keyCreated");
      els.keyPanel.hidden = false;
      els.keyValue.textContent = created.key;
      els.keyForm.hidden = true;
      els.createKeyButton.hidden = !hasScope("keys:write");
      await loadOverview();
    } catch (error) {
      setStatus(els.keyStatus, error.message || t("console.error"), true);
    } finally {
      state.creatingKey = false;
      setButton(els.keySubmit, false, "dash.creating", "console.createKey");
    }
  });

  els.apiKeys.addEventListener("click", async (event) => {
    const inspect = event.target.closest("[data-inspect-key]");
    if (inspect) {
      await openKeyInspector(inspect.dataset.inspectKey, inspect);
      return;
    }
    const rotate = event.target.closest("[data-rotate-key]");
    const revoke = event.target.closest("[data-revoke-key]");
    if (!rotate && !revoke) return;
    const button = rotate || revoke;
    if (!window.confirm(t(rotate ? "console.rotateKey" : "console.revokeKey"))) return;
    button.disabled = true;
    try {
      if (rotate) {
        const created = await api(
          `/console/api/api-keys/${encodeURIComponent(rotate.dataset.rotateKey)}/rotate`,
          { method: "POST" }
        );
        const title = els.keyPanel.querySelector("h3");
        title.dataset.i18n = "console.keyRotated";
        title.textContent = t("console.keyRotated");
        els.keyPanel.hidden = false;
        els.keyValue.textContent = created.key;
        setStatus(els.keyStatus, t("console.keyRotatedOnce"));
      } else {
        await api(`/console/api/api-keys/${encodeURIComponent(revoke.dataset.revokeKey)}/revoke`, {
          method: "POST"
        });
      }
      await loadOverview();
    } catch (error) {
      setStatus(els.keyStatus, error.message || t("console.error"), true);
      button.disabled = false;
    }
  });

  if (els.auditFilterGroup) {
    els.auditFilterGroup.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-audit-filter]");
      if (!btn) return;
      const prefix = btn.dataset.auditFilter || "";
      els.auditFilterGroup.querySelectorAll("[data-audit-filter]").forEach((el) => {
        el.setAttribute("aria-pressed", String(el === btn));
      });
      try {
        const q = prefix ? `?action_prefix=${encodeURIComponent(prefix)}&limit=25` : "?limit=25";
        const res = await api(`/console/api/audit-logs${q}`);
        renderAuditLogs(res.data || []);
      } catch (error) {
        toast(error.message || t("console.error"));
      }
    });
  }

  els.drawerClose.addEventListener("click", closeDrawer);
  els.drawerBackdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (!state.drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      els.drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
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

  bindCopy(els.copyPreview, () => els.previewInvoice.textContent);
  bindCopy(els.copyWelcomeKey, () => state.welcomeKey || "");
  bindCopy(els.copyNpubButton, () => state.generatedKey?.npub || "");
  bindCopy(els.copyNsecButton, () => state.generatedKey?.nsec || "");
  bindCopy(els.copyNewKey, () => els.keyValue.textContent);
  bindCopy(els.copyWebhookSecret, () => els.newWebhookSecret.textContent);

  document.addEventListener("pay:language", () => {
    applyConsoleMode(state.consoleMode);
    if (state.session) {
      renderAll();
    } else {
      renderTopbarIdle();
      renderAuthMode();
    }
    if (!state.creating) els.createButton.textContent = t("dash.create");
    if (!state.creatingKey) els.keySubmit.textContent = t("console.createKey");
    updatePresetCount(els.keyForm, els.scopeCount);
    updatePresetCount(els.webhookForm, els.eventCount);
  });

  if (els.envToggle) {
    els.envToggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-console-mode]");
      if (!button) return;
      void selectConsoleMode(button.dataset.consoleMode);
    });
  }

  async function startConsole() {
    await loadConsoleConfig();
    await Promise.all([loadNostrConfig(), loadOnboardingConfig()]);
    await loadSession();
  }

  initReconcileDates();
  init();
  loadApiReference();
  void startConsole();
})();
