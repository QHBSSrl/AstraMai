/// 同步载荷的编解码。
///
/// ── 协议（和 packages/core/src/sync/payload.ts 完全一致）─────────────
///
/// ```
/// code  6 位数字，Worker 随机生成，10 分钟过期
/// pin   4 位数字，用户自己选
///
/// key = base64(ascii(pin + code) 右补 '0' 到 16 字节)
/// iv  = base64(ascii(code) 右补 '0' 到 16 字节)
///
/// 载荷 = AES-128-CBC-PKCS7(明文, key, iv) → base64
/// ```
///
/// **Worker 知道 code，但不知道 pin —— 所以它解不开。**
/// 这是整条链路唯一真正的秘密。
///
/// ── 为什么 IV 用 code 派生 ──────────────────────────────────────────
///
/// 手表端的 `@system.crypto` **没有随机数接口**，生成不了随机 IV。
/// 而 code 本身就是 Worker 随机生成的 6 位数，每次同步都不同。
///
/// 代价是同一个 code 的 IV 固定，但一个 code 只用一次（10 分钟过期），
/// 所以等价于每次加密都用新 IV。
///
/// ⚠️ **手机端有随机数，但不要改成随机 IV。**
/// 手表的解密逻辑是按 code 派生 IV 的，改了手表就解不开。
/// 两端必须完全一致。
library;

import 'dart:convert';

/// 载荷版本。改结构时 +1，两端都要改。
const int syncVersion = 1;

/// 密钥字节长度（AES-128）。
const int syncKeyBytes = 16;

/// PIN 必须是 4 位数字。
bool isValidPin(String pin) => RegExp(r'^\d{4}$').hasMatch(pin);

/// 配对码必须是 6 位数字。
bool isValidCode(String code) => RegExp(r'^\d{6}$').hasMatch(code);

/// 把明文补到指定字节长度的 ASCII（右侧补 `'0'`）。
List<int> _padAscii(String text, int bytes) {
  final out = <int>[];
  for (var i = 0; i < bytes; i++) {
    out.add(i < text.length ? text.codeUnitAt(i) & 0xff : 0x30);
  }
  return out;
}

/// 派生 AES 密钥（base64，16 字节）。
String deriveKeyBase64(String pin, String code) {
  if (!isValidPin(pin)) throw ArgumentError('PIN 必须是 4 位数字');
  if (!isValidCode(code)) throw ArgumentError('配对码必须是 6 位数字');
  return base64Encode(_padAscii('$pin$code', syncKeyBytes));
}

/// 派生 IV（base64，16 字节）。
String deriveIvBase64(String code) {
  if (!isValidCode(code)) throw ArgumentError('配对码必须是 6 位数字');
  return base64Encode(_padAscii(code, syncKeyBytes));
}

/// 要上传的明文结构。
///
/// **字段越少越好** —— 两个运行时（Dart / Vela JS）之间的差异面越小。
class SyncPayload {
  const SyncPayload({
    required this.version,
    required this.game,
    required this.createdAt,
    required this.view,
  });

  final int version;
  final String game;
  final String createdAt;
  final Object? view;

  Map<String, Object?> toJson() => {
        'version': version,
        'game': game,
        'createdAt': createdAt,
        'view': view,
      };

  factory SyncPayload.fromJson(Map<String, Object?> json) => SyncPayload(
        version: (json['version'] as num?)?.toInt() ?? syncVersion,
        game: json['game'] as String? ?? '',
        createdAt: json['createdAt'] as String? ?? '',
        view: json['view'],
      );
}

/// 打包明文。
///
/// 传的是**已经转成 JSON 安全结构的对象**（Map / List / 基本类型）。
String encodeSyncPayload({
  required String game,
  required Object? view,
  String? createdAt,
}) {
  final payload = SyncPayload(
    version: syncVersion,
    game: game,
    createdAt: createdAt ?? DateTime.now().toUtc().toIso8601String(),
    view: view,
  );
  return jsonEncode(payload.toJson());
}

/// 解开明文。
SyncPayload decodeSyncPayload(String raw) {
  final decoded = jsonDecode(raw);
  if (decoded is! Map<String, Object?>) {
    throw const FormatException('载荷不是 JSON 对象');
  }
  return SyncPayload.fromJson(decoded);
}
