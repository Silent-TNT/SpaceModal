# SpaceModal 对话生成演示

公开入口：https://www.spacemodal.com/generator-studio/

默认流程：自然语言 → 托管大模型代理整理条件 → 用户确认条件卡 → 浏览器执行原 HGNN+CVA 训练模型 → 原 JavaScript 生成器搜索 → 两层平面、交互三维、几何贴邻拓扑。

## 实现与来源

- 模型来自 `E:/Documents/GraphSpace/outputs/261006_hgnn_cva_demo_1/model.pt`，80 epoch，权重完整导出为 `model.json`；不是预置生成结果。
- `inference.js` 实现原模型的 Linear、SiLU、LayerNorm、房间/楼层/住宅关系聚合和占位预测；不用 ONNX 或远程 Python。四组输入与 PyTorch 最大预测误差 `9.54e-7`，占位分类完全一致。
- `layout-core.js` 是原 demo 生成器的直接副本。生成在 Web Worker 运行，支持中止；默认搜索 2400 个候选。
- 默认在线解析使用托管代理；网页不包含或接收 API 密钥。密钥存储在代理托管环境，未进入 Git。
- 连接失败时不会冒充大模型解析；设置中可主动切换到明确标识的本地规则解析。
- 本地保存最近一组生成结果；下载 JSON 保留功能实例和矩形组成，下载 HTML 包含两层平面、交互三维与 A4 比例拓扑，可离线打开。

## 输入和评价边界

固定两层，每层 3000mm，300mm 模数，长宽 6000–18000mm，卧室和卫生间各 1–8 间。卧室默认在二层，其余功能及楼层沿用原 demo 的完整功能清单。

这不是项目的最小输入推理基准。默认厨房、家政、阳台和多功能室由 demo 清单补足，不能支持全部可选功能增减；位置、朝向、面积、挑空等要求仅提示尚未支持。用户确认“只采用卡片条件生成”后只按支持的字段计算。原 demo 的满铺和宽度规则仍保留，没有改写为项目统一验收。导出 `project_accepted=null`，页面明确标识原 demo 检查。几何贴邻不表示真实门或实际通行。

## 验证

`website/scripts/export-browser-model.py` 导出权重和 PyTorch 数值参考。

`website/scripts/test-browser-generator.cjs` 验证模型数值、解析单位和连续修改、真实浏览器模型参与生成、网格导出往返、四种视图、离线展示、保存恢复、取消、失败状态与 1440/1100/768/390 宽度适配。代理测试与真实线上调用另见代理目录。
