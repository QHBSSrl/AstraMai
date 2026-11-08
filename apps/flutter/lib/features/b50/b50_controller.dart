import 'package:flutter/foundation.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../data/maimai_repository.dart';

/// B50 页的状态。
///
/// ── 为什么状态和 UI 分开 ────────────────────────────────────────────
///
/// 用户说要「每个平台用自己平台的原生 UI，不然 iOS 塞个 MD3 太违和」。
///
/// 那么逻辑就必须能在三套 UI 之间复用。所以：
///
///   · 这个类是纯 `ChangeNotifier`（Flutter 的 foundation，不是 Material）
///   · 它不知道任何 Widget、颜色、布局
///   · 三端的页面各自 `AnimatedBuilder` 监听它，画自己想画的样子
///
/// ⚠️ **不要在这里 import material.dart。**
/// 一旦引了，这个文件就绑死在 Material 上了，iOS 那边想用 Cupertino
/// 就得复制一份逻辑。
class B50Controller extends ChangeNotifier {
  B50Controller({MaimaiRepository? repository})
      : _repository = repository ?? MaimaiRepository();

  final MaimaiRepository _repository;

  // ── 状态 ────────────────────────────────────────────────────────────

  MaimaiB50View? _view;
  MaimaiB50View? get view => _view;

  bool _loading = false;
  bool get loading => _loading;

  String? _error;
  String? get error => _error;

  /// 上次查询用的好友码 —— 用来在输入框里预填。
  int? _lastFriendCode;
  int? get lastFriendCode => _lastFriendCode;

  /// 玩家改过的排序方式。
  ///
  /// `true` 表示按 Rating 降序（默认），`false` 表示按定数降序。
  /// 两种都是玩家真正会用的：前者看排名，后者看"哪首难"。
  bool _sortByRating = true;
  bool get sortByRating => _sortByRating;

  /// 当前展示的成绩列表。
  ///
  /// 舞萌是 B35（旧曲）+ B15（新曲），**但玩家习惯看一个总榜**。
  /// 所以默认合并排序；界面上再标注哪条来自新曲。
  List<MaimaiScore> get scores {
    final v = _view;
    if (v == null) return const [];

    final all = [...v.standard, ...v.dx];
    if (_sortByRating) {
      all.sort((a, b) => (b.rating ?? 0).compareTo(a.rating ?? 0));
    } else {
      all.sort((a, b) => (b.levelValue ?? 0).compareTo(a.levelValue ?? 0));
    }
    return all;
  }

  // ── 动作 ────────────────────────────────────────────────────────────

  /// 按好友码查。
  Future<void> loadByFriendCode(int friendCode) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      _view = await _repository.b50ByFriendCode(friendCode);
      _lastFriendCode = friendCode;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = '出错了：$e';
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// 按 QQ 号查。
  Future<void> loadByQq(String qq) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      _view = await _repository.b50ByQq(qq);
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = '出错了：$e';
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// 切换排序。
  void toggleSort() {
    _sortByRating = !_sortByRating;
    notifyListeners();
  }

  /// 清掉错误（用户点掉提示条时）。
  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _repository.dispose();
    super.dispose();
  }
}
