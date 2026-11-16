(function () {
  "use strict";

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable in private or restricted contexts.
    }
  }

  function readSession(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeSession(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // The in-memory page state still works without session storage.
    }
  }

  function removeSession(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore restricted storage.
    }
  }

  window.PayStorage = { read, write, readSession, writeSession, removeSession };
})();
