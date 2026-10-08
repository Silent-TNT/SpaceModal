# SpaceModal 大模型需求代理

服务：https://spacemodal-parser.silent-tnt.chatgpt.site

Sites project：`appgprj_6ac7a5e93020819195780f4b4d5313df`

`GET /health` 仅公开是否配置，不公开密钥。`POST /parse` 接收 `{text,current}`，返回 `{patch,unsupported,source}`。源站仅允许 `https://www.spacemodal.com` 和 `https://spacemodal.com`；不接受客户端指定模型、上游地址或系统提示。

`PARSER_API_KEY` 仅在托管环境中设置，沿用数据工具已有的通义千问配置，未写入源码或发布包。`PARSER_MODEL` 为 `qwen-plus`，接口格式按 2026-10-08 阿里云官方结构化输出文档核对：https://www.alibabacloud.com/help/en/model-studio/text-generation 。原有 DeepSeek 密钥实际调用返回 401，因此没有继续使用。

## 演示限制

最大文本 1500 字、JSON 5000 字符、响应 700 tokens、上游超时 35 秒。每个 Worker 实例：同一 IP 每分钟最多 5 次，每天最多 60 次，并发最多 2 个，失败调用也计数。这些计数保存在实例内存，重启或不同实例会分别计数，**不是持久化全局账单上限**。Origin 校验用于限制网页调用来源，不能替代身份认证。答辩演示可用；长期公开运行前需要持久化额度及认证。

## 打包

Windows：运行 `node scripts/build.mjs` 和 `node scripts/validate-artifact.mjs`。使用 Sites 源码 helper 包装已验证的 dist。将 Git Bash 与 Node 加入当前进程 PATH，并设置 `TAR_OPTIONS=--force-local` 以兼容盘符路径。

源 manifest `.openai/hosting.json` 保留 project id。发布密钥应使用托管环境设置，绝不能提交到本目录。宿主环境变量的更新与源码版本分开管理。
