# Contributing to ngx-pos-print

Thank you for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/gmetenou7/NGX-POS-PRINT.git
cd ngx-pos-print
npm install
npm run build
```

## Development

```bash
# Build the library
npm run build

# Pack for local testing
cd dist && npm pack

# Install in a test project
cd ../your-test-app
npm install ../ngx-pos-print/dist/ngx-pos-print-1.0.0.tgz
```

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Build and test locally
5. Commit (`git commit -m 'Add my feature'`)
6. Push (`git push origin feature/my-feature`)
7. Open a Pull Request

## Code Style

- TypeScript strict mode
- `inject()` for dependency injection (no constructor injection)
- `providedIn: 'root'` on all services
- JSDoc on all public methods
- No `any` types
- No external dependencies

## Reporting Issues

Open an issue on GitHub with:
- Browser and version
- Angular version
- Printer model
- Error message or unexpected behavior
- Steps to reproduce
