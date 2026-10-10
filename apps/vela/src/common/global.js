/**
 * 共享模块挂到 global 上。
 *
 * 依据官方《内存优化》最佳实践：
 *
 *   > 将通用的方法、常量和对象实例统一挂在 global 上，在页面中不用再 import，
 *   > 需要用的时候直接从 global 上取。
 *
 * 文档里给了 QQ音乐 的实测对比：靠这一条把最大内存从 4842844 降到 1872528。
 *
 * 为什么这对我们是关键：`astramai-core.js` 有 72 KB，**每个页面 import 一次就
 * 各自打一份进页面包**（B50 703 KB、Search 677 KB，而不引它的二维码页只有 169 KB）。
 * 手表内存本来就小，这份重复是纯粹的浪费。
 *
 * 这里在应用启动时（app.ux）统一加载一次，页面改成从 global 取。
 */

import * as core from './astramai-core.js';
import * as store from './store.js';
import * as config from './config.js';
import * as validate from './validate.js';
import * as navigation from './navigation.js';
import * as diag from './diag.js';
import * as audio from './audio.js';
import * as api from './api.js';
import * as secret from './secret.js';
import * as syncPayload from './sync-payload.js';

/**
 * 挂在一个命名空间下，而不是把几十个符号平铺到 global。
 * 平铺容易和平台或框架的全局撞名，而且看不出这些符号是哪来的。
 */
global.AstraMai = {
  core,
  store,
  config,
  validate,
  navigation,
  diag,
  audio,
  api,
  secret,
  syncPayload,
};

/**
 * 页面里这样取：
 *
 *   const { core, store } = global.AstraMai;
 */
