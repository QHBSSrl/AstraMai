import 'package:flutter/material.dart';

import '../../data/bridge_channel.dart';

/// 手机 ↔ 手表 网桥。
///
/// ── 只有小米手环 Pro 系列需要 ──────────────────────────────────────
///
/// 手环 Pro **没有 `@system.fetch`**，自己上不了网。
///
/// 其它小米手表（Watch 系列）自带联网能力，直接就能查分 ——
/// 对它们来说这个页面没有任何意义，所以入口只在「我的 → 手表」里，
/// 不会主动弹提示打扰。
///
/// 打开开关之后，手机会通过小米穿戴的 interconnect 通道
/// 替手环发 HTTP 请求：
///
/// ```
/// 手环  ──「帮我请求这个 URL」──▶  手机  ──▶  服务器
///       ◀──     分片回来的数据    ──        ◀──
/// ```
///
/// ── 四个前置条件，缺一个就不通 ──────────────────────────────────────
///
/// 1. 手机上装了「小米运动健康」
/// 2. 手环和手机已配对连接
/// 3. 手环上装了 AstraMai
/// 4. **手环和手机的签名证书一致**（这个我们已经处理了）
///
/// 第 4 条不满足时连接会被**静默拒绝**，现象是「一直在等待」——
/// 所以页面上要写清楚，别让用户以为是自己没配对。
///
/// ── ⚠️ 一个产品上的硬伤 ─────────────────────────────────────────────
///
/// **App 被杀掉，手环就断网了。**
///
/// 现在没有做前台服务常驻，所以用户切走 App 或者系统清理后台之后
/// 手环那边就查不了分。这个页面上必须说清楚，不然用户只会觉得
/// 「又坏了」。
class BridgePage extends StatefulWidget {
  const BridgePage({super.key});

  @override
  State<BridgePage> createState() => _BridgePageState();
}

class _BridgePageState extends State<BridgePage> {
  final _channel = BridgeChannel();

  BridgeStatus _status = const BridgeStatus(state: 'STOPPED', text: '已停止');
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _channel.onStatusChanged = (s) {
      if (mounted) setState(() => _status = s);
    };
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final s = await _channel.status();
      if (mounted) setState(() => _status = s);
    } catch (_) {
      // 通道不可用（比如在 iOS 上）—— 保持默认状态
    }
  }

  Future<void> _toggle(bool on) async {
    setState(() => _busy = true);
    try {
      final s = on ? await _channel.start() : await _channel.stop();
      if (mounted) setState(() => _status = s);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('操作失败：$e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('手机网桥')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ScopeCard(),
          const SizedBox(height: 16),
          _StatusCard(status: _status),
          const SizedBox(height: 16),
          _SwitchCard(
            value: _status.running,
            busy: _busy,
            onChanged: _toggle,
          ),
          const SizedBox(height: 24),
          _Checklist(),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: scheme.errorContainer.withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline, size: 18, color: scheme.onErrorContainer),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '这个功能要靠手机中转，所以 ORhythm 必须保持运行。'
                    '切到后台或者被系统清掉之后，手环那边就查不了分了。',
                    style: TextStyle(
                      color: scheme.onErrorContainer,
                      fontSize: 13,
                      height: 1.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 适用范围说明。
///
/// ⚠️ 这一段是必须的 —— 用户装了手表（Watch 系列）进来看见这个页面，
/// 会以为自己的设备也要配，白白折腾一圈。
class _ScopeCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline, size: 18, color: scheme.primary),
              const SizedBox(width: 8),
              Text(
                '仅小米手环 Pro 系列需要',
                style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '手环 Pro 没有网络模块，必须靠手机中转。\n'
            '其它小米手表（Watch 系列）自带联网能力，直接就能查分，'
            '不用开这个。',
            style: text.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});

  final BridgeStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final (color, icon) = switch (status.state) {
      'CONNECTED' => (scheme.primary, Icons.link),
      'WAITING_NODE' => (scheme.tertiary, Icons.hourglass_empty),
      'ERROR' => (scheme.error, Icons.error_outline),
      _ => (scheme.outline, Icons.link_off),
    };

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          Icon(icon, size: 28, color: color),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  status.text,
                  style: text.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
                if (status.error != null && status.error!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      status.error!,
                      style: text.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SwitchCard extends StatelessWidget {
  const _SwitchCard({
    required this.value,
    required this.busy,
    required this.onChanged,
  });

  final bool value;
  final bool busy;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Card(
      child: SwitchListTile(
        value: value,
        onChanged: busy ? null : onChanged,
        title: Text(
          value ? '网桥运行中' : '启用网桥',
          style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          value ? '手环现在可以通过手机上网' : '打开之后手环才能查分',
          style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        secondary: busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(Icons.settings_ethernet, color: scheme.primary),
      ),
    );
  }
}

class _Checklist extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    const items = [
      '手机上装了「小米运动健康」',
      '手环和手机已经配对连接',
      '手环上装了 ORhythm',
      '两边签名证书一致（已处理，正常情况不用管）',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 8, bottom: 8),
          child: Text(
            '连接不上时按顺序检查',
            style: text.titleSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Card(
          child: Column(
            children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0)
                  Divider(
                    height: 1,
                    indent: 16,
                    endIndent: 16,
                    color: scheme.outlineVariant.withValues(alpha: 0.4),
                  ),
                ListTile(
                  dense: true,
                  leading: Text(
                    '${i + 1}',
                    style: text.labelLarge?.copyWith(
                      color: scheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  title: Text(items[i], style: text.bodySmall),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
