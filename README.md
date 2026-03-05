# NAV Online Invoice MCP Server

MCP (Model Context Protocol) server for the Hungarian NAV Online Invoice (Online Szamla) API v3.0.

This server allows AI assistants like Claude to query and manage invoices through the NAV Online Invoice system.

## Features

### Query Tools (read-only)
- **query_taxpayer** - Look up taxpayer information by tax number
- **query_invoice_data** - Get full invoice details by invoice number
- **query_invoice_digest** - Search invoices with filters (date, partner, category, etc.)
- **query_invoice_check** - Check if an invoice exists in the system
- **query_invoice_chain_digest** - View modification chain of an invoice
- **query_transaction_status** - Check processing status of submitted invoices
- **query_transaction_list** - List transactions within a date range

### Write Tools
- **manage_invoice** - Submit invoices (CREATE, MODIFY, STORNO)
- **manage_annulment** - Technical annulment of invoices

## Prerequisites

You need a NAV Online Invoice technical user. Register at:
- **Test**: https://onlineszamla-test.nav.gov.hu/
- **Production**: https://onlineszamla.nav.gov.hu/

## Setup

### 1. Install

```bash
npm install
npm run build
```

### 2. Configure

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
| Variable | Description |
|---|---|
| `NAV_LOGIN` | Technical user login |
| `NAV_PASSWORD` | Technical user password |
| `NAV_TAX_NUMBER` | 8-digit taxpayer number |
| `NAV_SIGNATURE_KEY` | Signature key from NAV |
| `NAV_EXCHANGE_KEY` | Exchange key from NAV |
| `NAV_ENV` | `test` or `production` |

### 3. Add to Claude Code

Add to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "nav-online-invoice": {
      "command": "node",
      "args": ["/path/to/nav-online-invoice-mcp/dist/index.js"],
      "env": {
        "NAV_LOGIN": "your_login",
        "NAV_PASSWORD": "your_password",
        "NAV_TAX_NUMBER": "12345678",
        "NAV_SIGNATURE_KEY": "your_signature_key",
        "NAV_EXCHANGE_KEY": "your_exchange_key",
        "NAV_ENV": "test"
      }
    }
  }
}
```

## Usage Examples

Once configured, you can ask Claude:

- "Keress ra erre az adoszamra: 12345678"
- "Listazd ki a kiallitott szamlakat 2024 januarbol"
- "Kerd le az INV-001 szamla reszleteit"
- "Mi a feldolgozasi allapota ennek a tranzakcionak: TX123"

## API Reference

This server implements the [NAV Online Invoice API v3.0](https://github.com/nav-gov-hu/Online-Invoice).

### Authentication

All requests are automatically signed using SHA-512 (password) and SHA3-512 (request signature). Token exchange for write operations is handled automatically.

### Environments

| Environment | API URL |
|---|---|
| Test | `https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3` |
| Production | `https://api.onlineszamla.nav.gov.hu/invoiceService/v3` |

## License

MIT
