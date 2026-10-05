/**
 * 本地设置读写。
 *
 * 单独一个文件是有意的：`@system.storage` 的确切方法名与回调形态需要在真机
 * （或模拟器）上确认，把它收在这一个文件里，万一对不上只改这一处。
 *
 * 见 https://iot.mi.com/vela/quickapp/zh/features/data/storage.html
 */

import storage from '@system.storage'

/** 内存兜底：storage 不可用时至少本次运行内是通的。 */
const memory = new Map()

/** 同步读取（优先内存缓存）。 */
export function readSetting(key, fallback) {
  if (memory.has(key)) return memory.get(key)
  return fallback
}

/**
 * 异步把存储里的值预热进内存。
 * 页面 `onInit` 里 `await warmUp(['serverBase', 'qrLink'])` 一下即可。
 */
export function warmUp(keys) {
  const tasks = keys.map(
    (key) =>
      new Promise((resolve) => {
        try {
          storage.get({
            key,
            success(value) {
              if (value !== undefined && value !== null && value !== '') memory.set(key, value)
              resolve()
            },
            fail() {
              resolve()
            },
          })
        } catch {
          resolve()
        }
      }),
  )
  return Promise.all(tasks)
}

/** 写入并回填内存缓存。 */
export function writeSetting(key, value) {
  memory.set(key, value)
  try {
    storage.set({ key, value, success() {}, fail() {} })
  } catch {
    // 忽略：内存里已经有了，本次运行不受影响
  }
}

/** 删除。 */
export function clearSetting(key) {
  memory.delete(key)
  try {
    storage.delete({ key, success() {}, fail() {} })
  } catch {
    // 忽略
  }
}
