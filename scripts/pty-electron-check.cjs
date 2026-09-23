/**
 * Pre-flight check: does node-pty's shipped N-API prebuild actually load and
 * work under this Electron runtime?
 *
 *   npx electron scripts/pty-electron-check.cjs                       # the dev tree
 *   npx electron scripts/pty-electron-check.cjs <path-to-node-pty>    # a packaged tree
 *
 * The second form is the one that matters before shipping: run it against
 * `release/win-unpacked/resources/app/node_modules/node-pty` to prove the
 * `afterPack` prune left everything node-pty needs in place.
 *
 * The packaged app loads node-pty through `require("node-pty")` and never
 * compiles it (see `npmRebuild: false` in package.json), so this is the check
 * that has to pass before a Windows installer is worth shipping: a terminal
 * that silently fails to start is one line of text in a panel.
 */
const { app } = require("electron");
const { resolve } = require("node:path");

/** A directory (or module name) to load, so a packaged copy can be checked too. */
const target = process.argv[2] ? resolve(process.argv[2]) : "node-pty";

app.whenReady().then(() => {
  let failures = 0;
  const report = (ok, label, detail) => {
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const versions = process.versions;
  console.log(
    `electron=${versions.electron} node=${versions.node} modules(ABI)=${versions.modules} platform=${process.platform}-${process.arch}`,
  );
  console.log(`loading: ${target}`);

  let pty;
  try {
    pty = require(target);
    report(typeof pty.spawn === "function", "module exposes spawn()");
  } catch (error) {
    report(false, `require(${target})`, error instanceof Error ? error.message : String(error));
    app.exit(1);
    return;
  }

  const shell = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
  let child;
  try {
    child = pty.spawn(shell, ["/c", "echo pty-ok"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
    report(true, `spawn() started ${shell}`);
  } catch (error) {
    report(false, "spawn()", error instanceof Error ? error.message : String(error));
    app.exit(1);
    return;
  }

  let output = "";
  const done = new Promise((resolve) => {
    child.onData((chunk) => {
      output += chunk;
    });
    child.onExit(({ exitCode }) => resolve(exitCode));
    setTimeout(() => resolve(null), 8000);
  });

  done.then((exitCode) => {
    report(output.includes("pty-ok"), "read PTY output", JSON.stringify(output.trim().slice(0, 80)));
    report(exitCode === 0, "child exited cleanly", `exitCode=${exitCode}`);
    console.log(failures === 0 ? "\nPTY: usable" : `\nPTY: ${failures} check(s) failed`);
    app.exit(failures === 0 ? 0 : 1);
  });
});
