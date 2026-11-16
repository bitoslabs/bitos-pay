import qrcode from "qrcode-generator";

function drawQr(canvas, seed) {
  if (!canvas) return;
  const text = String(seed);
  if (!text) return;
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const size = 232;
  const margin = 12;
  const cell = (size - margin * 2) / count;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#0b0b0b";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect(
        margin + col * cell,
        margin + row * cell,
        cell + 0.2,
        cell + 0.2
      );
    }
  }
  canvas.setAttribute("aria-label", window.PayI18n.t("dash.qrNote"));
}

window.PayQr = { draw: drawQr };
