/**
 * Section titles as the engine reports them, translated.
 *
 * The engine is English-only; the app is not. Unknown titles pass through so
 * a section added by a future engine version still shows up — untranslated.
 */
const TITLES: Record<string, string> = {
  "DNS & Spotlight Check": "DNS 与 Spotlight 检查",
  "Finder Cache Refresh": "Finder 缓存刷新",
  "App State Cleanup": "应用状态清理",
  "Broken Config Repair": "损坏配置修复",
  "Network Cache Refresh": "网络缓存刷新",
  "Database Optimization": "数据库优化",
  "LaunchServices Repair": "LaunchServices 修复",
  "Dock Refresh": "Dock 刷新",
  "Prevent Finder .DS_Store": "防止生成 .DS_Store",
  "Legacy Overrides": "旧版覆盖项清理",
  "Memory Optimization": "内存优化",
  "Network Stack Refresh": "网络栈刷新",
  "Permission Repair": "权限修复",
  "Spotlight Optimization": "Spotlight 优化",
  "Spotlight Orphan Rules": "Spotlight 孤立规则清理",
  "Periodic Maintenance": "定期维护",
  "Shared File Lists": "共享文件列表",
  "Disk Health": "磁盘健康检查",
  "Login Items": "登录项检查",
  "Quarantine Database Cleanup": "隔离数据库清理",
  "Launch Agents Cleanup": "启动代理清理",
  Notifications: "通知中心检查",
  "Usage Data": "使用数据检查",
};

export function translateTitle(engineTitle: string): string {
  return TITLES[engineTitle] ?? engineTitle;
}
