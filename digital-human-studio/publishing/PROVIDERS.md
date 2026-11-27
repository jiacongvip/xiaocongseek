# 已废弃：第二阶段自定义provider契约

之前要求用户另建 inspect/reserve/claim/settle 后端、独立凭据引用provider和强制WebAuthn登记，**不是原GEO的产品要求**，已撤销，不应按旧文档配置。

当前默认仅按原正式客户端/Flask协议薄适配，见 `README.md`。原GEO继续持有账号授权、权限与原累计额度账本；小葱仅保留内存合法会话、账号ID摘要、公司绑定、一次性UI确认及本地任务防重。无需用户设计新技术协议，亦不将auth off/默认allow当实际配置。

`src/publication-execution.ts` / `src/publication-providers.ts` 和Python直接执行原型保留供历史审阅，但不被宿主启动或当前领域服务导入。旧 configurePublicationProviders 入口明确报废弃，不构成备用绕过通道。

不提供伪造授权、额度归零、自动扫描Cookie、自动账号迁移或忽略证书的降级路径。
