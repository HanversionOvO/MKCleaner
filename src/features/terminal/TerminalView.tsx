import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Page } from "@/app/Page";
import { Button } from "@/components/Button";
import {
  message,
  onTerminalData,
  onTerminalExit,
  terminalPtyKill,
  terminalPtyResize,
  terminalPtyStart,
  terminalPtyWrite,
} from "@/lib/ipc";

export function TerminalView() {
  const [running, setRunning] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const startedOnce = useRef(false);

  // Create the terminal once, themed from the app's tokens, and open the
  // engine's interactive main menu right inside it — no launcher bar, this
  // is a terminal.
  useEffect(() => {
    const node = host.current;
    if (!node || term.current) return;

    const css = getComputedStyle(document.documentElement);
    const xterm = new Terminal({
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.45,
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: css.getPropertyValue("--sunken").trim() || "#f0eee6",
        foreground: css.getPropertyValue("--ink").trim() || "#191919",
        cursor: css.getPropertyValue("--clay").trim() || "#d97757",
        cursorAccent: "#ffffff",
        selectionBackground: "rgba(217, 119, 87, 0.3)",
      },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(node);
    fitAddon.fit();

    xterm.onData((data) => {
      void terminalPtyWrite(data).catch(() => {});
    });

    term.current = xterm;

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      void terminalPtyResize(xterm.cols, xterm.rows).catch(() => {});
    });
    observer.observe(node);

    // The terminal opens straight into the engine's interactive menu.
    if (!startedOnce.current) {
      startedOnce.current = true;
      setRunning(true);
      void terminalPtyStart("mo").catch((e) => {
        xterm.write(`\r\n\x1b[31m${message(e)}\x1b[0m\r\n`);
        setRunning(false);
      });
    }

    return () => {
      observer.disconnect();
      xterm.dispose();
      term.current = null;
    };
  }, []);

  // Engine output and lifecycle.
  useEffect(() => {
    const offData = onTerminalData((chunk) => {
      term.current?.write(chunk);
    });
    const offExit = onTerminalExit(() => {
      term.current?.write("\r\n\x1b[90m— 进程已退出 —\x1b[0m\r\n");
      setRunning(false);
    });
    return () => {
      offData.then((u) => u());
      offExit.then((u) => u());
    };
  }, []);

  const restart = () => {
    setRunning(true);
    void terminalPtyStart("mo").catch((e) => {
      term.current?.write(`\r\n\x1b[31m${message(e)}\x1b[0m\r\n`);
      setRunning(false);
    });
  };

  return (
    <Page
      title="终端"
      lede="内置引擎的完整终端 —— 方向键选择，回车进入。"
      fill
      actions={
        running ? (
          <Button variant="quiet" onClick={() => void terminalPtyKill()}>
            结束进程
          </Button>
        ) : (
          <Button variant="quiet" onClick={restart}>
            重新启动
          </Button>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline">
        <div ref={host} className="min-h-0 flex-1 bg-sunken px-2 pt-2" />
      </div>
    </Page>
  );
}
