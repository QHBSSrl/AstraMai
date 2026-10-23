"""
构建插件：把 src/ 编译成 WebAssembly 组件。

用法：
    python scripts/build_dist.py             只构建
    python scripts/build_dist.py --package   顺便打 .abp

── 为什么调 CLI 而不是 `python -m componentize_py` ─────────────────

模板自带的脚本用的是 `python -m componentize_py`，但那是个**包、没有 `__main__`**：

    No module named componentize_py.__main__; 'componentize_py' is a package
    and cannot be directly executed

真正的命令行程序是 `componentize-py`（pip 装到 `Scripts/` 下）。
这里直接找那个 exe，找不到就报清楚缺什么。
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'


def find_cli() -> Path:
    """定位 componentize-py 命令行程序。

    先看 PATH，再看 pip 的几个常见安装位置 —— Windows 上 pip 会把
    用户级安装放到 `%APPDATA%\\Python\\PythonXYY\\Scripts`，
    那个目录**默认不在 PATH 里**。
    """
    found = shutil.which('componentize-py')
    if found:
        return Path(found)

    candidates = [
        Path.home() / 'AppData' / 'Roaming' / 'Python',
        Path(sys.executable).parent,
        Path(sys.executable).parent / 'Scripts',
    ]
    for base in candidates:
        if not base.exists():
            continue
        for exe in base.rglob('componentize-py*'):
            if exe.suffix in ('.exe', '') and exe.is_file():
                return exe

    print('❌ 找不到 componentize-py')
    print('   先装一下：python -m pip install componentize-py==0.25.1')
    sys.exit(1)


def main() -> None:
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    cli = find_cli()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    entry = DIST / manifest['entry']
    command = [
        str(cli),
        '-d',
        str(ROOT / 'wit'),
        '-w',
        'psys-world-v4',
        'componentize',
        'app',
        '-p',
        str(ROOT / 'src'),
        '-o',
        str(entry),
    ]
    print('  ' + ' '.join(command))
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not entry.exists():
        print('❌ 构建失败')
        print(result.stdout[-2000:])
        print(result.stderr[-2000:])
        sys.exit(1)

    shutil.copy2(ROOT / 'manifest.json', DIST / 'manifest.json')
    icon = ROOT / manifest.get('icon', '')
    if icon.exists():
        shutil.copy2(icon, DIST / icon.name)

    size_mb = entry.stat().st_size / 1024 / 1024
    print(f'✅ {entry.name}  {size_mb:.1f} MB')

    if '--package' in sys.argv:
        # .abp 就是把这些文件打成 zip
        #
        # ⚠️ **文件名用纯 ASCII。** 插件显示名是「AstraMai 网桥」，
        # 中文文件名传到手机、再被各种文件管理器/下载器转手时容易乱码或丢失。
        archive = ROOT / f'astramai-bridge-{manifest["version"]}'
        shutil.make_archive(str(archive), 'zip', DIST)
        print(f'✅ {archive.name}.zip → 改成 .abp 就是插件包（{archive.name}.abp）')


if __name__ == '__main__':
    main()
