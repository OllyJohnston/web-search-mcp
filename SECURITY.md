# Security Policy

## Supported Versions

Currently, security updates are provided for the following versions:

| Version | Supported |
| ------- | --------- |
| 0.7.x   | ✅ Yes    |
| < 0.7.0 | ❌ No     |

## Reporting a Vulnerability

We take the security of this project seriously. If you believe you have found a security vulnerability, please do NOT open a public issue. Instead, please report it via one of the following methods:

1. **Private Vulnerability Reporting**: Use the GitHub "Report a vulnerability" button in the "Security" tab.
2. **Direct Contact**: Email Olly Johnston at `olly@reclaimedhealth.com`.

We will acknowledge your report within 48 hours and work with you to resolve the issue promptly before making a public disclosure.

## Security Best Practices
- **Do not run as root/administrator**: This project uses Playwright to control web browsers. Running as an elevated user compromises the browser sandbox.
- **Environment Variables**: Always use environment variables for sensitive configuration instead of hardcoding secrets.
- **Updates**: Keep your production environment updated to the latest minor version of `web-search-mcp`.
