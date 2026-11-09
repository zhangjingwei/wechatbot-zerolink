# WeChatBot ZeroLink

A Node.js SDK for the WeChat iLink Bot API. Source code, examples, and tests are in [`nodejs/`](nodejs/).

## Build and test

The current `nodejs/package.json` declares package name `@wechatbot/wechatbot` and version `2.2.0`. To use this repository's source:

```sh
cd nodejs
npm install
npm run build
npm test
```

Requires Node.js 22 or later. See the [Node.js documentation](nodejs/README.md) for usage, API details, and examples.

## Repository layout

- `nodejs/src/`: SDK implementation
- `nodejs/tests/`: unit tests
- `nodejs/examples/`: examples
- `docs/`: protocol and architecture notes

The repository retains Node.js CI and npm publishing workflows. The package metadata in [`nodejs/package.json`](nodejs/package.json) is authoritative for publishing.

## License

[MIT](LICENSE)
