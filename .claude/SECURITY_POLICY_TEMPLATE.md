# Security Policy Template
#
# HOW TO USE:
#   1. Copy this file to your repo root as SECURITY.md
#   2. Fill in every placeholder marked with [BRACKETS]
#   3. Delete this header comment block
#   4. Commit and push — GitHub will automatically surface it in the
#      Security tab of your repository
#
# ─────────────────────────────────────────────────────────────────────

# Security Policy

## Supported Versions

List which versions currently receive security updates:

| Version | Supported |
|---------|-----------|
| [x.x]   | ✅ Yes    |
| [y.y]   | ❌ No     |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public GitHub issue.

Report it privately using one of these methods:

1. **GitHub Security Advisories** (preferred):
   Repository → Security → Advisories → "Report a vulnerability"

2. **Email**: [security contact email or GitHub profile URL]

Please include in your report:
- A clear description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- Affected versions
- Any suggested mitigations (optional)

**Response SLA**:
- Initial acknowledgement: within **72 hours**
- Status update or fix: within **14 days** for confirmed vulnerabilities

## Scope

What this project considers in-scope for vulnerability reports:

- [List the specific security concerns relevant to your project]
- Example: credential/secret exposure
- Example: injection vulnerabilities in user-supplied input
- Example: authentication/authorization bypass
- Example: sensitive data leakage in logs or error messages
- Example: supply chain vulnerabilities in dependencies

## Out of Scope

- Vulnerabilities in third-party dependencies (report to their maintainers)
- Vulnerabilities in upstream APIs or services this project integrates with
- Social engineering attacks
- [Add any project-specific exclusions]

## Security Design Notes

Document key security decisions here so contributors understand the threat model:

- [Example: All user inputs are validated with X before being used in Y]
- [Example: Secrets are only accepted via environment variables, never hardcoded]
- [Example: Z algorithm is used because of external spec requirement, not by choice]
- [Example: Dependency X was chosen over Y for security reason Z]
