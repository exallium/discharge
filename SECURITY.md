# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT open a public issue** for security vulnerabilities
2. Use [GitHub Security Advisories](https://github.com/exallium/discharge/security/advisories/new) to report the vulnerability privately
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Assessment**: We will assess the vulnerability and determine its severity
- **Updates**: We will keep you informed of our progress
- **Resolution**: We aim to resolve critical vulnerabilities within 7 days
- **Credit**: We will credit you in the security advisory (unless you prefer anonymity)

### Scope

The following are in scope for security reports:

- The Discharge application code
- Authentication and authorization issues
- Data exposure vulnerabilities
- Injection vulnerabilities (SQL, command, etc.)
- Cross-site scripting (XSS)
- Webhook signature validation bypass

### Out of Scope

- Vulnerabilities in dependencies (report these to the dependency maintainers)
- Issues requiring physical access
- Social engineering attacks
- Denial of service attacks

## Security Best Practices

When deploying Discharge:

1. **Use strong secrets**: Generate cryptographically secure values for `SESSION_SECRET`, `DB_ENCRYPTION_KEY`, etc.
2. **Enable webhook validation**: Always set `GITHUB_WEBHOOK_SECRET` and validate signatures
3. **Restrict network access**: Use firewalls to limit access to your deployment
4. **Keep updated**: Regularly update dependencies and the application
5. **Monitor logs**: Watch for suspicious activity in application logs
