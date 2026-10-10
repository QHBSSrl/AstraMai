/**
 * 构建配置。
 *
 * 依据官方《启动时延优化》：
 *
 *   > 尽可能减少 console 打印，特别是长日志，很影响性能……
 *   > 如果是 debug 期间需要打印日志，建议使用 `console.debug`，
 *   > 并且配置 quickapp.config.js，在打 release 包的时候过滤掉 console.debug 的日志
 *
 * 约定：**调试日志一律用 `console.debug`**，真正的错误才用 `console.error`。
 * 打 release 包时这里会把 console.debug 整个抹掉；debug 包原样保留。
 *
 * ⚠️ `terser-webpack-plugin` **不在 apps/vela 的依赖里**（工具链自带一份），
 * 所以延迟到真正需要压缩时再 require，并且包在 try/catch 里：
 * 拿不到就跳过压缩——**少一层优化可以接受，构建直接失败不行**。
 */

module.exports = {
  postHook: (config) => {
    if (config.mode !== 'production') return;

    let TerserPlugin;
    try {
      // 优先用工具链里那份，其次用本地的
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      TerserPlugin = require('terser-webpack-plugin');
    } catch (error) {
      console.warn('[AstraMai] 拿不到 terser-webpack-plugin，跳过 console.debug 过滤：', error.message);
      return;
    }

    config.optimization.minimize = true;
    config.optimization.minimizer = [
      new TerserPlugin({
        terserOptions: {
          compress: {
            pure_funcs: ['console.debug'],
          },
        },
      }),
    ];
  },
};
