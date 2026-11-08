// Flutter 端的基础测试。
//
// ⚠️ **不要写「能渲染出某个界面」这种测试。**
// 界面会一直改，这种测试只会天天红，然后被人注释掉 —— 那还不如不写。
//
// 这里只测**纯函数**：Rating 公式、达成率归一化、系数查表。
// 这些是音游数据的核心，算错了整个 B50 都是错的，而且**界面上看不出来**
// （数字看起来合理，只是差了 1 分）。
import 'package:flutter_test/flutter_test.dart';

import 'package:astramai/core/rating.dart';

void main() {
  group('归一化达成率', () {
    test('百分数原样通过', () {
      expect(normalizeAchievement(100.5), 100.5);
      expect(normalizeAchievement(98.5), 98.5);
    });

    test('万分位会折算成百分数', () {
      // 有些源给的是 1005000 这种
      expect(normalizeAchievement(1005000), closeTo(100.5, 0.001));
      expect(normalizeAchievement(985000), closeTo(98.5, 0.001));
    });

    test('超过 101 会夹住', () {
      expect(normalizeAchievement(200), 101.0);
    });

    test('负数夹到 0', () {
      expect(normalizeAchievement(-5), 0.0);
    });
  });

  group('系数查表', () {
    test('SSS 是 21.6，但 100.4999 是 22.2（同档顶格）', () {
      expect(dxRatingCoefficient(100.5), 22.4); // SSS+
      expect(dxRatingCoefficient(100.4999), 22.2); // SSS 顶格（要正好这个值）
      expect(dxRatingCoefficient(100.4), 21.6); // 100.4 还没到顶格
      expect(dxRatingCoefficient(100.0), 21.6); // SSS
      expect(dxRatingCoefficient(99.9999), 21.4); // SS+ 顶格
      expect(dxRatingCoefficient(99.8), 21.1); // 还没到顶格
      expect(dxRatingCoefficient(99.5), 21.1); // SS+
    });

    test('低于 10% 不计分', () {
      expect(dxRatingCoefficient(9.99), 0.0);
      expect(dxRatingCoefficient(0), 0.0);
    });
  });

  group('单曲 Rating', () {
    test('14.2 谱 100.5% AP = 320（游戏内封顶值）', () {
      // 14.2 × 1.005 × 22.4 + 1 = 320.67 → floor = 320
      expect(
        calculateDxRating(levelValue: 14.2, achievement: 100.5, allPerfect: true),
        320,
      );
    });

    test('14.2 谱 100.5% 无 AP = 319', () {
      expect(
        calculateDxRating(levelValue: 14.2, achievement: 100.5),
        319,
      );
    });

    test('13.0 谱 97.0%（S）', () {
      // 13.0 × 0.97 × 20.0 = 252.2 → 252
      expect(calculateDxRating(levelValue: 13.0, achievement: 97.0), 252);
    });

    test('用的是 floor 不是 round —— 差 0.9 也不能进位', () {
      // 13.0 × 0.97 × 20.0 = 252.2
      expect(calculateDxRating(levelValue: 13.0, achievement: 97.0), 252);

      // 造一个刚好差一点点的：12.0 × 1.0 × 21.6 = 259.2
      expect(calculateDxRating(levelValue: 12.0, achievement: 100.0), 259);
    });
  });

  group('AP 判定', () {
    test('ap / app 都算', () {
      expect(isAllPerfect('ap'), isTrue);
      expect(isAllPerfect('AP'), isTrue);
      expect(isAllPerfect('app'), isTrue);
    });

    test('fc / p 不算', () {
      expect(isAllPerfect('fc'), isFalse);
      expect(isAllPerfect('p'), isFalse);
      expect(isAllPerfect(null), isFalse);
    });
  });

  group('评级', () {
    test('按达成率反推', () {
      expect(rateFromAchievement(100.5), 'sssp');
      expect(rateFromAchievement(100.4), 'sss');
      expect(rateFromAchievement(99.5), 'ssp');
      expect(rateFromAchievement(97.0), 's');
      expect(rateFromAchievement(80.0), 'a');
      expect(rateFromAchievement(10.0), 'd');
    });
  });

  group('打满上限', () {
    test('14.2 谱打满 AP 是 320', () {
      expect(maxRatingForLevel(14.2), 320);
    });
  });
}
