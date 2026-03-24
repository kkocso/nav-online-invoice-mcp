# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes    |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not** open a
public GitHub issue.

Instead, report it privately by:

1. **GitHub Security Advisories** (preferred): Go to the repository →
   Security → Advisories → Report a vulnerability
2. **Email**: Contact the repository maintainer directly via their GitHub profile

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any relevant code snippets or proof-of-concept

You can expect an initial response within **72 hours** and a fix or status update
within **14 days** for confirmed vulnerabilities.

## Scope

This MCP server handles sensitive financial data through the Hungarian NAV Online
Invoice API (Online Számla). Security issues of particular concern include:

- Credential or API key exposure (NAV login, password, signature/exchange keys)
- Server-Side Request Forgery (SSRF) via configuration parameters
- Injection vulnerabilities in XML construction
- Sensitive data leakage in error messages or logs
- Supply chain vulnerabilities in dependencies

## Out of Scope

- Issues in the NAV API itself (report to NAV directly)
- Issues in the MCP protocol (report to Anthropic/MCP SDK maintainers)
- Social engineering attacks

## Security Design Notes

- All user inputs are XML-escaped before inclusion in API requests
- API credentials are only accepted via environment variables or Smithery config —
  never hardcoded
- The NAV base URL is validated against an allowlist to prevent SSRF
- Exchange tokens are decrypted in-memory and never logged or persisted
- Error responses never include raw XML (which may contain credential hashes)
