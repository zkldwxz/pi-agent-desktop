import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checkout = join(root, ".qa", "zcode");
const upstream = "https://github.com/zai-org/ZCode.git";
try { execFileSync("git", ["-C", checkout, "fetch", "--depth", "1", "origin"], { stdio: "inherit" }); }
catch { execFileSync("git", ["clone", "--depth", "1", upstream, checkout], { stdio: "inherit" }); }
execFileSync("git", ["-C", checkout, "checkout", "--detach", "origin/main"], { stdio: "inherit" });
const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const output = join(root, "docs", "upstream", "zcode");
await mkdir(output, { recursive: true });
const archive = join(output, "source.tar.gz");
await rm(archive, { force: true });
execFileSync("git", ["-C", checkout, "archive", "--format=tar.gz", "--output", archive, "HEAD"], { stdio: "inherit" });
await writeFile(join(output, "manifest.json"), JSON.stringify({ repository: upstream, commit, retrievedAt: new Date().toISOString(), archive: "source.tar.gz", format: "git archive of complete source tree; excludes .git and installed dependencies" }, null, 2) + "\n");
await writeFile(join(output, "README.md"), `# Zcode 上游源码参考\n\n官方仓库：${upstream}\n\n提交：\`${commit}\`。完整源码保存在 source.tar.gz，可用 \`tar -xzf source.tar.gz\` 解压。开发时的只读检出位于本仓库 .qa/zcode（不提交）。\n\n更新命令：\`npm run vendor:zcode\`。此快照用于研究交互与架构，不参与应用构建。源码许可证与第三方声明均包含在归档中。\n\n参考入口：\n\n- packages/ui/src/SSHDialog.tsx：连接表单与状态。\n- packages/server/src/remote/ssh-backend.ts：真实 SSH exec/SFTP 与断连处理。\n- packages/ui/src/WorkspaceFileTree.tsx：工作区文件展示。\n- packages/ui/src/ChatMessage/：聊天工具调用展示（具体位置见源码检出）。\n`);
console.log(`Zcode ${commit}: complete source archived in docs/upstream/zcode/source.tar.gz`);
