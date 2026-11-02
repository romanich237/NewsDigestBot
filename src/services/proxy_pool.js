const fs = require("fs");
const path = require("path");
const { SocksProxyAgent } = require("socks-proxy-agent");

class ProxyPool {
  constructor(root, settings = {}) {
    this.settings = settings;
    this.cursor = 0;
    const proxyDir = path.resolve(root, "data/proxies");
    const file = path.resolve(root, settings.file || "data/proxies/socks5.txt");
    if (!file.startsWith(`${proxyDir}${path.sep}`)) {
      this.items = [];
      return;
    }
    try {
      this.items = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^socks5:\/\//i.test(line));
    } catch {
      this.items = [];
    }
  }

  available() {
    return this.settings.enabled !== false && this.items.length > 0;
  }

  nextAgent() {
    if (!this.available()) return null;
    const proxy = this.items[this.cursor++ % this.items.length];
    return new SocksProxyAgent(proxy, {
      timeout: Number(this.settings.timeout_ms) || 12000,
    });
  }
}

module.exports = ProxyPool;
