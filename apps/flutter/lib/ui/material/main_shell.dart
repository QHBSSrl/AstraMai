import 'package:flutter/material.dart';

import 'home_page.dart';
import 'mine_page.dart';
import 'query_page.dart';

/// 应用外壳：dock 栏 + 三个页面。
///
/// ── 三个 Tab ────────────────────────────────────────────────────────
///
///   首页   游戏卡片 + 快捷功能
///   查询   查别人的分（暂时是占位）
///   我的   设置 / 账号 / 关于（暂时是占位）
///
/// ⚠️ 后两个现在是占位页 —— 先把框架搭出来，功能后面填。
/// 放占位而不是不放，是因为底部栏的**位置**和**手感**需要真实存在才能调。
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [
          HomeTab(),
          QueryTab(),
          MineTab(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.secondaryContainer,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: '首页',
          ),
          NavigationDestination(
            icon: Icon(Icons.search_outlined),
            selectedIcon: Icon(Icons.search),
            label: '查询',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: '我的',
          ),
        ],
      ),
    );
  }
}
