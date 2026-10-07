# Security Policy

## Supported Versions

We support the latest version of PySmartHome-PC with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please do NOT open a public issue for security vulnerabilities.**

Instead, report vulnerabilities by opening a [private security advisory](https://github.com/mehrdadmb2/PySmartHome-PC/security/advisories/new) on GitHub.

### What to Include

When reporting a vulnerability, please provide:

- **Description**: Clear description of the vulnerability
- **Impact**: What could an attacker achieve?
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Proof of Concept**: If applicable, include code or screenshots
- **Affected Versions**: Which versions are affected?
- **Suggested Fix**: If you have a suggestion for fixing the issue

### Response Timeline

- **Initial Response**: Within 72 hours
- **Assessment**: Within 7 days
- **Fix or Mitigation**: As soon as possible, depending on severity

### Scope

The following are in scope for security reports:

- Python server (server.py)
- ESP32 firmware (Board-Code/*.ino)
- Web dashboard (index.html, pp.js, style.css)
- API endpoints
- Authentication and authorization mechanisms

### Out of Scope

The following are not in scope:

- Third-party libraries (report to the library maintainers)
- Physical security of devices
- Social engineering attacks
- Denial of service attacks on local network

## Security Best Practices for Users

### GitHub Token Security

- Never commit your GitHub token to the repository
- Use config.txt (git-ignored) or environment variables
- Use fine-grained personal access tokens with minimal permissions
- Rotate your tokens regularly

### WiFi Security

- Store WiFi credentials in secrets.h (git-ignored)
- Use WPA2 or WPA3 for your WiFi network
- Change your WiFi password regularly

### API Security

- Set PYSMART_API_KEY environment variable for production
- Use HTTPS when accessing the dashboard remotely
- Restrict access to the dashboard port in your firewall

### Network Security

- Run the server on a trusted local network
- Use a firewall to restrict access to port 5000
- Consider using a VPN for remote access

## Security Features

PySmartHome-PC includes several security features:

- **Path traversal protection**: Data directory access is restricted
- **API authentication**: Write endpoints require API key (optional)
- **Security headers**: XSS, clickjacking, and MIME sniffing protection
- **Input validation**: All API inputs are validated
- **No arbitrary file access**: Only public files and data directory are accessible

## Hall of Fame

We thank the following individuals for reporting security vulnerabilities:

- *Your name could be here!*

## License

This security policy is provided as-is for the benefit of the community.