(function () {
  "use strict";

  const merchant = "Sabaidee Coffee";

  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);
  const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60_000);

  function createPayments() {
    return [
      {
        id: "pi_8f2c41a7",
        reference: "BNOS-ORDER-1042",
        merchant,
        amount: 185000,
        status: "paid",
        createdAt: minutesAgo(34),
        expiresAt: minutesAgo(19),
        memo: "Coffee beans · 2 kg",
        delivery: "200"
      },
      {
        id: "pi_5d90b3e1",
        reference: "BNOS-ORDER-1043",
        merchant,
        amount: 25000,
        status: "pending",
        createdAt: minutesAgo(3),
        expiresAt: minutesFromNow(12),
        memo: "Synthetic order",
        delivery: "pending"
      },
      {
        id: "pi_1a77c4f2",
        reference: "BNOS-ORDER-1040",
        merchant,
        amount: 64000,
        status: "paid",
        createdAt: minutesAgo(51),
        expiresAt: minutesAgo(36),
        memo: "Lunch set",
        delivery: "200"
      },
      {
        id: "pi_c3e2198a",
        reference: "BNOS-ORDER-1039",
        merchant,
        amount: 12000,
        status: "expired",
        createdAt: minutesAgo(91),
        expiresAt: minutesAgo(76),
        memo: "Tea",
        delivery: "200"
      },
      {
        id: "pi_77b6d0a4",
        reference: "BNOS-ORDER-1038",
        merchant,
        amount: 420000,
        status: "paid",
        createdAt: minutesAgo(108),
        expiresAt: minutesAgo(93),
        memo: "Catering deposit",
        delivery: "200"
      },
      {
        id: "pi_e4a8f612",
        reference: "BNOS-ORDER-1037",
        merchant,
        amount: 98000,
        status: "quarantined",
        createdAt: minutesAgo(132),
        expiresAt: minutesAgo(117),
        memo: "Late settlement review",
        delivery: "review"
      },
      {
        id: "pi_2d15c9b8",
        reference: "BNOS-ORDER-1036",
        merchant,
        amount: 71000,
        status: "paid",
        createdAt: minutesAgo(170),
        expiresAt: minutesAgo(155),
        memo: "Wholesale beans",
        delivery: "200"
      },
      {
        id: "pi_9ab34e70",
        reference: "BNOS-ORDER-1035",
        merchant,
        amount: 1100000,
        status: "paid",
        createdAt: minutesAgo(205),
        expiresAt: minutesAgo(190),
        memo: "Monthly subscription",
        delivery: "200"
      },
      {
        id: "pi_6c82d4a1",
        reference: "BNOS-ORDER-1034",
        merchant,
        amount: 35000,
        status: "pending",
        createdAt: minutesAgo(8),
        expiresAt: minutesFromNow(7),
        memo: "Pickup order",
        delivery: "pending"
      }
    ].map((payment) => {
      const fee = Math.round(payment.amount * 0.01);
      return {
        ...payment,
        fee,
        net: payment.amount - fee,
        invoice: window.PayUI.fakeInvoice(payment.amount),
        method: "lightning"
      };
    });
  }

  window.PayDemoData = { merchant, createPayments, minutesFromNow };
})();
