# SpaceModal Vercel 需求解析代理

本目录是独立的 Vercel 项目，只负责自然语言需求解析。训练模型、生成器和主站地址不变。源码中不含密钥。

## 导入项目

- Repository：`Silent-TNT/SpaceModal`；Production Branch：`main`
- Root Directory：`server/vercel-parser`
- Framework Preset：`Other`
- Node.js：`22.x`
- Build Command：使用 `vercel.json` 的 `npm test`
- Output Directory：`public`
- Function region：新加坡 `sin1`；最长运行时间 60 秒，上游请求超时 35 秒。连接失败时在相同总时限内尝试一次 IPv4 连接。

在 Vercel 项目服务端的 Production 环境变量中设置 `PARSER_API_KEY`（已有通义千问密钥）和 `PARSER_MODEL=qwen-plus`。不要使用 `NEXT_PUBLIC_` 或 `VITE_` 前缀，不要提交 `.env`。更新变量后重新部署。

## 外部电脑访问

答辩使用 Production 的稳定域名，不使用带登录保护的预览链接。部署成功后检查项目 Deployment Protection，确认老师无需登录即可访问 Production；同时确认 OPTIONS 和 POST 不被登录页或浏览器挑战拦截。保留应用中的来源校验与限流。

若 `vercel.app` 在现场网络无法访问，可绑定自己的接口子域名并按 Vercel 返回的记录配置 DNS。绑定域名不等于已通过现场网络验收。

## 接入与验收

1. 匿名访问 `/health` 应返回 `ok:true, configured:true`，且不包含密钥。
2. 主站来源 `https://www.spacemodal.com` 和 `https://spacemodal.com` 的 `/parse` OPTIONS 应返回对应的 `Access-Control-Allow-Origin`。
3. `/parse` POST 的 JSON 为 `{text,current}`，应返回 `{patch,unsupported,source:"llm"}`。同时兼容旧版六个数值字段和新版阳台字段。
4. 验证真实大模型调用后，才将主站 `generator-studio/parser-config.js` 的 endpoint 改为部署的稳定域名加 `/parse`，更新 revision 并发布。主站已切换至下方正式接口，并更新配置版本以迁移旧地址。
5. 未登录的新浏览器和平板都应完成需求输入、确认条件、真实生成和视图切换。校园网络需要现场复核。

调用次数限制在函数实例内存中，并不是持久化的全局消费上限。Vercel 与模型调用的实际费用以各自账号套餐为准，不会通过本代码自动购买服务。

官方参考：[Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[vercel.json](https://vercel.com/docs/project-configuration/vercel-json)、[Deployment Protection](https://vercel.com/docs/deployment-protection)。

## 已发布版本（2026-10-11）

- Team：`silent-tnts-projects`；Project：`spacemodal-parser`
- 正式接口：`https://spacemodal-parser-silent-tnts-projects.vercel.app/parse`
- Deployment：`dpl_3NcsnjTbfacq92ed962sRGxqKLbw`
- 正式稳定域名允许匿名访问；预览和独立部署地址继续保留登录保护。
- 已通过匿名健康检查、跨域预检、真实千问解析，以及全新浏览器中的真实训练模型生成和视图切换。用户平板和答辩现场网络仍需实际打开确认。
- 本地备用：`https://www.spacemodal.com/generator-studio/?parser=local`
