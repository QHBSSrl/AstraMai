/**
 * 音频播放封装。
 *
 * 平台接口一律延迟 require 且逐层做存在性检查。
 *
 * 为什么这么小心：`@system.audio` 在模拟器 / 部分机型上未必存在，
 * 而无保护地调用不存在的接口会抛 `TypeError`，**把整个页面的初始化打断**——
 * 输入法组件里的 `device.getInfo` 就是这么把页面搞成空白的。
 * 播放试听失败只是少个功能，不该让整页挂掉。
 */

let audioModule;

function getAudio() {
  if (audioModule !== undefined) return audioModule;
  try {
    // eslint-disable-next-line global-require
    audioModule = require('@system.audio') || null;
  } catch (error) {
    console.warn('[AstraMai] @system.audio 不可用：', error);
    audioModule = null;
  }
  return audioModule;
}

/** 音频是否可用，用来决定要不要显示「试听」按钮。 */
export function isAudioAvailable() {
  const audio = getAudio();
  return Boolean(audio && typeof audio.play === 'function');
}

/**
 * 播放一段音频。
 * 返回是否真的开始了播放，调用方据此给用户提示。
 */
export function play(uri) {
  const audio = getAudio();
  if (!audio || typeof audio.play !== 'function') return false;

  try {
    // 换曲之前先停掉上一首，否则 src 赋值在部分实现上不会打断当前播放
    if (typeof audio.stop === 'function') audio.stop();
    audio.src = uri;
    audio.play();
    return true;
  } catch (error) {
    console.warn('[AstraMai] 播放失败：', error);
    return false;
  }
}

/** 停止播放。页面退出时一定要调，否则会一直在后台响。 */
export function stop() {
  const audio = getAudio();
  if (!audio || typeof audio.stop !== 'function') return;
  try {
    audio.stop();
  } catch (error) {
    console.warn('[AstraMai] 停止播放失败：', error);
  }
}

/** 注册播放结束回调；传 null 可取消。 */
export function onEnded(handler) {
  const audio = getAudio();
  if (!audio) return;
  try {
    audio.onended = handler;
  } catch (error) {
    console.warn('[AstraMai] 注册 onended 失败：', error);
  }
}
