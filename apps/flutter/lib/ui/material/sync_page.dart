import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/sync_payload.dart';
import '../../data/profile_store.dart';
import '../../data/sync_client.dart';

/// 「同步到手表」页。
///
/// ── 这条链路怎么走 ──────────────────────────────────────────────────
///
/// ```
/// 手机                                手表
///  │                                   │
///  ├─ 选一个游戏（已绑定的）
///  ├─ 输入 4 位 PIN（自己定）
///  ├─ 生成 6 位配对码
///  ├─ 加密上传 ──→ Cloudflare Worker ←──│
///  │                                   │
///  │                             输入配对码 + PIN
///  │                                   ├─ 下载并解密
///  │                                   └─ 显示数据
/// ```
///
/// ── 为什么是「手机传给手表」而不是反过来 ────────────────────────────
///
/// 手表屏幕小、没有键盘、网络也弱。让它自己去输 15 位好友码体验很差。
/// 手机上弄好推过去，手表只管显示。
///
/// ── PIN 为什么要用户自己定 ──────────────────────────────────────────
///
/// Worker 知道配对码。如果 PIN 也由它生成，那它就能解出内容。
/// 让用户自己定一个 Worker 不知道的值，密钥才真的只有两端知道。
///
/// ⚠️ **这一版只传绑定，不传成绩。**
/// 手表拿到之后知道「该去查谁」，但查分还是要自己联网。
/// 真正传 B50 数据要等下一版 —— 需要手机先完整拉一次 B50 再编码进去。
class SyncToWatchPage extends StatefulWidget {
  const SyncToWatchPage({super.key});

  @override
  State<SyncToWatchPage> createState() => _SyncToWatchPageState();
}

class _SyncToWatchPageState extends State<SyncToWatchPage> {
  final _client = SyncClient();
  final _pinInput = TextEditingController();

  Map<GameId, String> _bindings = {};
  GameId? _selected;

  bool _busy = false;
  String? _error;
  SyncTicket? _ticket;

  @override
  void initState() {
    super.initState();
    _loadBindings();
  }

  @override
  void dispose() {
    _client.dispose();
    _pinInput.dispose();
    super.dispose();
  }

  Future<void> _loadBindings() async {
    final bindings = await ProfileStore.loadAll();
    if (!mounted) return;
    setState(() {
      _bindings = bindings;
      _selected = bindings.isEmpty ? null : bindings.keys.first;
    });
  }

  Future<void> _generate() async {
    final pin = _pinInput.text.trim();
    if (!isValidPin(pin)) {
      setState(() => _error = 'PIN 必须是 4 位数字');
      return;
    }

    final game = _selected;
    if (game == null) {
      setState(() => _error = '先去「我的」绑定一个游戏');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _ticket = null;
    });

    try {
      final ticket = await _client.createTicket();

      final plaintext = encodeSyncPayload(
        game: game.storageKey,
        view: {'binding': _bindings[game] ?? ''},
      );

      await _client.upload(code: ticket.code, pin: pin, plaintext: plaintext);

      if (!mounted) return;
      setState(() {
        _ticket = ticket;
        _busy = false;
      });
    } on SyncException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '出错了：$e';
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('同步到手表')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ExplainCard(),
          const SizedBox(height: 20),
          if (_bindings.isEmpty)
            _NoBindingHint()
          else ...[
            _GamePicker(
              bindings: _bindings,
              selected: _selected,
              onSelect: (game) => setState(() => _selected = game),
            ),
            const SizedBox(height: 20),
            _PinInput(controller: _pinInput),
            const SizedBox(height: 20),
            SizedBox(
              height: 52,
              child: FilledButton.icon(
                onPressed: _busy ? null : _generate,
                icon: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.sync),
                label: Text(_busy ? '生成中…' : '生成配对码'),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              _ErrorMessage(message: _error!),
            ],
            if (_ticket != null) ...[
              const SizedBox(height: 20),
              _TicketCard(ticket: _ticket!),
            ],
          ],
        ],
      ),
    );
  }
}

class _ExplainCard extends StatelessWidget {
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
              Icon(Icons.watch, size: 18, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '手表上没键盘，输不了 15 位好友码',
                  style:
                      text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '在手机上生成一个 6 位配对码，手表只要输这个码 + 你定的 4 位 PIN，'
            '就能拿到数据。',
            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _NoBindingHint extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Icon(Icons.link_off, size: 40, color: scheme.outline),
          const SizedBox(height: 12),
          Text(
            '先去「我的」绑定一个游戏',
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _GamePicker extends StatelessWidget {
  const _GamePicker({
    required this.bindings,
    required this.selected,
    required this.onSelect,
  });

  final Map<GameId, String> bindings;
  final GameId? selected;
  final ValueChanged<GameId> onSelect;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '要同步哪个游戏',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                letterSpacing: 1,
                fontWeight: FontWeight.w700,
              ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final game in bindings.keys)
              ChoiceChip(
                label: Text(game.label),
                selected: selected == game,
                onSelected: (_) => onSelect(game),
              ),
          ],
        ),
      ],
    );
  }
}

class _PinInput extends StatelessWidget {
  const _PinInput({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '设一个 4 位 PIN',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                letterSpacing: 1,
                fontWeight: FontWeight.w700,
              ),
        ),
        const SizedBox(height: 4),
        Text(
          '手表要输这个才能解开。服务器不知道你设的 PIN。',
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          maxLength: 4,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: const TextStyle(
            fontSize: 24,
            letterSpacing: 8,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
          decoration: const InputDecoration(
            counterText: '',
            hintText: '••••',
            border: OutlineInputBorder(),
          ),
        ),
      ],
    );
  }
}

class _ErrorMessage extends StatelessWidget {
  const _ErrorMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 18, color: scheme.onErrorContainer),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: scheme.onErrorContainer, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket});

  final SyncTicket ticket;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          Text(
            '在手表上输入',
            style: text.labelMedium?.copyWith(color: scheme.onPrimaryContainer),
          ),
          const SizedBox(height: 8),
          // 配对码用超大字号 + 等宽，方便照着输
          Text(
            ticket.code,
            style: text.displayMedium?.copyWith(
              color: scheme.onPrimaryContainer,
              fontWeight: FontWeight.w800,
              letterSpacing: 8,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 12),
          Text(
            ticket.expiresAt == null
                ? '10 分钟内有效'
                : '有效到 ${ticket.expiresAt!.toLocal().toString().substring(11, 16)}',
            style: text.labelSmall?.copyWith(
              color: scheme.onPrimaryContainer.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: ticket.code));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('配对码已复制'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('复制'),
          ),
        ],
      ),
    );
  }
}
