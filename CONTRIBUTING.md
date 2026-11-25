# Contributing to ClaudeCityMod

Thanks for your interest in improving ClaudeCityMod.

## License

By contributing, you agree that your contributions will be licensed under
AGPL-3.0. See [LICENSE](LICENSE).

## Development setup

- **Node.js** 24 or newer
- **pnpm** 12 or newer
- **MongoDB** (local or Docker) for development
- Copy `.env.example` to `.env` and fill in values

```bash
pnpm install
pnpm run build
pnpm test
```

The dashboard lives under `dashboard/`. Build it with:

```bash
pnpm --filter claudecitymod-dashboard build
```

## Pull requests

- Open an issue first for large changes or new features when possible.
- Keep PRs focused; smaller changes are easier to review.
- Ensure `pnpm run build` and `pnpm test` pass.

## Code style

- Formatting is enforced with Prettier (see `.prettierrc`).
- Prefer clear names and small, testable changes over large refactors mixed
  with fixes.

## Security

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md).
