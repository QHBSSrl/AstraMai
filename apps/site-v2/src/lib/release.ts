/**
 * ORhythm 版本与发布清单数据管理模块
 * 支持构建期静态预取（SSG）与客户端无感水合（Client Hydration）双保险机制
 */

export interface ReleasePackage {
  fileName: string;
  url: string;
  size: string;
  sizeBytes?: number;
  arch: string;
  recommended?: boolean;
  sha256?: string;
}

export interface ReleaseManifest {
  version: string;
  releaseDate: string;
  channel: string;
  changelogSummary?: string;
  packages: {
    androidArm64: ReleasePackage;
    androidArmv7: ReleasePackage;
    velaRpk: ReleasePackage;
  };
}

/**
 * 默认硬编码兜底发布信息 (v0.1.3)
 * 当未配置 PUBLIC_RELEASE_MANIFEST_URL、配置为示例域名或网络拉取失败时自动降级生效
 */
export const FALLBACK_RELEASE: ReleaseManifest = {
  version: '0.1.3',
  releaseDate: '2026-11-15',
  channel: 'stable',
  changelogSummary: '包名正式更名为 com.nowmes.orhythm，支持舞萌 DX 与中二节奏成绩同步，小米手表/手环端手机网桥中转支持。',
  packages: {
    androidArm64: {
      fileName: 'ORhythm-0.1.3-arm64-v8a.apk',
      url: '/releases/ORhythm-0.1.3-arm64-v8a.apk',
      size: '17.9 MB',
      sizeBytes: 18787335,
      arch: 'arm64-v8a',
      recommended: true,
    },
    androidArmv7: {
      fileName: 'ORhythm-0.1.3-armeabi-v7a.apk',
      url: '/releases/ORhythm-0.1.3-armeabi-v7a.apk',
      size: '15.5 MB',
      sizeBytes: 16299751,
      arch: 'armeabi-v7a',
      recommended: false,
    },
    velaRpk: {
      fileName: 'com.nowmes.orhythm.0.1.3.rpk',
      url: '/releases/com.nowmes.orhythm.0.1.3.rpk',
      size: '294 KB',
      sizeBytes: 300819,
      arch: 'xiaomi-vela',
      recommended: true,
    },
  },
};

/**
 * 构建期（Build Time）尝试拉取最新版本清单
 * 运行在 Node.js / Vite build 阶段
 */
export async function getLatestRelease(): Promise<ReleaseManifest> {
  const manifestUrl = import.meta.env.PUBLIC_RELEASE_MANIFEST_URL;

  // 未配置或属于示例占位域名，直接返回兜底数据
  if (!manifestUrl || manifestUrl.includes('example.com') || manifestUrl.includes('.example')) {
    return FALLBACK_RELEASE;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(manifestUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[ORhythm Release] HTTP ${response.status} fetching manifest from ${manifestUrl}, using fallback.`);
      return FALLBACK_RELEASE;
    }

    const data = (await response.json()) as ReleaseManifest;
    if (!data.version || !data.packages) {
      console.warn('[ORhythm Release] Manifest schema mismatch, using fallback.');
      return FALLBACK_RELEASE;
    }

    return {
      version: data.version,
      releaseDate: data.releaseDate || FALLBACK_RELEASE.releaseDate,
      channel: data.channel || FALLBACK_RELEASE.channel,
      changelogSummary: data.changelogSummary || FALLBACK_RELEASE.changelogSummary,
      packages: {
        androidArm64: { ...FALLBACK_RELEASE.packages.androidArm64, ...(data.packages.androidArm64 || {}) },
        androidArmv7: { ...FALLBACK_RELEASE.packages.androidArmv7, ...(data.packages.androidArmv7 || {}) },
        velaRpk: { ...FALLBACK_RELEASE.packages.velaRpk, ...(data.packages.velaRpk || {}) },
      },
    };
  } catch (error) {
    console.warn(`[ORhythm Release] Failed to fetch remote manifest (${error}), using fallback.`);
    return FALLBACK_RELEASE;
  }
}
