/** Match the hidden-file policy of the local WeChat project inventory. */
export const wechatProjectIgnores = [
  'node_modules/**/*', 'mock-*.js', 'port-report.json',
  // Require a character after the dot: glob 7 treats **/.* as matching the
  // project root '.', so **/.*/** would prune every public file as well.
  '**/.?*', '**/.?*/**',
];
