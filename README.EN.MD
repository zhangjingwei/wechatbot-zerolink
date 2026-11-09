# WeChatBot ZeroLink

An independent Node.js SDK for the WeChat iLink Bot API. Source code, examples, and tests are in [`nodejs/`](nodejs/). This repository is based on the upstream `corespeed-io/wechatbot` `node-v2.2.0` release and now maintains only the Node.js implementation.

The repository root declares package name `wechatbot-zerolink` and version `2.2.0-zerolink.2`. See the [protocol audit](docs/protocol-compatibility-3.0.0-beta-0.md) for this branch's WeChat 3.0.0 beta binding support. The package has not been published to npm.

## Build and test

Requires Node.js 22 or later.

```sh
cd nodejs
npm ci
npm run build
npm test
```

See the [Node.js documentation](nodejs/README.md) for usage, API details, and examples.

## Repository layout

- `nodejs/src/`: SDK implementation
- `nodejs/tests/`: unit tests
- `nodejs/examples/`: examples
- `docs/`: protocol and architecture notes

The repository retains Node.js CI and an npm publishing workflow. Check its package name and target registry before publishing.

## License

[MIT](LICENSE)
