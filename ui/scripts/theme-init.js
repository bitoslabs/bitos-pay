(function () {
  "use strict";
  try {
    document.documentElement.dataset.theme = localStorage.getItem("pay-theme") || "dark";
    document.documentElement.lang = localStorage.getItem("pay-lang") === "lo" ? "lo" : "en";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
