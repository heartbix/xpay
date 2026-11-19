# @heartbix/xpay-mcp

Official XPay MCP server. Cursor, Claude Code, and any MCP client can quote and pay x402 URLs with an XPay API key.

```json
{
  "mcpServers": {
    "xpay": {
      "command": "npx",
      "args": ["-y", "@heartbix/xpay-mcp"],
      "env": {
        "XPAY_API_KEY": "ak_live_…"
      }
    }
  }
}
```

Tools: `xpay_quote`, `xpay_pay`, `xpay_balance`, `xpay_create_endpoint`.

Create a key at https://xpay.heartbix.com/account. Fund USDT before paying.

Docs: https://xpay.heartbix.com/llms.txt
