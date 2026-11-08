import 'package:flutter/material.dart';

import '../../data/profile_store.dart';
import 'sync_page.dart';

/// 「我的」Tab。
///
/// ── 这一版做什么 ────────────────────────────────────────────────────
///
/// 账号体系还没接（Casdoor 要等服务器升级），所以这里先把**结构**搭出来：
///
///   ┌─────────────────────────┐
///   │  ┌───┐                   │
///   │  │ ? │  未登录            │
///   │  └───┘  登录后多设备同步   │
///   │         [ 登录 ]          │
///   ├─────────────────────────┤
///   │  我的绑定                 │
///   │  舞萌 DX      QBHSSrl  ›  │
///   │  中二节奏     未绑定    ›  │
///   │  osu!        未绑定    ›  │
///   │  Phigros     未登录    ›  │
///   ├─────────────────────────┤
///   │  关于                     │
///   │  版本         0.1.0    ›  │
///   │  数据来源     落雪      ›  │
///   │  加入群聊     308532898 ›  │
///   └─────────────────────────┘
///
/// ── 为什么绑定列表放在「我的」而不是首页 ────────────────────────────
///
/// 首页的卡片可以点进去绑定（那是**首次引导**），
/// 但「我绑了哪些、想解绑哪个」是**管理**，属于设置。
///
/// 两处入口不冲突：首页是「你还没绑，来绑」，这里是「你绑了什么」。
class MineTab extends StatefulWidget {
  const MineTab({super.key});

  @override
  State<MineTab> createState() => _MineTabState();
}

class _MineTabState extends State<MineTab> {
  Map<GameId, String> _bindings = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final bindings = await ProfileStore.loadAll();
    if (!mounted) return;
    setState(() {
      _bindings = bindings;
      _loading = false;
    });
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
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
              child: Text(
                '我的',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
            _buildAccountCard(context),
            const SizedBox(height: 20),
            _buildBindings(context),
            _buildSyncEntry(context),
            const SizedBox(height: 8),
            _buildAbout(context),
          ],
        ),
      ),
    );
  }

  /// 账号卡。
  ///
  /// ⚠️ 现在是「未登录」占位。接 Casdoor 之后这里显示头像、名字、
  /// Plus 徽章，右边变成「退出登录」。
  Widget _buildAccountCard(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 26,
            backgroundColor: scheme.secondaryContainer,
            child: Icon(
              Icons.person_outline,
              color: scheme.onSecondaryContainer,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '未登录',
                  style: text.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '登录后多设备同步，还能用推分和对比',
                  style: text.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.tonal(
            onPressed: () => _comingSoon('账号登录'),
            style: FilledButton.styleFrom(
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            ),
            child: const Text('登录'),
          ),
        ],
      ),
    );
  }

  Widget _buildBindings(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
          child: Text(
            '我的绑定',
            style: text.titleSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator()),
          )
        else
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              children: [
                for (var i = 0; i < GameId.values.length; i++) ...[
                  if (i > 0)
                    Divider(
                      height: 1,
                      indent: 16,
                      endIndent: 16,
                      color: scheme.outlineVariant.withValues(alpha: 0.4),
                    ),
                  _BindingRow(
                    game: GameId.values[i],
                    value: _bindings[GameId.values[i]],
                    onTap: () => _editBinding(GameId.values[i]),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  /// 手表同步入口。
  ///
  /// 放「我的」而不是首页 —— 这是个**偶尔用**的功能，不是每次打开都要点。
  Widget _buildSyncEntry(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 20, 0, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
            child: Text(
              '手表',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    letterSpacing: 1,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            child: ListTile(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SyncToWatchPage()),
              ),
              leading: Icon(Icons.watch, size: 22, color: scheme.primary),
              title: const Text('同步到手表'),
              subtitle: const Text('生成配对码，手表输码就能看'),
              trailing: Icon(
                Icons.chevron_right,
                size: 18,
                color: scheme.outline,
              ),
            ),
          ),
        ],
      ),
    );
  }
  Widget _buildAbout(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 8),
          child: Text(
            '关于',
            style: text.titleSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              _AboutRow(
                label: '版本',
                value: '0.1.0',
                onTap: null,
              ),
              Divider(
                height: 1,
                indent: 16,
                endIndent: 16,
                color: scheme.outlineVariant.withValues(alpha: 0.4),
              ),
              _AboutRow(
                label: '数据来源',
                value: '落雪查分器',
                onTap: () => _comingSoon('数据来源说明'),
              ),
              Divider(
                height: 1,
                indent: 16,
                endIndent: 16,
                color: scheme.outlineVariant.withValues(alpha: 0.4),
              ),
              _AboutRow(
                label: '加入群聊',
                value: '308532898',
                onTap: () => _comingSoon('加群'),
              ),
              Divider(
                height: 1,
                indent: 16,
                endIndent: 16,
                color: scheme.outlineVariant.withValues(alpha: 0.4),
              ),
              _AboutRow(
                label: '开源许可',
                value: '',
                onTap: () => showLicensePage(
                  context: context,
                  applicationName: 'AstraMai',
                  applicationVersion: '0.1.0',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _editBinding(GameId game) async {
    final current = _bindings[game] ?? '';
    final input = TextEditingController(text: current);

    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        final scheme = Theme.of(context).colorScheme;

        return Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            0,
            24,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                game.label,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 4),
              Text(
                game.needsLogin
                    ? '这个游戏需要扫码登录，不能在设置里改'
                    : game == GameId.osu
                        ? '填 osu! 官网的用户名'
                        : '填游戏内的${game.bindingLabel}，或者填 QQ 号',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: input,
                autofocus: true,
                enabled: !game.needsLogin,
                decoration: InputDecoration(
                  labelText: game.bindingLabel,
                  border: const OutlineInputBorder(),
                ),
                onSubmitted: (v) => Navigator.of(context).pop(v),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  if (current.isNotEmpty)
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(''),
                      child: const Text('解绑'),
                    ),
                  const Spacer(),
                  FilledButton(
                    onPressed: game.needsLogin
                        ? null
                        : () => Navigator.of(context).pop(input.text.trim()),
                    child: const Text('保存'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );

    if (result == null) return;
    await ProfileStore.save(game, result);
    await _reload();
  }

  void _comingSoon(String what) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('「$what」还没做'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _BindingRow extends StatelessWidget {
  const _BindingRow({
    required this.game,
    required this.value,
    required this.onTap,
  });

  final GameId game;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final bound = value != null && value!.isNotEmpty;

    return ListTile(
      onTap: onTap,
      leading: Icon(
        switch (game) {
          GameId.maimai => Icons.album,
          GameId.chunithm => Icons.piano,
          GameId.osu => Icons.sports_esports,
          GameId.phigros => Icons.music_note,
        },
        color: bound ? scheme.primary : scheme.outline,
        size: 22,
      ),
      title: Text(game.label, style: text.bodyMedium),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            bound ? value! : (game.needsLogin ? '未登录' : '未绑定'),
            style: text.bodySmall?.copyWith(
              color: bound ? scheme.onSurfaceVariant : scheme.outline,
            ),
          ),
          const SizedBox(width: 4),
          Icon(Icons.chevron_right, size: 18, color: scheme.outline),
        ],
      ),
    );
  }
}

class _AboutRow extends StatelessWidget {
  const _AboutRow({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return ListTile(
      onTap: onTap,
      title: Text(label, style: text.bodyMedium),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (value.isNotEmpty)
            Text(
              value,
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          if (onTap != null) ...[
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, size: 18, color: scheme.outline),
          ],
        ],
      ),
    );
  }
}
