# Contributing to Web Search MCP

Thank you for your interest in contributing to the Web Search MCP Server! We welcome contributions from the community to help make this tool even better for local LLM users.

## How Can I Contribute?

### Reporting Bugs
- Before creating a new issue, please search the [Issue Tracker](https://github.com/OllyJohnston/web-search-mcp/issues) to see if the problem has already been reported.
- When opening an issue, provide as much detail as possible, including:
  - Your operating system and Node.js version.
  - Steps to reproduce the bug.
  - Expected behavior vs. actual behavior.
  - Any relevant log output (run with `VERBOSE_LOGGING=true`).

### Suggesting Enhancements
- Open an issue and describe the feature you'd like to see, why it would be useful, and how it might work.

### Submitting Pull Requests
1. Fork the repository and create your branch from `main`.
2. Install dependencies: `npm install`.
3. If you've added code that should be tested, add tests!
4. Ensure the test suite passes: `npm run build` and `npm run lint`.
5. Format your code: `npm run format`.
6. Use clear, descriptive commit messages.
7. Issue a Pull Request, describing your changes in detail.

## Development Setup

### Requirements
- Node.js 20 or higher.
- NPM.

### Scripts
- `npm run dev`: Start the server in development mode with hot-reloading.
- `npm run build`: Compile TypeScript to JavaScript in the `dist/` folder.
- `npm run lint`: Check code for style and syntax errors.
- `npm run format`: Automatically format code using Prettier.
- `npm run bundle`: Create a single-file deployment bundle at `dist/bundle.js`.

## Style Guidelines
- We use ESLint and Prettier to enforce consistent code style.
- Please follow the existing naming conventions and project structure.
- Document new functions or components using JSDoc-style comments.

## Community Standards
Please be respectful and professional in all interactions. We aim to foster a collaborative and welcoming environment for everyone.
