# Zcode 上游源码参考

官方仓库：https://github.com/zai-org/ZCode.git

提交：`29628c9acdb81b703bbd4080c207a0e7ce5e276e`。完整源码保存在 source.tar.gz，可用 `tar -xzf source.tar.gz` 解压。开发时的只读检出位于本仓库 .qa/zcode（不提交）。

更新命令：`npm run vendor:zcode`。此快照用于研究交互与架构，不参与应用构建。源码许可证与第三方声明均包含在归档中。

参考入口：

- packages/ui/src/SSHDialog.tsx：连接表单与状态。
- packages/server/src/remote/ssh-backend.ts：真实 SSH exec/SFTP 与断连处理。
- packages/ui/src/WorkspaceFileTree.tsx：工作区文件展示。
- packages/ui/src/ChatMessage/：聊天工具调用展示（具体位置见源码检出）。
