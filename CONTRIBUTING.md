# Contributing to Discharge

Thank you for your interest in contributing to Discharge! This document provides guidelines and instructions for contributing.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub with:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (OS, Node.js version, etc.)
- Any relevant logs or error messages

### Suggesting Features

Feature requests are welcome! Please open an issue with:

- A clear description of the feature
- The problem it solves or use case
- Any implementation ideas you have

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Set up the development environment** (see README.md)
3. **Make your changes** following our code style
4. **Write or update tests** as needed
5. **Run the test suite** to ensure everything passes
6. **Submit a pull request** with a clear description

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/discharge.git
cd discharge

# Install dependencies
npm install

# Build packages
npm run build:packages

# Start development server
cd router
npm run dev:setup  # First time only
npm run dev:up
```

## Code Style

- We use TypeScript with strict mode
- ESLint enforces our code style
- Run `npm run lint` to check your code
- Run `npm run typecheck` to verify types

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Commit Messages

- Use clear, descriptive commit messages
- Start with a verb (Add, Fix, Update, Remove, etc.)
- Reference issues when applicable (e.g., "Fix #123")

## Code Review

All submissions require review. We use GitHub pull requests for this purpose.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
