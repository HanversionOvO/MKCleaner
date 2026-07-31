/**
 * Category names as the engine reports them.
 *
 * The engine is English-only; the app is not. Unknown names pass through rather
 * than being dropped, so a category added by a future engine version still
 * shows up — just untranslated.
 */
const NAMES: Record<string, string> = {
  "User essentials": "用户缓存与日志",
  "App caches": "应用缓存",
  Browsers: "浏览器",
  "Developer tools": "开发工具",
  Applications: "应用程序",
  "Application Support": "应用支持文件",
  "App leftovers": "已卸载应用的残留",
  Virtualization: "虚拟机",
  "Apple Silicon updates": "系统更新包",
  "Device backups & firmware": "设备备份与固件",
  "Time Machine": "时间机器快照",
  "Large files": "大文件",
  "System Data clues": "系统数据",
  "Project artifacts": "项目构建产物",
  "System caches": "系统缓存",
  Trash: "废纸篓",
};

export function categoryName(engineName: string): string {
  return NAMES[engineName] ?? engineName;
}
