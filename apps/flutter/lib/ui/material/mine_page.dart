import 'package:flutter/material.dart';

import '../../data/profile_store.dart';
import '../../features/auth/auth_controller.dart';
import 'sync_page.dart';

/// 「我的」Tab。
///
/// ── 结构 ────────────────────────────────────────────────────────────
///
///   ┌─────────────────────────┐
///   │ 我的                     │
///   │ ┌─────────────────────┐ │
///   │ │ (头) 用户名   [PLUS] │ │
///   │ │     邮箱       [退出]│ │
///   │ └─────────────────────┘ │
///   │ 我的绑定                 │
///   │  舞萌 DX   165423... ›   │
///   │  中二节奏  未绑定    ›   │
///   │  手表                    │
///   │  同步到手表           ›   │
///   │ 关于                     │
///   │  版本 / 数据来源 / 加群   │
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
  late final AuthController _auth;

  Map<GameId, String> _bindings = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();

    _auth = AuthController();
    _auth.addListener(_onAuthChanged);
    // 恢复上次登录态：读缓存 + 快过期时静默续期
    _auth.restore();

    _reload();
  }

  @override
  void dispose() {
    _auth.removeListener(_onAuthChanged);
    _auth.dispose();
    super.dispose();
  }

  void _onAuthChanged() {
    if (mounted) setState(() {});
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
            _buildAbout(context),
          ],
        ),
      ),
    );
  }

  // ── 账号卡 ──────────────────────────────────────────────────────────

  Widget _buildAccountCard(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final signedIn = _auth.signedIn;
    final name = signedIn ? _auth.displayName : '未登录';
    final subtitle =
        signedIn ? (_auth.email ?? '已登录') : '登录后多设备同步，推分和对比要登录';

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
            backgroundColor:
                signedIn ? scheme.primaryContainer : scheme.secondaryContainer,
            child: signedIn
                ? Text(
                    name.isEmpty ? '?' : name.characters.first.toUpperCase(),
                    style: text.titleMedium?.copyWith(
                      color: scheme.onPrimaryContainer,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                : Icon(
                    Icons.person_outline,
                    color: scheme.onSecondaryContainer,
                  ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        style: text.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (signedIn && _auth.isPlus) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: scheme.tertiaryContainer,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          'PLUS',
                          style: text.labelSmall?.copyWith(
                            color: scheme.onTertiaryContainer,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: text.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (signedIn)
            TextButton(
              onPressed: _auth.busy ? null : _confirmSignOut,
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
              child: const Text('退出'),
            )
          else
            FilledButton.tonal(
              onPressed: _auth.busy ? null : _signIn,
              style: FilledButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              ),
              child: _auth.busy
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('登录'),
            ),
        ],
      ),
    );
  }

  Future<void> _signIn() async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await _auth.signIn();
    if (!mounted) return;

    if (!ok && _auth.error != null) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(_auth.error!),
          behavior: SnackBarBehavior.floating,
        ),
      );
      _auth.clearError();
    }
  }

  Future<void> _confirmSignOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('退出登录'),
        content: const Text('本地缓存的登录信息会清掉，绑定数据不受影响。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('退出'),
          ),
        ],
      ),
    );

    if (ok == true) await _auth.signOut();
  }

  // ── 绑定 ────────────────────────────────────────────────────────────

  Widget _buildBindings(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionLabel('我的绑定'),
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
              Text(game.label,
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(
                game.needsLogin
                    ? '这个游戏需要扫码登录，不能在设置里改'
                    : game == GameId.osu
                        ? '填 osu! 官网的用户名'
                        : '填游戏内的${game.bindingLabel}（15 位），或者填 QQ 号',
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

  // ── 手表同步 ────────────────────────────────────────────────────────

  Widget _buildSyncEntry(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionLabel('手表'),
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          child: ListTile(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const SyncToWatchPage()),
            ),
            leading: Icon(Icons.watch, size: 22, color: scheme.primary),
            title: const Text('同步到手表'),
            subtitle: const Text('生成配对码，手表输码就能看'),
            trailing:
                Icon(Icons.chevron_right, size: 18, color: scheme.outline),
          ),
        ),
      ],
    );
  }

  // ── 关于 ────────────────────────────────────────────────────────────

  Widget _buildAbout(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionLabel('关于'),
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              const _AboutRow(label: '版本', value: '0.1.0', onTap: null),
              _divider(scheme),
              _AboutRow(
                label: '数据来源',
                value: '落雪查分器',
                onTap: () => _comingSoon('数据来源说明'),
              ),
              _divider(scheme),
              _AboutRow(
                label: '加入群聊',
                value: '308532898',
                onTap: () => _comingSoon('加群'),
              ),
              _divider(scheme),
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

  Widget _divider(ColorScheme scheme) => Divider(
        height: 1,
        indent: 16,
        endIndent: 16,
        color: scheme.outlineVariant.withValues(alpha: 0.4),
      );

  void _comingSoon(String what) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('「$what」还没做'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
// 小组件
// ══════════════════════════════════════════════════════════════════════

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1,
              fontWeight: FontWeight.w700,
            ),
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
