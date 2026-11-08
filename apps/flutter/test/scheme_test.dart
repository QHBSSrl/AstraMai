// 验证：Flutter 的 ColorScheme.fromSeed 在深色下，primary 到底是什么色。
//
// 背景：真机上「当前是否动态 = false」，但色块看起来像浅蓝。
// 需要确认那是种子色 #4FD6FF 推导出来的浅青，还是真的壁纸色。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('种子色 #4FD6FF 深色下的 primary', () {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF4FD6FF),
      brightness: Brightness.dark,
    );

    String hex(Color c) =>
        '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

    // ignore: avoid_print
    print('  primary            ${hex(scheme.primary)}');
    // ignore: avoid_print
    print('  secondary          ${hex(scheme.secondary)}');
    // ignore: avoid_print
    print('  tertiary           ${hex(scheme.tertiary)}');
    // ignore: avoid_print
    print('  primaryContainer   ${hex(scheme.primaryContainer)}');
    // ignore: avoid_print
    print('  surface            ${hex(scheme.surface)}');
    // ignore: avoid_print
    print('  surfaceContainer   ${hex(scheme.surfaceContainer)}');

    expect(scheme.primary, isNot(const Color(0xFF4FD6FF)));
  });
}
