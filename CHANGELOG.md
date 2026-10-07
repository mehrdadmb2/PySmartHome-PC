# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- API authentication for write endpoints
- PWA support with service worker
- Log rotation with RotatingFileHandler
- DHT22 retry mechanism for ESP32 sensors
- OpenAPI 3.0 specification
- Contributing guide and code of conduct
- Security policy

### Changed
- Improved error handling in sensor polling
- Updated README with badges and improved formatting

### Security
- Extract WiFi credentials to secrets.h
- Add .gitignore for sensitive files

## [3.0.0] - 2026-08-02

### Added
- Initial release of PySmartHome-PC
- ESP32 sensor node support (DHT22 + OLED)
- Python Flask server with local dashboard
- GitHub Pages online dashboard
- Power outage schedule with rolling 2-hour cycle
- Live countdown and progress bar
- 10 themes with custom fonts
- Persian & English language support with RTL
- File manager (local only)
- CSV data logging
- GitHub sync every 5 minutes

[Unreleased]: https://github.com/mehrdadmb2/PySmartHome-PC/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/mehrdadmb2/PySmartHome-PC/releases/tag/v3.0.0