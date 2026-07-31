<div align="center">

<img src="docs/logo.svg" width="96" alt="MkCleaner logo" />

# MkCleaner

**一个安静的 Mac 清理工具** —— 清理能力由开源的 [Mole](https://github.com/tw93/Mole) 引擎提供，界面遵循 Claude 的设计语言：暖白的纸面、克制的陶土色、衬线数字。

[![License](https://img.shields.io/github/license/HanversionOvO/MKCleaner)](LICENSE)
[![Release](https://img.shields.io/github/v/release/HanversionOvO/MKCleaner)](https://github.com/HanversionOvO/MKCleaner/releases)
![macOS](https://img.shields.io/badge/macOS-13%2B-black)
![Engine](https://img.shields.io/badge/engine-Mole%201.48.1-blue)

Mole 只有命令行界面。MkCleaner 把它的扫描结果变成**可读、可选、可下钻**的界面，把它的进度变成**看得见的动效**，把它的系统指标变成**实时仪表盘** —— 但从不重新实现任何删除逻辑：**所有危险操作依然由引擎执行**。

</div>

---

## ✨ 特性

### 🧹 清理

扫描可以安全回收的缓存、日志和临时文件。

- 分类清单（用户缓存、浏览器、开发工具、应用支持…）逐项勾选，**取消勾选 = 写入引擎白名单**，之后永远跳过
- 扫描时卡片弥漫一层缓慢呼吸的陶土雾气；执行时清单**逐项淡出** —— 哪个被清理了，哪个就消失
- 「最近清理」历史：时间、项数、释放量

### ⚡ 优化

引擎的 23 项系统维护：DNS 缓存、LaunchServices 修复、Dock 刷新、Spotlight 优化、内存释放、网络栈刷新、权限修复……

- 清单随执行**逐项烟雾消散**（Apple Music 式弥散淡出），完成后数字轻轻弹起
- 需要管理员权限的步骤，系统会弹出授权窗口（引擎原生行为）

### 📊 空间

磁盘使用可视化。

- 概览：值得查看的位置列表（互有包含关系，不做误导性总计）
- 下钻：**treemap 方块随实时统计生长** —— 每个目录测完，方块就长大、重排
- 「最大的单个文件」清单，点击在访达中显示

### 📈 状态

实时系统仪表盘（`status -watch` 流）。

- CPU 与内存的**活动轨迹**（近 60 秒）、每核负载条
- 磁盘容量、电池（健康度/循环次数/温度）、网络吞吐
- 热节流状态：Apple Silicon 上无需 root 的唯一热信号

### 🗑 卸载

彻底移除应用。

- 真实应用图标（AppKit 提取，支持 Asset Catalog）
- 执行前展示 **dry-run 的完整文件清单** —— 你看到的每一个路径都是即将发生的
- 移入废纸篓，可恢复

### ⌨️ 终端

内置引擎的**完整交互式终端**（pty + xterm.js）—— 打开即是 mole 的交互菜单。

- 彩色输出、进度条、按键交互全部原生
- 引擎经过裁剪：`uninstall / update / remove / installer / completion` 已被移除，终端里**没有**卸载应用、自更新、删除引擎的入口

### 🎛 更多

- **托盘常驻**：关闭窗口不退出；右键菜单实时显示 CPU/内存/磁盘/电池 + 快捷操作
- **应用内更新**：启动自动检查 GitHub Release，一键下载安装（签名校验）
- **分层图标**：Big Sur 规范的分层 `.icns`（背景 / 前景 / 遮罩）
- **深浅主题**：跟随系统外观

---

## 📦 安装

从 [GitHub Releases](https://github.com/HanversionOvO/MKCleaner/releases) 下载最新的 `.dmg`，拖入应用程序文件夹。

以后每次发布新版本，应用**启动时会自动提示更新** —— 点一下「更新到 vX」即可原地升级，无需重新下载。

> 首次运行如果清理结果不如预期，请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中授予 MkCleaner —— 否则部分系统目录只能扫描不能删除。

---

## 🚀 快速上手

| 场景 | 操作 |
|---|---|
| 清理垃圾 | 「清理」→ 开始扫描 → 勾选要清理的 → 开始清理 |
| 系统变卡 | 「优化」→ 开始检查 → 开始优化（部分步骤会请求管理员权限） |
| 磁盘满了 | 「空间」→ 下钻找到大文件 → 右键在访达中打开 |
| 电脑发烫 | 「状态」→ 看热节流状态与 CPU 轨迹 |
| 卸载应用 | 「卸载」→ 勾选 → 查看将删除的文件 → 移到废纸篓 |
| 想用命令行 | 「终端」→ 直接使用 `mo` 交互菜单 |

---

## ❓ 常见问题

**为什么有些内容清理不掉？**

引擎有三层内置保护，都是安全设计：

1. **应用数据保护** —— AI 工具（Cursor、Codex、ChatGPT）、IDE（VSCode、JetBrains、Xcode、Typora）、密码管理器、输入法的缓存被视为可能含用户数据，默认不删
2. **系统关键缓存** —— 系统设置、控制中心、Finder/Dock、Spotlight、CloudKit，删了会破坏系统功能
3. **默认白名单** —— Playwright 浏览器、HuggingFace/Ollama 模型、Gradle/Maven 缓存等，删了要重新下载

另外 `/Library` 下的系统级缓存（如 Xcode 模拟器运行时）需要管理员权限 —— 当前环境的授权链路受限时会被跳过。这些在清理结果页会显示为「N 项未能删除」。

**点关闭按钮，软件去哪了？**

隐藏到**菜单栏托盘**了（左键点击恢复）。完全退出请用托盘右键菜单的「退出」，或 Cmd+Q。

**终端能执行任意命令吗？**

不能。终端里运行的是内置的 mole 引擎本身 —— 它没有 shell，且已经过裁剪。你只能使用引擎的清理/优化/分析/状态/历史/维护命令，**无法**执行 `rm`、`sudo` 之类的东西。

**为什么没有 CPU 温度？**

Apple Silicon 上 CPU 和 SSD 温度需要 root 权限（SMC）或系统私有接口，普通应用拿不到 —— 这是平台限制，不是缺陷。MkCleaner 提供的是无需 root 的**热节流状态**（`pmset -g therm`）：如果 CPU 因过热被降频，会明确显示「过热降频 · CPU 性能限制 N%」。

**隐私安全吗？**

应用不联网收集任何数据。唯一的网络请求是启动时向 GitHub 查询更新。所有清理决策和操作都在本机、由引擎执行。

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 界面 | React 19 · TypeScript · Tailwind CSS 4 |
| 外壳 | Tauri 2（Rust）· xterm.js · portable-pty |
| 清理引擎 | [Mole](https://github.com/tw93/Mole) 1.48.1（GPL-3.0，内置并经裁剪） |
| 图标 | AppKit（NSWorkspace）· 手写分层 ICNS |

---

## 🔧 开发

```sh
pnpm install
pnpm vendor:mole    # 拉取引擎源码 → 应用补丁 → 构建（首次必须）
pnpm tauri dev
```

- `pnpm vendor:mole` 下载锁定版本的 Mole，校验 sha256，应用 `scripts/mole-patches.py` 的补丁（移除危险命令、增加热节流状态），构建 universal 二进制
- 测试：`pnpm test`（前端）+ `cd src-tauri && cargo test`（Rust）
- 发布：`./scripts/release.sh <version>`（构建 → 签名 → 上传 GitHub Release）

---

## 📜 许可

[GPL-3.0-or-later](LICENSE) · 清理引擎 [Mole](https://github.com/tw93/Mole)（GPL-3.0）的引入与修改说明见 [THIRD_PARTY.md](THIRD_PARTY.md)。

<div align="center">

Made with ❤️ by [@MikannQAQ](https://github.com/HanversionOvO)

</div>
