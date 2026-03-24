# Security Standards Reference Map

Ez a dokumentum összefoglalja, hogy a releváns iparági biztonsági szabványok és
best practice-ek hogyan alkalmazhatóak erre a projektre — és konkrétan hol fedik le
(vagy nem fedik le) a jelenlegi kódbázist.

Ez a projekt három biztonsági domain metszéspontjában áll:
1. **API kliens** — a NAV Online Számla REST API-t hívja (→ OWASP API Security)
2. **MCP szerver** — AI agent hívja meg (→ OWASP LLM Top 10)
3. **Node.js/TypeScript alkalmazás** — általános webes biztonsági elvek (→ OWASP Top 10)

---

## 1. OWASP LLM Top 10 (2025) — Legfontosabb ennél a projektnél

**Forrás**: [genai.owasp.org/llm-top-10](https://genai.owasp.org/llm-top-10/)
**Miért releváns**: Ez a projekt MCP szerver — az AI agent eszközként hívja meg.
Az LLM Top 10 pontosan ezt a threat model-t írja le.

| Kockázat | Leírás | Állapot ebben a projektben |
|----------|--------|---------------------------|
| **LLM01** Prompt Injection | Rosszindulatú input az LLM-et nem szándékolt utasítások végrehajtására bírja | ✅ Részben védett: Zod validáció + escapeXml() megakadályozza az XML injection-t. Az MCP protokoll szintjén a host alkalmazás véd. |
| **LLM06** Sensitive Information Disclosure | Az LLM érzékeny adatokat szivárogtat a válaszaiban | ✅ Javítva: rawXml eltávolítva az error response-okból; tokenExchange hiba csak kódokat ad vissza |
| **LLM07** System Prompt Leakage | A rendszer prompt tartalma (kulcsok, instrukciók) kiszivárog | ✅ Jó: konfiguráció csak env var-ból érkezik, soha nem kerül visszaadásra a tool output-ban |
| **LLM08** Excessive Agency | Az agent a szándékoltnál több vagy kockázatosabb műveletet végez | ✅ Javítva: rate limiting a write toolokon (20 hívás/10 perc), `destructiveHint: true` annotáció |
| **LLM09** Overreliance | A rendszer nem ellenőrzi az LLM output helyességét pénzügyi következményű műveletek előtt | ✅ Javítva: `manage_invoice` és `manage_annulment` tool leírásokban explicit `⚠️ IRREVERSIBLE` figyelmeztetés + "ALWAYS ask the user for explicit confirmation" utasítás |
| **LLM04** Data and Model Poisoning | Rosszindulatú adatok kerülnek az LLM kontextusába | ✅ Javítva: `src/llm-sanitizer.ts` — minden NAV API válasz sanitizálva mielőtt az LLM kontextusba kerül: control char stripping, prompt injection pattern detection + flagging, per-field 2000 char cap, total 50k char cap, anomáliák stderr-re logolva |
| **LLM02** Insecure Output Handling | Az LLM output downstream rendszerbe kerül validáció nélkül | ✅ Jó: a tool input-ok Zod-dal validáltak mielőtt az API-ra mennének |

**Megjegyzés**: LLM01 (Prompt Injection) és LLM04 (Data Poisoning) között átfedés van ennél a projektnél — mindkettő részben a `llm-sanitizer.ts` által kezelt, mert a NAV API válaszokban szereplő rosszindulatú tartalom egyszerre adatmérgezés (LLM04) és prompt injection kísérlet (LLM01) lehet.

---

## 2. OWASP API Security Top 10 (2023)

**Forrás**: [owasp.org/API-Security](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
**Miért releváns**: A projekt API kliensként viselkedik a NAV felé, és API szerverként
az MCP protokollon keresztül. Mindkét irány érintett.

| Kockázat | Leírás | Állapot |
|----------|--------|---------|
| **API1** Broken Object Level Authorization | Jogosulatlan hozzáférés adatobjektumokhoz | ✅ N/A: az auth a NAV API-n van, nem itt |
| **API4** Unrestricted Resource Consumption | Rate limiting hiánya, DoS lehetőség | ✅ Javítva: AbortController 30s timeout + write tool rate limiter |
| **API7** Server-Side Request Forgery | Az API szerver belső erőforrásokat hív meg | ✅ Javítva: NAV_BASE_URL allowlist validáció |
| **API8** Security Misconfiguration | Debug mód, permissive CORS, felesleges endpoint-ok | ✅ Jó: csak stdio transport, nincs HTTP szerver, nincs debug endpoint |
| **API3** Broken Object Property Level Authorization | Érzékeny mezők kiszivárognak a response-ban | ✅ Javítva: rawXml eltávolítva az output-ból |
| **API6** Unrestricted Access to Sensitive Business Flows | Automatizálható üzleti folyamatok visszaélhetők | ✅ Részben: rate limiting fedezi, de nincs invoice-szintű duplicate detection |

---

## 3. OWASP Top 10 (2021) — Általános webalkalmazás-biztonság

**Forrás**: [owasp.org/Top10](https://owasp.org/Top10/)

| Kockázat | Állapot |
|----------|---------|
| **A03** Injection | ✅ Javítva: escapeXml() minden user input előtt, Zod regex validáció |
| **A02** Cryptographic Failures | ✅ Részben: AES-ECB NAV kényszer (dokumentálva), SHA3-512 erős hash, kulcshossz validálva |
| **A05** Security Misconfiguration | ✅ Jó: nincs felesleges endpoint, nincs debug mód |
| **A06** Vulnerable and Outdated Components | ✅ Javítva: js-sha512 eltávolítva; Dependabot heti frissítés + CI `npm audit --audit-level=high` minden PR-ra |
| **A09** Security Logging and Monitoring Failures | ✅ Javítva: strukturált NDJSON audit log (`src/audit-log.ts`) minden write tool eseményre — attempt/success/error/rate_limited, PII nélkül |

---

## 4. OWASP Cheat Sheet Series — Konkrétan releváns lapok

**Forrás**: [cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/)

Ezeket érdemes elolvasni és a fejlesztési döntéseknél visszakeresni:

- **[Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)**
  — Allowlist vs. denylist validáció elvei (a mi Zod regex allowlist megközelítésünk helyes)

- **[XML Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XML_Security_Cheat_Sheet.html)**
  — XXE (XML External Entity) injection és XML injection védelme
  — ✅ Javítva: `processEntities: false` és `allowBooleanAttributes: false` explicit beállítva (`src/xml-parser.ts`)

- **[Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)**
  — Érzékeny adatok soha nem kerülnek hibaüzenetekbe (✅ javítva)

- **[Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)**
  — Kulcsok kezelése, algoritmus választás elvei

- **[Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)**
  — Env var best practice-ek, secret rotation elvei

---

## 5. OpenSSF Scorecard — Supply Chain Biztonság

**Forrás**: [scorecard.dev](https://scorecard.dev/) | [github.com/ossf/scorecard](https://github.com/ossf/scorecard)

Az OpenSSF Scorecard automatikusan pontozza a GitHub repók supply chain biztonsági
érettségét. A legfontosabb ellenőrzések és jelenlegi állapotuk:

| Check | Leírás | Állapot |
|-------|--------|---------|
| **Branch-Protection** | Fő branch-ek védve vannak-e force push ellen | ❓ GitHub repository beállítástól függ |
| **Code-Review** | Minden commit kap-e review-t | ❓ Team workflow-tól függ |
| **Vulnerabilities** | Ismert CVE a dependency-kben | ✅ CI `npm audit --audit-level=high` minden PR-ra fut |
| **Pinned-Dependencies** | `^` vs. exact version pinning | ⚠️ npm: caret pinning (elfogadható + Dependabot fedezi); GitHub Actions: tag-pinned, nem SHA-pinned — ajánlott SHA pinning |
| **Token-Permissions** | GitHub Actions token-ek minimális jogokkal futnak-e | ✅ Javítva: `permissions: contents: read` a `security.yml` workflow szintjén |
| **SAST** | Static analysis tool fut-e a CI-ban | ✅ Javítva: `eslint-plugin-security` + `typescript-eslint` + CI workflow (`security.yml`) |
| **Dependency-Update-Tool** | Dependabot vagy Renovate aktív-e | ✅ Javítva: `.github/dependabot.yml` heti frissítés, hétfő 08:00 |

**Gyors win-ek**:
```bash
# Scorecard futtatása a repón (npx-szel, nem kell telepíteni)
npx @ossf/scorecard-action

# npm audit az aktuális dependency sebezhetőségekért
npm audit

# Dependabot aktiválása: .github/dependabot.yml létrehozása
```

**Dependabot konfiguráció** (`.github/dependabot.yml`):
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
```

---

## 6. Node.js Security Best Practices

**Forrás**: [nodejs.org/en/docs/guides/security](https://nodejs.org/en/docs/guides/security) |
[OWASP NodeJS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)

Node.js-specifikus elvek, amik erre a projektre vonatkoznak:

- **Env var validáció startup-kor** ✅ — `getConfig()` eldobja a hibát, ha valami hiányzik
- **`child_process` soha user input-tal** ✅ — nincs shell exec a kódban
- **Prototype pollution elleni védelem** ⚠️ — a `fast-xml-parser` objektumot épít; érdemes `Object.freeze()`-t megfontolni a parsed response-ra
- **`--disable-proto=throw` Node flag** ✅ Javítva — `package.json` `start` és `dev` scriptekben beállítva; engine szinten tiltja a `__proto__` hozzáférést, zero overhead
- **`helmet` vagy hasonló HTTP security header middleware** ✅ N/A — nincs HTTP szerver, csak stdio

---

## 7. CWE — Common Weakness Enumeration

**Forrás**: [cwe.mitre.org](https://cwe.mitre.org/)

A legfontosabb CWE-k, amik erre a projektre vonatkoznak (és a security agent ezeket keresi):

| CWE | Gyenge pont | Állapot |
|-----|-------------|---------|
| CWE-20 | Improper Input Validation | ✅ Javítva (Zod + regex) |
| CWE-91 | XML Injection | ✅ Javítva (escapeXml) |
| CWE-200 | Exposure of Sensitive Information | ✅ Javítva (rawXml eltávolítva) |
| CWE-326 | Inadequate Encryption Strength | ⚠️ ECB mode — NAV kényszer, dokumentálva |
| CWE-400 | Uncontrolled Resource Consumption | ✅ Javítva (timeout + rate limit) |
| CWE-601 | URL Redirection to Untrusted Site (Open Redirect) | ✅ Javítva (SSRF allowlist) |
| CWE-798 | Use of Hard-coded Credentials | ✅ Jó — csak sandbox credek, dokumentálva |

---

## Nyitott javaslatok

✅ **Minden javaslat megvalósítva** (Round 3, 2026-03-24)

| # | Feladat | Státusz | Megvalósítás |
|---|---------|---------|--------------|
| 1 | **Dependabot aktiválása** | ✅ Kész | `.github/dependabot.yml` — heti, hétfő 08:00, max 5 PR |
| 2 | **`npm audit` CI lépés** | ✅ Kész | `.github/workflows/security.yml` `audit` job — `--audit-level=high` minden PR-ra |
| 3 | **XXE védelem explicit ellenőrzése** | ✅ Kész | `src/xml-parser.ts`: `processEntities: false`, `allowBooleanAttributes: false` |
| 4 | **`manage_invoice` tool leírás bővítése** | ✅ Kész | `src/index.ts` + `src/cli.ts`: `⚠️ IRREVERSIBLE: ...ALWAYS ask the user for explicit confirmation` |
| 5 | **SAST integráció** | ✅ Kész | `eslint.config.js` + `eslint-plugin-security` devDep + CI `sast` job (zero-warning policy) |
| 6 | **Strukturált audit log** | ✅ Kész | `src/audit-log.ts`: NDJSON stderr log — attempt/success/error/rate_limited, PII nélkül |
