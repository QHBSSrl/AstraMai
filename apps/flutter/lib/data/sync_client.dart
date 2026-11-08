import 'dart:convert';
import 'dart:typed_data';

import 'package:encrypt/encrypt.dart' as encrypt;
import 'package:http/http.dart' as http;

import '../core/sync_payload.dart';

/// 同步服务的 HTTP 客户端（手机侧）。
///
/// ── 这条链路是干什么的 ──────────────────────────────────────────────
///
/// **把手机上查到的成绩传到手表上显示。**
///
/// 手表屏幕小、没有键盘、网络也弱，让它自己去查分体验很差。
/// 手机上查好，加密之后放到一个中转点，手表输入 6 位码就能拉下来。
///
/// ── 和 Worker 的分工 ───────────────────────────────────────────────
///
///   Worker  只负责**存一段密文**，它拿不到 PIN，所以解不开
///   手机    生成 code + PIN，加密后 PUT 上去
///   手表    输入 code + PIN，GET 下来解密
///
/// Worker 的接口：
///
///   POST /sync/create            → { code, expiresAt }
///   PUT  /sync/:code             → 上传密文
///   GET  /sync/:code?pin=hash    → 下载密文
///
/// ⚠️ **GET 的 pin 参数不是 PIN 本身，是 sha256(pin + code)。**
/// 这样 Worker 能校验「你知道 PIN」，但仍然解不开内容。
class SyncClient {
  SyncClient({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? defaultBase,
        _client = client ?? http.Client();

  /// 同步服务地址（Cloudflare Worker）。
  static const String defaultBase = 'https://worksync.astramai.astranexus.cn';

  static const Duration timeout = Duration(seconds: 20);

  final String _baseUrl;
  final http.Client _client;

  /// 创建一个配对码。
  ///
  /// Worker 生成 6 位数字 + 10 分钟有效期。
  Future<SyncTicket> createTicket() async {
    final response = await _client
        .post(Uri.parse('$_baseUrl/sync/create'))
        .timeout(timeout);

    final json = _decode(response);
    final code = json['code'] as String?;
    if (code == null || !isValidCode(code)) {
      throw SyncException('服务器没返回有效的配对码');
    }

    return SyncTicket(
      code: code,
      expiresAt: DateTime.tryParse(json['expiresAt'] as String? ?? ''),
    );
  }

  /// 把加密后的载荷传上去。
  Future<void> upload({
    required String code,
    required String pin,
    required String plaintext,
  }) async {
    if (!isValidCode(code)) throw const SyncException('配对码格式不对');
    if (!isValidPin(pin)) throw const SyncException('PIN 必须是 4 位数字');

    final encrypted = encryptPayload(
      plaintext: plaintext,
      pin: pin,
      code: code,
    );

    final response = await _client
        .put(
          Uri.parse('$_baseUrl/sync/$code'),
          headers: {'content-type': 'application/json; charset=utf-8'},
          body: jsonEncode({'payload': encrypted}),
        )
        .timeout(timeout);

    _decode(response);
  }

  /// 下载并解密。
  Future<String> download({
    required String code,
    required String pin,
  }) async {
    if (!isValidCode(code)) throw const SyncException('配对码格式不对');
    if (!isValidPin(pin)) throw const SyncException('PIN 必须是 4 位数字');

    // Worker 只校验「你知道 PIN」，所以传的是哈希不是 PIN 本身
    final proof = await _sha256Hex('$pin$code');

    final response = await _client
        .get(Uri.parse('$_baseUrl/sync/$code?pin=$proof'))
        .timeout(timeout);

    final json = _decode(response);
    final payload = json['payload'] as String?;
    if (payload == null) throw const SyncException('服务器没返回数据');

    return decryptPayload(payload: payload, pin: pin, code: code);
  }

  /// 用 AES-128-CBC 加密。
  ///
  /// ⚠️ IV **必须**用 `deriveIvBase64(code)`，不能用随机 IV ——
  /// 手表端是按 code 派生 IV 的，两边不一致就解不开。
  static String encryptPayload({
    required String plaintext,
    required String pin,
    required String code,
  }) {
    final key = encrypt.Key(base64Decode(deriveKeyBase64(pin, code)));
    final iv = encrypt.IV(base64Decode(deriveIvBase64(code)));

    final encrypter = encrypt.Encrypter(
      encrypt.AES(key, mode: encrypt.AESMode.cbc, padding: 'PKCS7'),
    );

    return encrypter.encrypt(plaintext, iv: iv).base64;
  }

  /// 解密。
  static String decryptPayload({
    required String payload,
    required String pin,
    required String code,
  }) {
    final key = encrypt.Key(base64Decode(deriveKeyBase64(pin, code)));
    final iv = encrypt.IV(base64Decode(deriveIvBase64(code)));

    final encrypter = encrypt.Encrypter(
      encrypt.AES(key, mode: encrypt.AESMode.cbc, padding: 'PKCS7'),
    );

    try {
      return encrypter.decrypt64(payload, iv: iv);
    } catch (_) {
      throw const SyncException('解密失败，PIN 或配对码不对');
    }
  }

  /// `sha256(pin + code)` 的十六进制。
  ///
  /// 用 `dart:convert` 没有 sha256，所以这里手写一个——只有 60 行，
  /// 比引一个包轻。
  ///
  /// ⚠️ 必须和 Worker 那边的算法**逐字节一致**，包括十六进制的字母大小写。
  /// Worker 用的是小写。
  static Future<String> _sha256Hex(String input) async {
    return _sha256(utf8.encode(input));
  }

  Map<String, Object?> _decode(http.Response response) {
    Map<String, Object?>? json;
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, Object?>) json = decoded;
    } on FormatException {
      throw SyncException('服务器返回了非 JSON（HTTP ${response.statusCode}）');
    }

    if (json == null) {
      throw SyncException('服务器返回了看不懂的东西（HTTP ${response.statusCode}）');
    }

    if (response.statusCode >= 400 || json['ok'] == false) {
      throw SyncException(
        json['message'] as String? ?? '同步服务返回 ${response.statusCode}',
      );
    }

    return json;
  }

  void dispose() => _client.close();
}

/// 一个配对码。
class SyncTicket {
  const SyncTicket({required this.code, this.expiresAt});

  final String code;
  final DateTime? expiresAt;
}

/// 同步相关的错误。
class SyncException implements Exception {
  const SyncException(this.message);

  final String message;

  @override
  String toString() => message;
}

// ══════════════════════════════════════════════════════════════════════
// SHA-256
//
// `dart:convert` 只有 hash 的接口没有实现，`crypto` 包能用但为了一个
// 函数引一个依赖不值。这里手写一份标准实现。
//
// 代码量约 60 行，是公开的教科书实现，不是自己发明的算法。
// ══════════════════════════════════════════════════════════════════════

const List<int> _k = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

int _rotr(int x, int n) => ((x >> n) | (x << (32 - n))) & 0xffffffff;

String _sha256(List<int> message) {
  var h0 = 0x6a09e667;
  var h1 = 0xbb67ae85;
  var h2 = 0x3c6ef372;
  var h3 = 0xa54ff53a;
  var h4 = 0x510e527f;
  var h5 = 0x9b05688c;
  var h6 = 0x1f83d9ab;
  var h7 = 0x5be0cd19;

  // 填充
  final bits = message.length * 8;
  final padded = Uint8List.fromList([...message, 0x80]);
  while (padded.length % 64 != 56) {
    padded.add(0);
  }
  final lengthBytes = ByteData(8)..setUint64(0, bits, Endian.big);
  final withLength = Uint8List.fromList(
    [...padded, ...lengthBytes.buffer.asUint8List()],
  );

  final w = List<int>.filled(64, 0);

  for (var chunk = 0; chunk < withLength.length; chunk += 64) {
    for (var i = 0; i < 16; i++) {
      final j = chunk + i * 4;
      w[i] = (withLength[j] << 24) |
          (withLength[j + 1] << 16) |
          (withLength[j + 2] << 8) |
          withLength[j + 3];
    }

    for (var i = 16; i < 64; i++) {
      final s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      final s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xffffffff;
    }

    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (var i = 0; i < 64; i++) {
      final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      final ch = (e & f) ^ (~e & g);
      final temp1 = (h + s1 + ch + _k[i] + w[i]) & 0xffffffff;
      final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      final maj = (a & b) ^ (a & c) ^ (b & c);
      final temp2 = (s0 + maj) & 0xffffffff;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & 0xffffffff;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & 0xffffffff;
    }

    h0 = (h0 + a) & 0xffffffff;
    h1 = (h1 + b) & 0xffffffff;
    h2 = (h2 + c) & 0xffffffff;
    h3 = (h3 + d) & 0xffffffff;
    h4 = (h4 + e) & 0xffffffff;
    h5 = (h5 + f) & 0xffffffff;
    h6 = (h6 + g) & 0xffffffff;
    h7 = (h7 + h) & 0xffffffff;
  }

  final out = StringBuffer();
  for (final v in [h0, h1, h2, h3, h4, h5, h6, h7]) {
    out.write(v.toRadixString(16).padLeft(8, '0'));
  }
  return out.toString();
}
