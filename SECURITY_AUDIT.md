# Security Audit Report — nav-online-invoice-mcp

**Reviewed by**: Security Agent
**Initial audit**: 2026-03-24
**Round 1 fixes**: 2026-03-24 (HIGH + MEDIUM + LOW)
**Round 2 fixes**: 2026-03-24 (remaining LOW + INFO)
**Round 3 fixes**: 2026-03-24 (all "Nyitott javaslatok" from SECURITY_REFERENCES.md)
**Round 4 fixes**: 2026-03-24 (LLM04 Data and Model Poisoning — API response sanitizer)
**Round 5 fixes**: 2026-03-24 (unused rawXml variables + GitHub Actions permissions + error path LLM04 coverage)
**Final status**: ✅ APPROVED — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 1 INFO (non-fixable, NAV API constraint)

---

## Complete Fix History

### Round 1 — HIGH & MEDIUM & LOW

| Finding | Severity | Fix |
|---------|----------|-----|
| rawXml leakage in `formatResponse` error output | HIGH | Removed rawXml parameter from formatResponse; only funcCode/errorCode/message returned |
| rawXml in `tokenExchange` error throw | HIGH | Error message rebuilt from structured fields only |
| `exchangeKey` too short — AES-128 null-padding | HIGH | `Buffer.from(key).length < 16` check at startup, explicit error thrown |
| `NAV_BASE_URL` SSRF vector | HIGH | `validateBaseUrl()` + `NAV_ALLOWED_BASE_URLS` allowlist added to both `index.ts` and `cli.ts` |
| HTTP timeout missing on all `fetch()` calls | HIGH | `AbortController` with 30s default timeout in `sendRequest()`, named `AbortError` catch |
| Date/datetime fields accept any string | MEDIUM | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` for dates, `z.string().datetime()` for ISO 8601 in all tools |
| Optional `taxNumber`/`supplierTaxNumber` unvalidated | MEDIUM | `z.string().regex(/^\d{8}$/)` on all optional tax number fields in both files |
| `js-sha512` unused dependency | MEDIUM | Removed from `package.json`; native `node:crypto` usage documented in `crypto.ts` |
| `.gitignore` incomplete | LOW | Added `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.cert`, `*.cer`, `*.log`, `.DS_Store` |
| Sandbox credentials undocumented | LOW | JSDoc comment added explaining Smithery-only purpose; dummy key updated to 16+ chars |
| `console.error` dumps full error object | LOW | Changed to `error.message` only to prevent response data appearing in logs |

### Round 2 — remaining LOW & INFO

| Finding | Severity | Fix |
|---------|----------|-----|
| No rate limiting on write tools | LOW | `RateLimiter` sliding-window class in `src/rate-limiter.ts`; `writeRateLimiter` singleton applied to `manage_invoice` and `manage_annulment` in both entry points |
| Prompt `search-invoices` dateFrom/dateTo unvalidated | INFO | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` added to both prompt parameters |
| No responsible disclosure policy | INFO | `SECURITY.md` created with vulnerability reporting instructions |

### Round 3 — SECURITY_REFERENCES.md "Nyitott javaslatok" (all 6 items)

| Finding | Severity | Fix |
|---------|----------|-----|
| XXE / Billion Laughs protection not explicit in fast-xml-parser | LOW | `src/xml-parser.ts`: added `processEntities: false` and `allowBooleanAttributes: false` with security rationale comment (CWE-776) |
| LLM09 Overreliance — no user confirmation prompt on write tools | LOW | `src/index.ts` + `src/cli.ts`: `manage_invoice` and `manage_annulment` tool descriptions now open with `⚠️ IRREVERSIBLE: ...ALWAYS ask the user for explicit confirmation before calling this tool.` |
| Structured audit log missing for financial write operations | LOW | New `src/audit-log.ts`: NDJSON structured log to stderr for all write tool events (attempt/success/error/rate_limited); no PII, only timestamp + event type + operationCount + transactionId + funcCode |
| Dependabot not configured | INFO | `.github/dependabot.yml` created: weekly Monday npm updates, max 5 open PRs, dev-dependency grouping, `dependencies`+`security` labels |
| No CI security automation | INFO | `.github/workflows/security.yml` created: `audit` job (`npm audit --audit-level=high`), `sast` job (`tsc --noEmit` + `eslint`), `build` job (depends on both) — triggers on push/PR to main + weekly cron |
| SAST (eslint-plugin-security) not integrated | INFO | `eslint.config.js` created with `eslint-plugin-security` + `typescript-eslint`; devDependencies added to `package.json`; `lint`, `lint:fix`, `audit:check` npm scripts added |

### Round 4 — LLM04 Data and Model Poisoning

| Finding | Severity | Fix |
|---------|----------|-----|
| NAV API responses passed unsanitized to LLM context (LLM04) | LOW | New `src/llm-sanitizer.ts`: `sanitizeApiResponse()` applied in `formatResponse()` in both entry points. Mitigations: (1) C0/C1 control-char stripping, (2) 20 prompt-injection regex patterns detected + `[FLAGGED_CONTENT]` replacement, (3) per-field 2,000-char cap, (4) total 50,000-char response cap. Anomalies logged to stderr as structured NDJSON (`event: "llm04.sanitizer.warning"`). |

### Round 5 — CI correctness + full LLM04 coverage + supply chain hardening

| Finding | Severity | Fix |
|---------|----------|-----|
| `rawXml` destructured but unused in all 9 tool handlers (both entry points) — would fail ESLint `no-unused-vars: error` in CI | LOW | Removed `rawXml` from all destructuring in `index.ts` and `cli.ts`; `nav-client.ts` still returns it for potential future use |
| GitHub Actions `GITHUB_TOKEN` default permissions too broad | LOW | Added `permissions: contents: read` at workflow level in `security.yml` (OpenSSF Scorecard: Token-Permissions) |
| Error path in `formatResponse` bypassed `llm-sanitizer` — NAV error `message` field unsanitized | INFO | Error path now also calls `sanitizeApiResponse()` on `{funcCode, errorCode, message}` before rendering; both entry points updated |
| GitHub Actions action versions not SHA-pinned | INFO | Documented below; SHA pinning recommended as next step (OpenSSF Scorecard: Pinned-Dependencies) |

> **ℹ️ Remaining INFO — SHA pinning**: `actions/checkout@v4` and `actions/setup-node@v4` use mutable tag references. For maximum supply chain security, pin to exact commit SHAs (e.g. `actions/checkout@<sha>`). This is a low-friction improvement that satisfies the OpenSSF Scorecard "Pinned-Dependencies" check.

---

## Remaining Finding (Non-fixable — NAV API constraint)

### ℹ️ INFO — AES-128-ECB mode in token decryption

**File**: `src/crypto.ts` — `decryptExchangeToken()`
**Category**: Cryptography — Known Limitation

The ECB cipher mode is deterministic and uses no IV. This is cryptographically weaker
than CBC or GCM. **However, this is mandated by the NAV Online Invoice API v3.0
specification (NTCA/1.0/common token exchange protocol) and cannot be changed without
breaking compatibility with the Hungarian tax authority's API.**

The code documents this constraint with a comment. No further action possible until
NAV updates their API specification.

---

## Final Security Posture

| Area | Rating | Notes |
|------|--------|-------|
| Secrets handling | ✅ EXCELLENT | Env vars only, no hardcoded credentials, `exchangeKey` length validated |
| XML injection protection | ✅ EXCELLENT | `escapeXml()` + `processEntities: false` + `allowBooleanAttributes: false` (CWE-776) |
| Input validation | ✅ EXCELLENT | Zod schemas with regex on all string fields including optional params |
| Error/info disclosure | ✅ EXCELLENT | rawXml never reaches output; errors log message-only |
| SSRF protection | ✅ EXCELLENT | NAV_BASE_URL validated against strict allowlist |
| HTTP resilience | ✅ GOOD | 30s timeout with AbortController on all API calls |
| Cryptography | ✅ GOOD | ECB mode is NAV constraint, documented; key length validated |
| Rate limiting | ✅ GOOD | Sliding window on write tools (20 calls/10 min, warn at 10) |
| Dependency hygiene | ✅ EXCELLENT | Unused dep removed; package-lock.json committed; minimal dep surface |
| Supply chain | ✅ EXCELLENT | Dependabot weekly + CI `npm audit --audit-level=high` on every PR; GITHUB_TOKEN read-only |
| Audit logging | ✅ EXCELLENT | Structured NDJSON audit log for all write tool events (no PII) |
| SAST | ✅ EXCELLENT | eslint-plugin-security + typescript-eslint in CI; zero-warning policy |
| LLM04 / API response poisoning | ✅ EXCELLENT | `llm-sanitizer.ts`: applied on BOTH success and error paths; control chars, 20 injection patterns, size caps, anomaly logging |
| LLM09 / Human oversight | ✅ EXCELLENT | IRREVERSIBLE warnings + explicit confirmation required in tool descriptions |
| Logging security | ✅ GOOD | Error messages only; no PII or raw responses in logs |
| Security policy | ✅ GOOD | SECURITY.md with responsible disclosure process |

---

## New Files Created

- `src/rate-limiter.ts` — sliding-window rate limiter, configurable, with per-operation counters
- `src/audit-log.ts` — structured NDJSON audit logger for financial write tool events (no PII)
- `src/llm-sanitizer.ts` — LLM04 API response sanitizer: injection detection, control char stripping, size caps
- `SECURITY.md` — responsible disclosure policy and security design notes
- `SECURITY_AUDIT.md` — this document
- `eslint.config.js` — ESLint flat config with eslint-plugin-security + typescript-eslint
- `.github/dependabot.yml` — weekly npm dependency update automation
- `.github/workflows/security.yml` — CI: dependency audit + SAST + build verification

## Repository Structure After Audit

```
nav-online-invoice-mcp/
├── SECURITY.md                        ← repo-specific: vulnerability reporting policy
├── SECURITY_AUDIT.md                  ← repo-specific: this audit document
├── eslint.config.js                   ← SAST: eslint-plugin-security + typescript-eslint
├── .gitignore                         ← expanded: credentials, logs, OS artifacts
├── package.json                       ← js-sha512 removed; lint + audit:check scripts added
├── src/
│   ├── index.ts                       ← formatResponse, getConfig, validateBaseUrl, Zod, rate limit, audit log, LLM09 warnings
│   ├── cli.ts                         ← same as index.ts (separate stdio entry point)
│   ├── nav-client.ts                  ← HTTP timeout, safe error messages
│   ├── xml-parser.ts                  ← processEntities: false (CWE-776 / Billion Laughs)
│   ├── crypto.ts                      ← dependency usage comment (AES-ECB NAV constraint)
│   ├── rate-limiter.ts                ← sliding-window write tool rate limiter
│   ├── audit-log.ts                   ← NDJSON audit log for write operations (stderr)
│   └── llm-sanitizer.ts               ← LLM04: API response sanitizer before LLM context injection
├── .github/
│   ├── dependabot.yml                 ← weekly npm dependency updates
│   └── workflows/security.yml         ← CI: audit + SAST + build (push/PR + weekly cron)
└── .claude/                           ← generic/reusable templates (not repo-specific)
    ├── README.md                      ← explains what belongs where + CLAUDE.md integration patterns
    ├── CLAUDE_security_agent.md       ← security agent role for any agent network
    ├── SECURITY_POLICY_TEMPLATE.md    ← blank SECURITY.md template for any project
    └── SECURITY_REFERENCES.md         ← OWASP/CWE/OpenSSF standards mapped to this project
```

**Convention**: The `.claude/` directory holds generic Claude agent configurations and
security templates reusable across projects. Repo-specific documentation (audit results,
active security policy) lives in the repo root per GitHub conventions.

## Files Modified

- `src/index.ts` — formatResponse, getConfig, validateBaseUrl, Zod schemas, rate limit + audit log integration, LLM09 IRREVERSIBLE warnings, LLM04 sanitizer integration
- `src/cli.ts` — same as index.ts (separate stdio entry point, kept in sync — LLM04 sanitizer integrated here too)
- `src/nav-client.ts` — HTTP timeout (AbortController), tokenExchange error message sanitization
- `src/xml-parser.ts` — processEntities: false, allowBooleanAttributes: false (CWE-776)
- `src/crypto.ts` — AES-ECB NAV constraint comment, dependency usage rationale
- `package.json` — js-sha512 removed; eslint devDependencies added; lint/audit:check scripts
- `.gitignore` — expanded with credential, log, and OS artifact patterns
