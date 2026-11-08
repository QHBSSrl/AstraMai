import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/profile_store.dart';
import 'b50_page.dart';

/// 查询 Tab —— 查别人。
///
/// ── 和首页的区别 ────────────────────────────────────────────────────
///
///   首页   → 看自己（已绑定，直接出数据）
///   查询   → 看别人（每次输 ID）
///
/// 这是两个完全不同的场景：
///   · 看自己是「每天打开看一眼」，不想输任何东西
///   · 看别人是「群里有人发了码，查一下」或者「比较一下」
///
/// ── 最近查询 ────────────────────────────────────────────────────────
///
/// 查过的人存本地，最多 20 条。理由：
///   · 群里经常来回查同几个人
///   · 输入 15 位好友码在手机上很烦
class QueryTab extends StatefulWidget {
  const QueryTab({super.key});

  @override
  State<QueryTab> createState() => _QueryTabState();
}

class _QueryTabState extends State<QueryTab> {
  final _input = TextEditingController();

  List<String> _recent = [];
  Map<GameId, String> _bindings = {};
  bool _loading = true;

  static const String _recentKey = 'query.recent';
  static const int _recentMax = 20;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final recent = prefs.getStringList(_recentKey) ?? const <String>[];
    final bindings = await ProfileStore.loadAll();

    if (!mounted) return;
    setState(() {
      _recent = recent;
      _bindings = bindings;
      _loading = false;
    });
  }

  Future<void> _remember(String value) async {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return;

    final next = [trimmed, ..._recent.where((e) => e != trimmed)]
        .take(_recentMax)
        .toList();

    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_recentKey, next);

    if (!mounted) return;
    setState(() => _recent = next);
  }

  void _query(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return;

    FocusScope.of(context).unfocus();
    _remember(trimmed);

    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => B50Page(initialBinding: trimmed),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: scheme.surface,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                '查询',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
            _buildSearchBox(context),
            const SizedBox(height: 24),
            if (!_loading) ...[
              if (_bindings.isNotEmpty) _buildQuickBindings(context),
              if (_bindings.isNotEmpty) const SizedBox(height: 20),
              if (_recent.isNotEmpty) _buildRecent(context),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSearchBox(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _input,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.search,
              onSubmitted: _query,
              decoration: InputDecoration(
                hintText: '好友码或 QQ 号',
                prefixIcon: const Icon(Icons.search, size: 20),
                filled: true,
                fillColor: scheme.surfaceContainerHigh,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(999),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 20),
              ),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: () => _query(_input.text),
            style: FilledButton.styleFrom(
              shape: const CircleBorder(),
              padding: const EdgeInsets.all(14),
            ),
            child: const Icon(Icons.arrow_forward, size: 20),
          ),
        ],
      ),
    );
  }

  /// 从自己的绑定快速跳到查询页。
  ///
  /// 用来「拿自己的号当参照物」—— 比想象中常用，
  /// 比如群里发了个码，想和自己的对比一下。
  Widget _buildQuickBindings(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionLabel('从我的绑定'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final entry in _bindings.entries)
              ActionChip(
                avatar: Icon(
                  switch (entry.key) {
                    GameId.maimai => Icons.album,
                    GameId.chunithm => Icons.piano,
                    GameId.osu => Icons.sports_esports,
                    GameId.phigros => Icons.music_note,
                  },
                  size: 16,
                  color: scheme.onSurfaceVariant,
                ),
                label: Text(entry.value),
                onPressed: () => _query(entry.value),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildRecent(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _SectionLabel('最近查询'),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: TextButton(
                onPressed: _clearRecent,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                ),
                child: const Text('清空'),
              ),
            ),
          ],
        ),
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              for (var i = 0; i < _recent.length; i++) ...[
                if (i > 0)
                  Divider(
                    height: 1,
                    indent: 16,
                    endIndent: 16,
                    color: scheme.outlineVariant.withValues(alpha: 0.4),
                  ),
                ListTile(
                  onTap: () => _query(_recent[i]),
                  leading: Icon(
                    Icons.history,
                    size: 20,
                    color: scheme.onSurfaceVariant,
                  ),
                  title: Text(
                    _recent[i],
                    style: text.bodyMedium?.copyWith(
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  trailing: Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: scheme.outline,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _clearRecent() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_recentKey);
    if (!mounted) return;
    setState(() => _recent = []);
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              letterSpacing: 1,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}
