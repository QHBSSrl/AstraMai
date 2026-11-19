import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/bridge_channel.dart';

/// 关于软件。
///
/// ── 为什么要独立成页 ────────────────────────────────────────────────
///
/// 以前「版本 / 数据来源 / 官网 / 加群 / 开源许可」全挂在「我的」页面的
/// 一个「关于」分组下面。问题：
///
///   · 「我的」页越来越长，绑定、手表、关于挤在一起
///   · 用户想找版本号得往下翻
///   · 加一条关于信息就要动「我的」页
///
/// 现在「我的」里只留**一个**「关于软件 ›」入口，点进来是这一页。
/// 以后所有「关于这个 App」的内容都往这里加，不要再往「我的」里塞。
///
/// ── 和手表端的关系 ──────────────────────────────────────────────────
///
/// `apps/vela/src/pages/About/about.ux` 是同一份信息的精简版。
/// **两边的条目要一致** —— 加东西时记得两边都改。
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  /// 交流群号。和手表端的 `community.js` 保持一致。
  static const String _qqGroup = '308532898';

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      // 顶部留白交给 SliverAppBar 的 toolbarHeight，避免被状态栏压住
      appBar: AppBar(title: const Text('关于软件')),
      body: ListView(
        // 底部安全区：手势条附近的内容不要被裁
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).padding.bottom + 32,
        ),
        children: [
          _Hero(version: BridgeChannel.versionName),
          const SizedBox(height: 8),
          const _SectionLabel('链接'),
          _Card(
            children: [
              _Row(
                label: '官网 / 下载',
                value: 'orhythm.astranexus.cn',
                onTap: () => BridgeChannel.openUrl(BridgeChannel.website),
              ),
              _divider(scheme),
              _Row(
                label: '交流群',
                value: _qqGroup,
                onTap: () => _copyGroup(context),
              ),
            ],
          ),
          const _SectionLabel('使用'),
          _Card(
            children: [
              _Row(
                label: '用户协议与隐私',
                onTap: () => _showTerms(context),
              ),
            ],
          ),
          const _SectionLabel('致谢'),
          _Card(
            children: [
              _Row(label: '数据来源', value: '落雪查分器 / osu! 官方'),
              _divider(scheme),
              _Row(
                label: '开源许可',
                onTap: () => showLicensePage(
                  context: context,
                  applicationName: 'ORhythm',
                  applicationVersion: BridgeChannel.versionName,
                ),
              ),
            ],
          ),
          const SizedBox(height: 32),
          Center(
            child: Text(
              'ORhythm · 街机音游工具',
              style: text.bodySmall?.copyWith(color: scheme.outline),
            ),
          ),
          const SizedBox(height: 6),
          Center(
            child: Text(
              'Developed by NowMes Software',
              style: text.labelSmall?.copyWith(color: scheme.outline),
            ),
          ),
        ],
      ),
    );
  }

  /// 复制群号。剪贴板在部分设备上可能不可用，所以失败也要给个反馈。
  Future<void> _copyGroup(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Clipboard.setData(const ClipboardData(text: _qqGroup));
      messenger.showSnackBar(
        const SnackBar(content: Text('群号已复制：$_qqGroup')),
      );
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('复制失败，群号是 $_qqGroup')),
      );
    }
  }

  /// 协议内容。
  ///
  /// 内容很短，直接弹对话框比跳新页面更省事 —— 也为以后换成完整
  /// 协议页留了位置（换的时候只改这个方法）。
  void _showTerms(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('用户协议与隐私'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('· 本工具免费提供，只做成绩查询与展示。'),
              SizedBox(height: 8),
              Text('· 好友码和游戏凭证只存在本机；同步数据加密后才离开手机。'),
              SizedBox(height: 8),
              Text('· 不收集账号密码，不接入广告，不转售任何数据。'),
              SizedBox(height: 8),
              Text('· 成绩数据来自落雪查分器与 osu! 官方接口。'),
              SizedBox(height: 8),
              Text('· 这是个个人项目，随时可能停服，别把它当唯一备份。'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
  }
}

/// 应用信息卡：名字、定位、版本。
class _Hero extends StatelessWidget {
  const _Hero({required this.version});

  final String version;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Padding(
      // 左右 16 和其它卡片对齐；顶部 8 是 AppBar 之后的一点呼吸
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ORhythm',
                style: text.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: scheme.primary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '街机与多平台音游查分工具',
                style: text.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                '版本 ${version.isEmpty ? '—' : version}',
                style: text.labelMedium?.copyWith(color: scheme.outline),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(children: children),
    );
  }
}

/// 一行：左边标签，右边可选的值和箭头。
class _Row extends StatelessWidget {
  const _Row({required this.label, this.value, this.onTap});

  final String label;
  final String? value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return ListTile(
      title: Text(label, style: text.bodyLarge),
      subtitle: value == null
          ? null
          : Text(
              value!,
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
      trailing: onTap == null
          ? null
          : Icon(Icons.chevron_right, color: scheme.outline),
      onTap: onTap,
    );
  }
}

Widget _divider(ColorScheme scheme) => Divider(
      height: 1,
      indent: 16,
      endIndent: 16,
      color: scheme.outlineVariant.withValues(alpha: 0.4),
    );
