const crypto = require("crypto");

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest();
}

function equalSecret(left, right) {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (!String(stored || "").startsWith("scrypt$"))
    return equalSecret(password, stored);
  const [, saltHex, hashHex] = stored.split("$");
  if (
    !/^[a-f0-9]{32}$/i.test(saltHex || "") ||
    !/^[a-f0-9]{64}$/i.test(hashHex || "")
  )
    return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(
    String(password || ""),
    Buffer.from(saltHex, "hex"),
    expected.length,
  );
  return crypto.timingSafeEqual(actual, expected);
}

function clientIp(req) {
  const remote = req.socket.remoteAddress || "unknown";
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
    return String(req.headers["x-real-ip"] || remote).slice(0, 80);
  }
  return remote;
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return (
      origin.host === req.headers.host &&
      ["http:", "https:"].includes(origin.protocol)
    );
  } catch {
    return false;
  }
}

function securityHeaders(req) {
  const https =
    req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(https
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}

module.exports = {
  clientIp,
  digest,
  equalSecret,
  hashPassword,
  sameOrigin,
  securityHeaders,
  verifyPassword,
};
