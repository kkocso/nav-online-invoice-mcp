# .claude/ — Reusable Security & Agent Templates

This directory contains **generic, project-independent** security templates and
Claude agent configurations. Everything here is designed to be copied into other
GitHub repositories as-is or with minimal adaptation.

## Contents

### `CLAUDE_security_agent.md`
A complete role definition for a **Security Agent** in a multi-agent Claude network.

Drop this file into any project as `CLAUDE.md` (or reference it from your main
`CLAUDE.md`) when you want a dedicated security reviewer agent that:
- Audits code, configs, and data flows for vulnerabilities
- Has blocking authority (`BLOCKED` status) over other agents
- Produces structured findings (CRITICAL / HIGH / MEDIUM / LOW / INFO)
- Covers OWASP Top 10, secrets, supply chain, PII, SSRF, injection, etc.

**How to reuse**: Copy to your project and use as a Claude agent system prompt or
as a CLAUDE.md for a security-focused sub-agent.

---

### `SECURITY_REFERENCES.md`
Iparági biztonsági szabványok és best practice-ek térképe — konkrétan erre a projekttípusra
(API kliens + MCP szerver + Node.js) leképezve. Tartalmazza az OWASP LLM Top 10 2025,
OWASP API Security Top 10 2023, OpenSSF Scorecard, CWE és Node.js security elvek
alkalmazási útmutatóját, az aktuális lefedettséggel és a nyitott javaslatokkal.

**Hogyan használd**: Kódreview előtt vagy security sprint tervezésekor nézd át a
"Nyitott javaslatok" szekciót. Az audit report mellé érdemes hivatkozni a releváns
CWE és OWASP azonosítókra.

---

### `SECURITY_POLICY_TEMPLATE.md`
A GitHub-compatible `SECURITY.md` template for responsible disclosure.

Fill in the bracketed placeholders and copy to your repo root as `SECURITY.md`.
GitHub automatically surfaces this file in the repository's Security tab and
shows it to anyone who tries to open a security-related issue.

**How to reuse**: `cp .claude/SECURITY_POLICY_TEMPLATE.md ../your-repo/SECURITY.md`

---

## Hogyan hivatkozz ezekre a sablonokra más projektek CLAUDE.md-jéből?

A `SECURITY_POLICY_TEMPLATE.md` maga nem kerül bele a `CLAUDE.md`-be — az egy
egyszeri másolás alapja, amelyből a projekt saját `SECURITY.md`-je készül.

Ami viszont **igen** kerülhet a `CLAUDE.md`-be, az a security követelmények
rövid összefoglalója, amely Claudenak szól. Két bevált minta:

### 1. Minimális — csak egy utalás

Ha a projektben már van kitöltött `SECURITY.md`, elég ennyi a `CLAUDE.md`-ben:

```markdown
## Security

Follow the security policy defined in [SECURITY.md](./SECURITY.md).
When writing or reviewing code, always check for the vulnerability categories
listed in the "Scope" section of that document.
```

### 2. Teljes security preamble — beágyazva a CLAUDE.md-be

Ha részletesebb iránymutatást akarsz Claude számára (pl. mert nincs security agent
a hálózatban), illeszd be ezt a blokkot közvetlenül a `CLAUDE.md`-be:

```markdown
## Security-First Development

### Non-negotiable rules
- NEVER write secrets, API keys, passwords, or tokens anywhere in code,
  comments, logs, or test fixtures
- NEVER use `eval()`, `exec()`, `shell=True`, or raw SQL string concatenation
- ALWAYS validate and sanitize inputs at every trust boundary
- Flag any new dependency addition for supply chain risk review

### When reviewing or writing code, always check for
- Injection (SQL, command, XML, path traversal)
- Sensitive data exposure in logs, error messages, or API responses
- Missing or bypassable authentication/authorization
- Insecure cryptographic choices (MD5, SHA1, ECB mode without documented reason)
- Vulnerable or unused dependencies

### Security issue format
When you find a potential issue, use:
⚠️ SECURITY [CRITICAL|HIGH|MEDIUM|LOW]: <category> — <description> — <fix>

See [SECURITY.md](./SECURITY.md) for the project's vulnerability reporting policy.
```

### 3. Security agent delegálás — ha agent hálózatot használsz

Ha van dedikált security agent (ld. `CLAUDE_security_agent.md`), az orchestrator
`CLAUDE.md`-jébe kerüljön egy delegálási szabály:

```markdown
## Agent Network

This project uses a multi-agent setup. Agents and their responsibilities:

- **Orchestrator** (this file): coordinates tasks, routes work to agents
- **Coder agent**: implements features and fixes
- **Security agent**: reviews all artifacts before they are considered final
  — role definition: `.claude/CLAUDE_security_agent.md`

### Security routing rule
Before marking any task complete, the Orchestrator MUST route the final
artifact to the Security agent. A `BLOCKED` response from the Security agent
stops the workflow until the issue is resolved or explicitly overridden by
the human user.
```

---

## What belongs in this directory vs. the repo root

| File | Location | Reason |
|------|----------|--------|
| `SECURITY.md` | repo root | GitHub convention — project-specific vulnerability reporting |
| `SECURITY_AUDIT.md` | repo root | Audit results for this specific project |
| `CLAUDE_security_agent.md` | `.claude/` | Generic agent role, reusable across projects |
| `SECURITY_POLICY_TEMPLATE.md` | `.claude/` | Blank template, not project-specific |
