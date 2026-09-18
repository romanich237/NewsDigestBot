const axios = require('axios');

class ClodexClient {
  constructor(config, tracker) { this.cfg = config; this.tracker = tracker; }
  async chat(messages) {
    if (!this.cfg?.enabled) throw new Error('CLODEX is disabled');
    if (!this.cfg.api_key || this.cfg.api_key.startsWith('YOUR_')) throw new Error('CLODEX API key is not configured');
    if (!this.cfg.model || this.cfg.model.startsWith('YOUR_')) throw new Error('CLODEX model is not configured');
    const url = `${String(this.cfg.base_url || 'https://clodex.xyz/v1').replace(/\/$/,'')}/chat/completions`;
    const response = await axios.post(url, { model:this.cfg.model, messages, temperature:this.cfg.temperature??0.2, max_tokens:this.cfg.max_output_tokens||1400 }, {
      timeout:this.cfg.timeout_ms||45000,
      headers:{Authorization:`Bearer ${this.cfg.api_key}`,'Content-Type':'application/json'}
    });
    const usage = response.data?.usage || {};
    if (this.tracker) this.tracker.trackClodex('chat.completions', usage);
    return response.data?.choices?.[0]?.message?.content || '';
  }
}
module.exports=ClodexClient;
