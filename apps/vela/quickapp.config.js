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
    /*
     * ⚠️ **debug 包也要压缩。**
     *
     * 原来这里是 `if (config.mode !== 'production') return;` ——
     * debug 包完全不压缩，b50.js 有 **604 KB**（去掉空白只有 105 KB）。
     *
     * 手表内存本来就紧，用一份没压缩的 600 KB 脚本去跑，
     * 解析和常驻内存都白白多出一截。用户反馈的「整个表卡死然后重启」
     * 很可能和这个有关。
     *
     * 压缩在 debug 包里**没有坏处** —— 只是变量名变短、堆栈行号不好看，
     * 换来的是 6 倍体积差。所以 debug 也压，只是不剥 console。
     *
     *   production → 压缩 + 剥掉 console.debug
     *   debug      → 压缩，保留所有 console，方便看日志
     */
    const isProduction = config.mode === 'production';

    const { name, Minimizer, failures } = resolveMinimizer();

    if (!Minimizer) {
      // 不静默跳过：这是官方优化项，悄悄失效过一次了
      console.error(
        '\n[AstraMai] ⚠️ 拿不到压缩器，这次不会压缩（体积会大 5 倍以上）。\n' +
          `尝试过的包：\n  ${failures.join('\n  ')}\n`,
      );
      return;
    }

    config.optimization.minimize = true;
    config.optimization.minimizer = [
      new Minimizer({
        terserOptions: {
          compress: {
            // production 才剥 console.debug ——
            // 把它当纯函数去掉，连参数求值都没有
            ...(isProduction ? { pure_funcs: ['console.debug'] } : {}),
          },
          // debug 包里保留函数名，堆栈更好读
          mangle: isProduction,
        },
      }),
    ];

    console.log(
      `[AstraMai] ${isProduction ? 'release' : 'debug'} 构建：用 ${name} 压缩` +
        (isProduction ? '，并剥离 console.debug' : ''),
    );
  },
};
