import 'package:shared_preferences/shared_preferences.dart';

/// 支持的四个游戏。
///
/// ⚠️ **顺序就是首页卡片的顺序** —— 玩家最多的放前面。
enum GameId { maimai, chunithm, osu, phigros }

extension GameIdInfo on GameId {
  /// 存进 SharedPreferences 的键名。不要用 `name` —— 改枚举名会丢数据。
  String get storageKey => switch (this) {
        GameId.maimai => 'maimai',
        GameId.chunithm => 'chunithm',
        GameId.osu => 'osu',
        GameId.phigros => 'phigros',
      };

  String get label => switch (this) {
        GameId.maimai => '舞萌 DX',
        GameId.chunithm => '中二节奏',
        GameId.osu => 'osu!',
        GameId.phigros => 'Phigros',
      };

  /// 主数字叫什么。
  ///
  /// 舞萌是 DX Rating，中二是 Rating，osu 是 pp，Phigros 是 RKS。
  /// **这四个东西不能统一叫「分数」** —— 玩家会觉得你不懂。
  String get primaryLabel => switch (this) {
        GameId.maimai => 'DX Rating',
        GameId.chunithm => 'Rating',
        GameId.osu => 'pp',
        GameId.phigros => 'RKS',
      };

  /// 绑定用的标识叫什么。
  String get bindingLabel => switch (this) {
        GameId.maimai => '好友码',
        GameId.chunithm => '好友码',
        GameId.osu => '用户名',
        GameId.phigros => 'TapTap 登录',
      };

  /// 这个游戏要不要额外登录。
  ///
  /// Phigros 不能只靠一个 ID 查 —— 要走扫码登录拿 token。
  /// 首页对它的处理和其他三个不同。
  bool get needsLogin => this == GameId.phigros;
}

/// 一个玩家在一个游戏里的绑定。
class GameBinding {
  const GameBinding({required this.game, required this.value});

  final GameId game;

  /// 好友码 / QQ 号 / osu 用户名。
  final String value;

  bool get isEmpty => value.trim().isEmpty;
}

/// 绑定数据的本地存储。
///
/// ── 为什么存本地而不是服务端 ──────────────────────────────────────
///
/// 这些 ID（好友码、QQ、osu 用户名）**本来就是公开信息** ——
/// 落雪的查询接口不需要凭据，谁都能查。
///
/// 存服务端反而要建账号体系、要处理隐私、要考虑数据合规 ——
/// 为了一个"记住上次输入"不值当。
///
/// 所以存手机上，卸载 App 就没了。够用。
///
/// ⚠️ Phigros 的 session token **绝不能**存这里 ——
/// SharedPreferences 是明文的。那个后面单独做加密存储。
class ProfileStore {
  ProfileStore._();

  static const String _prefix = 'binding.';

  /// 读所有绑定。
  static Future<Map<GameId, String>> loadAll() async {
    final prefs = await SharedPreferences.getInstance();
    final result = <GameId, String>{};

    for (final game in GameId.values) {
      final value = prefs.getString('$_prefix${game.storageKey}');
      if (value != null && value.trim().isNotEmpty) {
        result[game] = value;
      }
    }
    return result;
  }

  /// 存一个绑定。传空字符串等于解绑。
  static Future<void> save(GameId game, String value) async {
    final prefs = await SharedPreferences.getInstance();
    final key = '$_prefix${game.storageKey}';

    if (value.trim().isEmpty) {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, value.trim());
    }
  }

  /// 解绑。
  static Future<void> clear(GameId game) => save(game, '');
}
