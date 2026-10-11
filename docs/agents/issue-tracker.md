# Issue tracker: Local Markdown

规格与任务存放在 `.scratch/`。

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实施任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`。
- 任务从 01 编号，每个任务独立成文件。
- 文件顶部用 `Status:` 记录 triage 状态，词汇见 `triage-labels.md`。
- 评论追加在文件末尾的 `## Comments` 下。

“发布到 issue tracker”表示创建或更新上述本地文件。
“读取 ticket”表示读取用户指定路径或编号对应的文件。
修改已有规格或任务时保留其身份与评论历史。
