# WeChatBot ZeroLink

微信 iLink Bot 的 Node.js SDK。源码、示例和测试位于 [`nodejs/`](nodejs/)。

## 构建与测试

当前 `nodejs/package.json` 声明的包名为 `@wechatbot/wechatbot`，版本为 `2.2.0`。从本仓库使用源码时：

```sh
cd nodejs
npm install
npm run build
npm test
```

需要 Node.js 22 或更新版本。SDK 的使用方式、API 和示例见 [Node.js 文档](nodejs/README.md)。

## 项目内容

- `nodejs/src/`：SDK 实现
- `nodejs/tests/`：单元测试
- `nodejs/examples/`：使用示例
- `docs/`：协议与架构说明

仓库保留 Node.js SDK 的 CI 和 npm 发布工作流。发布配置以 [`nodejs/package.json`](nodejs/package.json) 为准。

## 许可证

[MIT](LICENSE)
