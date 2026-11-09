# WeChatBot ZeroLink

微信 iLink Bot 的独立 Node.js SDK。源码、示例和测试位于 [`nodejs/`](nodejs/)。本仓库基于上游 `corespeed-io/wechatbot` 的 `node-v2.2.0` 版本，现只维护 Node.js 实现。

当前仓库根目录声明的包名为 `wechatbot-zerolink`，版本为 `2.2.0-zerolink.2`。此分支新增的微信 3.0.0 beta 绑定协议适配见[协议审计](docs/protocol-compatibility-3.0.0-beta-0.md)。该包尚未发布到 npm。

## 构建与测试

需要 Node.js 22 或更新版本。

```sh
cd nodejs
npm ci
npm run build
npm test
```

SDK 的使用方式、API 和示例见 [Node.js 文档](nodejs/README.md)。

## 项目内容

- `nodejs/src/`：SDK 实现
- `nodejs/tests/`：单元测试
- `nodejs/examples/`：使用示例
- `docs/`：协议与架构说明

仓库保留 Node.js SDK 的 CI 和 npm 发布工作流；发布前须核对工作流中的包名与目标 registry。

## 许可证

[MIT](LICENSE)
