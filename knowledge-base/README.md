# AI Signals Knowledge Base

这个目录存放 AI 痕迹检测使用的可维护规则库。

## 文件说明

- `ai-signals/cliche-phrases.json`
  - 高频模板化套话。
- `ai-signals/transitions.json`
  - 常见的工整衔接词、总结句触发词。
- `ai-signals/direct-hints.json`
  - 直接提示“由 AI 生成”的关键词或正则片段。
- `ai-signals/emotional-words.json`
  - 容易导致抒情密度过高的词。

## 维护方式

- 直接往对应 JSON 数组里追加新词或新模式即可。
- `direct-hints.json` 里的内容按正则片段处理，注意转义。
- 其他文件按普通字符串匹配处理。
- 修改规则后，优先用 `docs/全新40篇500字优秀作文（新一轮全套）.md` 和 `docs/真人优秀作文30篇.md` 做作文冒烟对照，观察漏检、误报、过度删除和事实审计结果。

## 推荐扩展方向

- 按文体拆分：议论文、记叙文、公文、短视频文案分别维护。
- 增加“低风险真人特征”词库，用于平衡误判。
- 后续如果要做半自动“训练”，可以先把误判样本整理成语料，再批量提炼高频短语写回这些文件。
