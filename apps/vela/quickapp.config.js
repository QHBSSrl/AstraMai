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
 * ⚠️ 这个配置**曾经是静默失效的**，记在这里免得再踩：
 *
 *   原来只 `require('terser-webpack-plugin')`，而工具链里根本没有这个包名
 *   （实测 `MODULE_NOT_FOUND`），于是被 try/catch 吞掉、直接 return，
 *   release 包里 8 处 console.debug 一个没少——**但构建照样报成功**。
 *
 *   实际可用的是 `minimizer-webpack-plugin`（v5，导出 MinimizerPlugin，
 *   接受同样的 `terserOptions`），工具链用这个包名替代了 terser-webpack-plugin。
 *
 *   现在两个都试，且**失败时把警告打显眼**——宁可构建日志里吵一点，
 *   也不要"以为剥掉了其实没剥"。
 */

/** 依次尝试两种包名，返回可用的那个 Minimizer。 */
function resolveMinimizer() {
  const candidates = ['terser-webpack-plugin', 'minimizer-webpack-plugin'];
  const failures = [];
  for (const name of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      return { name, Minimizer: require(name) };
    } catch (error) {
      failures.push(`${name}: ${error.code ?? error.message}`);
    }
  }
  return { name: null, Minimizer: null, failures };
}

module.exports = {
  postHook: (config) => {
    // debug 包原样保留 console.debug，方便调试
    if (config.mode !== 'production') return;

    const { name, Minimizer, failures } = resolveMinimizer();

    if (!Minimizer) {
      // 不静默跳过：这是官方优化项，悄悄失效过一次了
      console.error(
        '\n[AstraMai] ⚠️ 拿不到压缩器，console.debug 不会被剥离（官方优化项失效）。\n' +
          `尝试过的包：\n  ${failures.join('\n  ')}\n`,
      );
      return;
    }

    config.optimization.minimize = true;
    config.optimization.minimizer = [
      new Minimizer({
        terserOptions: {
          compress: {
            // 把 console.debug(...) 整个调用当纯函数去掉——
            // 不只是不打印，连参数求值都没有
            pure_funcs: ['console.debug'],
          },
        },
      }),
    ];

    console.log(`[AstraMai] release 构建：用 ${name} 剥离 console.debug`);
  },
};
